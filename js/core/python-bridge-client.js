/**
 * Python Bridge Client - JavaScript Integration
 * ==========================================
 *
 * This module provides seamless integration between the JavaScript load testing
 * framework and the Python hybrid bridge, enabling bidirectional communication
 * and unified test orchestration.
 */

const WebSocket = require("ws");
const axios = require("axios");
const EventEmitter = require("events");

class PythonBridgeClient extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      pythonApiUrl: config.pythonApiUrl || "http://localhost:5000",
      websocketUrl: config.websocketUrl || "ws://localhost:8080",
      reconnectInterval: config.reconnectInterval || 5000,
      heartbeatInterval: config.heartbeatInterval || 30000,
      ...config,
    };

    this.websocket = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageQueue = [];
    this.responseHandlers = new Map();
    this.requestId = 0;

    this.pythonMetrics = {};
    this.pythonConfig = {};
    this.pythonTestStatus = { status: "unknown" };
  }

  /**
   * Connect to the Python bridge
   */
  async connect() {
    try {
      // Test HTTP API connection
      await this.testHttpConnection();

      // Connect WebSocket
      await this.connectWebSocket();

      // Start heartbeat
      this.startHeartbeat();

      console.log("✅ Connected to Python bridge");
      this.emit("connected");

      return true;
    } catch (error) {
      console.error("❌ Failed to connect to Python bridge:", error.message);
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * Test HTTP API connection
   */
  async testHttpConnection() {
    const response = await axios.get(`${this.config.pythonApiUrl}/health`, {
      timeout: 5000,
    });

    if (response.status !== 200) {
      throw new Error(`HTTP API not responding: ${response.status}`);
    }
  }

  /**
   * Connect WebSocket
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.websocket = new WebSocket(this.config.websocketUrl);

      this.websocket.on("open", () => {
        this.connected = true;
        this.processMessageQueue();
        resolve();
      });

      this.websocket.on("message", (data) => {
        this.handleWebSocketMessage(data);
      });

      this.websocket.on("close", () => {
        this.connected = false;
        this.emit("disconnected");
        this.scheduleReconnect();
      });

      this.websocket.on("error", (error) => {
        console.error("WebSocket error:", error);
        reject(error);
      });

      // Timeout for connection
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("WebSocket connection timeout"));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleWebSocketMessage(data) {
    try {
      const message = JSON.parse(data);

      // Handle response messages
      if (message.requestId && this.responseHandlers.has(message.requestId)) {
        const handler = this.responseHandlers.get(message.requestId);
        this.responseHandlers.delete(message.requestId);
        handler.resolve(message);
        return;
      }

      // Handle broadcast messages
      switch (message.type) {
        case "metrics_update":
          this.pythonMetrics = message.data;
          this.emit("metrics", message.data);
          break;

        case "config_update":
          this.pythonConfig = message.data;
          this.emit("config", message.data);
          break;

        case "test_status_update":
          this.pythonTestStatus = message.data;
          this.emit("testStatus", message.data);
          break;

        case "alert":
          this.emit("alert", message.data);
          break;

        default:
          this.emit("message", message);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  }

  /**
   * Send WebSocket message with response handling
   */
  async sendMessage(message, expectResponse = true) {
    if (!this.connected) {
      this.messageQueue.push({ message, expectResponse });
      throw new Error("Not connected to Python bridge");
    }

    if (expectResponse) {
      message.requestId = ++this.requestId;

      return new Promise((resolve, reject) => {
        this.responseHandlers.set(message.requestId, { resolve, reject });

        this.websocket.send(JSON.stringify(message));

        // Timeout for response
        setTimeout(() => {
          if (this.responseHandlers.has(message.requestId)) {
            this.responseHandlers.delete(message.requestId);
            reject(new Error("Response timeout"));
          }
        }, 30000);
      });
    } else {
      this.websocket.send(JSON.stringify(message));
    }
  }

  /**
   * Process queued messages
   */
  processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const { message, expectResponse } = this.messageQueue.shift();
      this.sendMessage(message, expectResponse).catch(console.error);
    }
  }

  /**
   * Schedule reconnection
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      console.log("🔄 Attempting to reconnect to Python bridge...");
      this.connect();
    }, this.config.reconnectInterval);
  }

  /**
   * Start heartbeat
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.ping();
      } catch (error) {
        console.warn("Heartbeat failed:", error.message);
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Ping Python bridge
   */
  async ping() {
    if (this.connected) {
      await this.sendMessage({ type: "ping" }, true);
    } else {
      await axios.get(`${this.config.pythonApiUrl}/health`, { timeout: 5000 });
    }
  }

  // =====================================
  // Python Load Tester Integration API
  // =====================================

  /**
   * Get current metrics from Python
   */
  async getPythonMetrics() {
    try {
      if (this.connected) {
        const response = await this.sendMessage({ type: "metrics_request" });
        return response.data;
      } else {
        const response = await axios.get(
          `${this.config.pythonApiUrl}/api/metrics`,
        );
        return response.data;
      }
    } catch (error) {
      console.error("Error getting Python metrics:", error);
      return this.pythonMetrics;
    }
  }

  /**
   * Update Python configuration
   */
  async updatePythonConfig(config) {
    try {
      if (this.connected) {
        return await this.sendMessage({
          type: "config_update",
          config: config,
        });
      } else {
        const response = await axios.post(
          `${this.config.pythonApiUrl}/api/config`,
          config,
        );
        return response.data;
      }
    } catch (error) {
      console.error("Error updating Python config:", error);
      throw error;
    }
  }

  /**
   * Control Python load test
   */
  async controlPythonTest(command, parameters = {}) {
    try {
      if (this.connected) {
        return await this.sendMessage({
          type: "test_command",
          command: command,
          parameters: parameters,
        });
      } else {
        const response = await axios.post(
          `${this.config.pythonApiUrl}/api/test/${command}`,
          parameters,
        );
        return response.data;
      }
    } catch (error) {
      console.error(`Error controlling Python test (${command}):`, error);
      throw error;
    }
  }

  /**
   * Execute Python code remotely
   */
  async executePythonCode(code, context = {}) {
    try {
      if (this.connected) {
        return await this.sendMessage({
          type: "python_execution",
          code: code,
          context: context,
        });
      } else {
        const response = await axios.post(
          `${this.config.pythonApiUrl}/api/execute/python`,
          { code, context },
        );
        return response.data;
      }
    } catch (error) {
      console.error("Error executing Python code:", error);
      throw error;
    }
  }

  /**
   * Get Python proxy health
   */
  async getPythonProxyHealth() {
    try {
      const response = await axios.get(
        `${this.config.pythonApiUrl}/api/proxy/health`,
      );
      return response.data;
    } catch (error) {
      console.error("Error getting Python proxy health:", error);
      return null;
    }
  }

  /**
   * Execute JavaScript code in Python engine
   */
  async executeJavaScriptInPython(script, context = {}) {
    try {
      return await this.sendMessage({
        type: "js_execution",
        script: script,
        context: context,
      });
    } catch (error) {
      console.error("Error executing JavaScript in Python:", error);
      throw error;
    }
  }

  // =====================================
  // Hybrid Test Coordination
  // =====================================

  /**
   * Start coordinated hybrid test
   */
  async startHybridTest(testPlan) {
    try {
      const response = await axios.post(
        `${this.config.pythonApiUrl}/api/hybrid/test/start`,
        { testPlan },
      );

      this.emit("hybridTestStarted", testPlan);
      return response.data;
    } catch (error) {
      console.error("Error starting hybrid test:", error);
      throw error;
    }
  }

  /**
   * Synchronize test results
   */
  async syncTestResults(jsResults) {
    try {
      const response = await axios.post(
        `${this.config.pythonApiUrl}/api/hybrid/results/sync`,
        {
          source: "javascript",
          results: jsResults,
          timestamp: new Date().toISOString(),
        },
      );

      return response.data;
    } catch (error) {
      console.error("Error syncing test results:", error);
      throw error;
    }
  }

  /**
   * Get combined metrics from both platforms
   */
  async getCombinedMetrics() {
    try {
      const response = await axios.get(
        `${this.config.pythonApiUrl}/api/hybrid/metrics/combined`,
      );
      return response.data;
    } catch (error) {
      console.error("Error getting combined metrics:", error);
      return {
        python: this.pythonMetrics,
        javascript: {},
        combined: {},
      };
    }
  }

  // =====================================
  // Utility Methods
  // =====================================

  /**
   * Disconnect from Python bridge
   */
  disconnect() {
    this.connected = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    this.emit("disconnected");
    console.log("📡 Disconnected from Python bridge");
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get current Python test status
   */
  getPythonTestStatus() {
    return this.pythonTestStatus;
  }

  /**
   * Get cached Python metrics
   */
  getCachedPythonMetrics() {
    return this.pythonMetrics;
  }

  /**
   * Get cached Python config
   */
  getCachedPythonConfig() {
    return this.pythonConfig;
  }
}

module.exports = PythonBridgeClient;
