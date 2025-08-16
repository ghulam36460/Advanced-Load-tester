/**
 * WebSocket Load Tester - Real-time WebSocket Testing
 * ==================================================
 *
 * Advanced WebSocket load testing with features:
 * - Connection pooling
 * - Message pattern testing
 * - Real-time latency measurement
 * - Connection lifecycle management
 */

const WebSocket = require("ws");
const { EventEmitter } = require("events");
const { performance } = require("perf_hooks");
const crypto = require("crypto");

class WebSocketTester extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      maxConnections: options.maxConnections || 1000,
      connectionTimeout: options.connectionTimeout || 10000,
      messageTimeout: options.messageTimeout || 5000,
      pingInterval: options.pingInterval || 30000,
      reconnectAttempts: options.reconnectAttempts || 3,
      reconnectDelay: options.reconnectDelay || 1000,
      ...options,
    };

    this.tests = new Map();
    this.connections = new Map();
  }

  async createTest(testId, config) {
    const test = new WebSocketTest(testId, config, this);
    this.tests.set(testId, test);
    return test;
  }

  getTest(testId) {
    return this.tests.get(testId);
  }

  removeTest(testId) {
    const test = this.tests.get(testId);
    if (test) {
      test.stop();
      this.tests.delete(testId);
    }
  }
}

class WebSocketTest extends EventEmitter {
  constructor(testId, config, tester) {
    super();

    this.testId = testId;
    this.config = {
      url: "",
      connections: 100,
      duration: 60,
      messagesPerSecond: 10,
      messagePattern: "echo",
      protocols: [],
      headers: {},
      ...config,
    };
    this.tester = tester;

    this.status = "idle";
    this.startTime = null;
    this.endTime = null;
    this.connections = new Map();
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalMessages: 0,
      messagesSent: 0,
      messagesReceived: 0,
      messagesFailed: 0,
      averageLatency: 0,
      minLatency: Infinity,
      maxLatency: 0,
      latencies: [],
      connectionTimes: [],
      averageConnectionTime: 0,
      throughput: 0,
      errors: new Map(),
    };

    this.messageQueue = [];
    this.latencyMap = new Map(); // Track message latencies
  }

  async start() {
    if (this.status !== "idle") {
      throw new Error("WebSocket test is already running or completed");
    }

    this.status = "starting";
    this.startTime = Date.now();

    try {
      await this.createConnections();
      this.status = "running";
      await this.executeTest();
    } catch (error) {
      this.status = "failed";
      throw error;
    }
  }

  async stop() {
    if (this.status === "stopping" || this.status === "completed") {
      return;
    }

    this.status = "stopping";

    // Close all connections
    for (const connection of this.connections.values()) {
      try {
        if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close();
        }
      } catch (error) {
        console.error("Error closing WebSocket connection:", error);
      }
    }

    this.connections.clear();
    this.endTime = Date.now();
    this.status = "completed";

    this.emit("completed", this.getResults());
  }

  async createConnections() {
    const connectionPromises = [];

    for (let i = 0; i < this.config.connections; i++) {
      connectionPromises.push(this.createConnection(i));
    }

    // Create connections in batches to avoid overwhelming the server
    const batchSize = 50;
    for (let i = 0; i < connectionPromises.length; i += batchSize) {
      const batch = connectionPromises.slice(i, i + batchSize);
      await Promise.allSettled(batch);

      // Small delay between batches
      if (i + batchSize < connectionPromises.length) {
        await this.delay(100);
      }
    }
  }

  async createConnection(connectionId) {
    const startTime = performance.now();

    try {
      const ws = new WebSocket(this.config.url, this.config.protocols, {
        headers: this.config.headers,
        handshakeTimeout: this.tester.options.connectionTimeout,
      });

      const connection = {
        id: connectionId,
        ws,
        connected: false,
        messagesSent: 0,
        messagesReceived: 0,
        errors: 0,
        lastActivity: Date.now(),
      };

      this.connections.set(connectionId, connection);
      this.metrics.totalConnections++;

      // Set up event handlers
      ws.on("open", () => {
        const connectionTime = performance.now() - startTime;
        this.metrics.connectionTimes.push(connectionTime);
        this.metrics.averageConnectionTime =
          this.metrics.connectionTimes.reduce((a, b) => a + b, 0) /
          this.metrics.connectionTimes.length;

        connection.connected = true;
        this.metrics.activeConnections++;
        this.metrics.successfulConnections++;

        this.emit("connection_opened", connectionId);
      });

      ws.on("message", (data) => {
        this.handleMessage(connectionId, data);
      });

      ws.on("error", (error) => {
        this.handleError(connectionId, error);
      });

      ws.on("close", (code, reason) => {
        this.handleClose(connectionId, code, reason);
      });

      ws.on("pong", () => {
        connection.lastActivity = Date.now();
      });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, this.tester.options.connectionTimeout);

        ws.once("open", () => {
          clearTimeout(timeout);
          resolve(connection);
        });

        ws.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      this.metrics.failedConnections++;
      this.handleError(connectionId, error);
      throw error;
    }
  }

  async executeTest() {
    const testDuration = this.config.duration * 1000;
    const messageInterval = 1000 / this.config.messagesPerSecond;

    const endTime = Date.now() + testDuration;

    // Start periodic ping
    const pingInterval = setInterval(() => {
      this.pingConnections();
    }, this.tester.options.pingInterval);

    // Message sending loop
    while (this.status === "running" && Date.now() < endTime) {
      if (this.metrics.activeConnections > 0) {
        await this.sendMessages();
      }

      if (messageInterval > 0) {
        await this.delay(messageInterval);
      }
    }

    clearInterval(pingInterval);

    // Wait a bit for final messages
    await this.delay(1000);

    await this.stop();
  }

  async sendMessages() {
    const activeConnections = Array.from(this.connections.values()).filter(
      (conn) => conn.connected && conn.ws.readyState === WebSocket.OPEN,
    );

    if (activeConnections.length === 0) {
      return;
    }

    // Send message to a random connection
    const connection =
      activeConnections[Math.floor(Math.random() * activeConnections.length)];
    await this.sendMessage(connection);
  }

  async sendMessage(connection) {
    try {
      const messageId = crypto.randomUUID();
      const timestamp = Date.now();

      let message;

      switch (this.config.messagePattern) {
        case "echo":
          message = JSON.stringify({
            id: messageId,
            timestamp,
            type: "echo",
            data: `Echo test message ${this.metrics.messagesSent}`,
          });
          break;

        case "ping":
          message = JSON.stringify({
            id: messageId,
            timestamp,
            type: "ping",
          });
          break;

        case "custom":
          message = this.config.customMessage || "Hello WebSocket";
          break;

        default:
          message = JSON.stringify({
            id: messageId,
            timestamp,
            data: "Default test message",
          });
      }

      // Track message for latency calculation
      this.latencyMap.set(messageId, timestamp);

      connection.ws.send(message);
      connection.messagesSent++;
      this.metrics.messagesSent++;
      this.metrics.totalMessages++;

      this.emit("message_sent", {
        connectionId: connection.id,
        messageId,
        message,
      });
    } catch (error) {
      connection.errors++;
      this.metrics.messagesFailed++;
      this.handleError(connection.id, error);
    }
  }

  handleMessage(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.messagesReceived++;
    connection.lastActivity = Date.now();
    this.metrics.messagesReceived++;

    try {
      // Try to parse as JSON to extract message ID for latency calculation
      const message = JSON.parse(data.toString());

      if (message.id && this.latencyMap.has(message.id)) {
        const sentTime = this.latencyMap.get(message.id);
        const latency = Date.now() - sentTime;

        this.metrics.latencies.push(latency);
        this.metrics.minLatency = Math.min(this.metrics.minLatency, latency);
        this.metrics.maxLatency = Math.max(this.metrics.maxLatency, latency);

        // Calculate average latency
        this.metrics.averageLatency =
          this.metrics.latencies.reduce((a, b) => a + b, 0) /
          this.metrics.latencies.length;

        // Clean up latency map
        this.latencyMap.delete(message.id);
      }
    } catch (error) {
      // Not JSON, that's fine
    }

    this.emit("message_received", {
      connectionId,
      message: data.toString(),
    });
  }

  handleError(connectionId, error) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.errors++;
    }

    const errorKey = error.message || "Unknown error";
    this.metrics.errors.set(
      errorKey,
      (this.metrics.errors.get(errorKey) || 0) + 1,
    );

    this.emit("connection_error", {
      connectionId,
      error: error.message,
    });
  }

  handleClose(connectionId, code, reason) {
    const connection = this.connections.get(connectionId);
    if (connection && connection.connected) {
      connection.connected = false;
      this.metrics.activeConnections--;
    }

    this.emit("connection_closed", {
      connectionId,
      code,
      reason: reason.toString(),
    });
  }

  pingConnections() {
    for (const connection of this.connections.values()) {
      if (connection.connected && connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.ping();
        } catch (error) {
          this.handleError(connection.id, error);
        }
      }
    }
  }

  calculateThroughput() {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    this.metrics.throughput = this.metrics.messagesReceived / elapsedSeconds;
  }

  getStatus() {
    this.calculateThroughput();

    return {
      testId: this.testId,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      config: this.config,
      metrics: this.getMetricsSummary(),
    };
  }

  getMetricsSummary() {
    const latencies = this.metrics.latencies.slice().sort((a, b) => a - b);

    const percentile = (p) => {
      if (latencies.length === 0) return 0;
      const index = Math.ceil((latencies.length * p) / 100) - 1;
      return latencies[Math.max(0, index)];
    };

    return {
      totalConnections: this.metrics.totalConnections,
      activeConnections: this.metrics.activeConnections,
      successfulConnections: this.metrics.successfulConnections,
      failedConnections: this.metrics.failedConnections,
      connectionSuccessRate:
        this.metrics.totalConnections > 0
          ? (this.metrics.successfulConnections /
              this.metrics.totalConnections) *
            100
          : 0,
      totalMessages: this.metrics.totalMessages,
      messagesSent: this.metrics.messagesSent,
      messagesReceived: this.metrics.messagesReceived,
      messagesFailed: this.metrics.messagesFailed,
      messageSuccessRate:
        this.metrics.messagesSent > 0
          ? (this.metrics.messagesReceived / this.metrics.messagesSent) * 100
          : 0,
      averageLatency: this.metrics.averageLatency,
      minLatency:
        this.metrics.minLatency === Infinity ? 0 : this.metrics.minLatency,
      maxLatency: this.metrics.maxLatency,
      p50Latency: percentile(50),
      p90Latency: percentile(90),
      p95Latency: percentile(95),
      p99Latency: percentile(99),
      averageConnectionTime: this.metrics.averageConnectionTime,
      throughput: this.metrics.throughput,
      errors: Object.fromEntries(this.metrics.errors),
    };
  }

  getResults() {
    return {
      testId: this.testId,
      config: this.config,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime ? this.endTime - this.startTime : 0,
      metrics: this.getMetricsSummary(),
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = WebSocketTester;
