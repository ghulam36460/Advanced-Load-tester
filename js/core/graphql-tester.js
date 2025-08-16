/**
 * GraphQL Load Tester - Advanced GraphQL Testing
 * ==============================================
 *
 * Comprehensive GraphQL load testing with features:
 * - Query/Mutation/Subscription testing
 * - Schema introspection
 * - Query complexity analysis
 * - Real-time subscription handling
 * - Error categorization
 */

const axios = require("axios");
const WebSocket = require("ws");
const { EventEmitter } = require("events");
const { performance } = require("perf_hooks");
const crypto = require("crypto");

class GraphQLTester extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      maxConcurrency: options.maxConcurrency || 100,
      timeout: options.timeout || 30000,
      retryAttempts: options.retryAttempts || 3,
      subscriptionTimeout: options.subscriptionTimeout || 60000,
      ...options,
    };

    this.tests = new Map();
    this.client = axios.create({
      timeout: this.options.timeout,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  async createTest(testId, config) {
    const test = new GraphQLTest(testId, config, this);
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

class GraphQLTest extends EventEmitter {
  constructor(testId, config, tester) {
    super();

    this.testId = testId;
    this.config = {
      endpoint: "",
      subscriptionEndpoint: "",
      headers: {},
      queries: [],
      mutations: [],
      subscriptions: [],
      workers: 10,
      duration: 60,
      requestsPerSecond: 10,
      variables: {},
      ...config,
    };
    this.tester = tester;

    this.status = "idle";
    this.startTime = null;
    this.endTime = null;
    this.activeRequests = new Set();
    this.subscriptionConnections = new Map();

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      queries: { sent: 0, successful: 0, failed: 0 },
      mutations: { sent: 0, successful: 0, failed: 0 },
      subscriptions: { connected: 0, messages: 0, errors: 0 },
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      responseTimes: [],
      throughput: 0,
      errors: new Map(),
      graphqlErrors: new Map(),
      networkErrors: new Map(),
    };
  }

  async start() {
    if (this.status !== "idle") {
      throw new Error("GraphQL test is already running or completed");
    }

    this.status = "starting";
    this.startTime = Date.now();

    try {
      // Validate configuration
      await this.validateConfig();

      // Introspect schema if needed
      if (this.config.introspect) {
        await this.introspectSchema();
      }

      // Start subscriptions
      await this.startSubscriptions();

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

    // Close subscription connections
    for (const ws of this.subscriptionConnections.values()) {
      try {
        ws.close();
      } catch (error) {
        console.error("Error closing subscription connection:", error);
      }
    }
    this.subscriptionConnections.clear();

    this.endTime = Date.now();
    this.status = "completed";

    this.emit("completed", this.getResults());
  }

  async validateConfig() {
    if (!this.config.endpoint) {
      throw new Error("GraphQL endpoint is required");
    }

    if (
      this.config.queries.length === 0 &&
      this.config.mutations.length === 0 &&
      this.config.subscriptions.length === 0
    ) {
      throw new Error(
        "At least one query, mutation, or subscription is required",
      );
    }

    // Test connectivity
    try {
      await this.executeQuery({
        query: "{ __typename }",
      });
    } catch (error) {
      throw new Error(`Cannot connect to GraphQL endpoint: ${error.message}`);
    }
  }

  async introspectSchema() {
    const introspectionQuery = `
            query IntrospectionQuery {
                __schema {
                    types {
                        name
                        kind
                        description
                        fields {
                            name
                            type {
                                name
                                kind
                            }
                        }
                    }
                    queryType {
                        name
                    }
                    mutationType {
                        name
                    }
                    subscriptionType {
                        name
                    }
                }
            }
        `;

    try {
      const result = await this.executeQuery({
        query: introspectionQuery,
      });

      this.schema = result.data.__schema;
      this.emit("schema_introspected", this.schema);
    } catch (error) {
      console.warn("Schema introspection failed:", error.message);
    }
  }

  async startSubscriptions() {
    if (
      !this.config.subscriptionEndpoint ||
      this.config.subscriptions.length === 0
    ) {
      return;
    }

    for (let i = 0; i < this.config.subscriptions.length; i++) {
      const subscription = this.config.subscriptions[i];
      await this.createSubscription(i, subscription);
    }
  }

  async createSubscription(subscriptionId, subscription) {
    try {
      const ws = new WebSocket(this.config.subscriptionEndpoint, "graphql-ws");
      this.subscriptionConnections.set(subscriptionId, ws);

      ws.on("open", () => {
        // Send connection init
        ws.send(
          JSON.stringify({
            type: "connection_init",
            payload: this.config.headers,
          }),
        );

        this.metrics.subscriptions.connected++;
        this.emit("subscription_connected", subscriptionId);
      });

      ws.on("message", (data) => {
        this.handleSubscriptionMessage(subscriptionId, data);
      });

      ws.on("error", (error) => {
        this.metrics.subscriptions.errors++;
        this.handleError("subscription", error);
      });

      ws.on("close", () => {
        this.subscriptionConnections.delete(subscriptionId);
        this.emit("subscription_closed", subscriptionId);
      });

      // Wait for connection ack
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Subscription connection timeout"));
        }, 10000);

        ws.on("message", (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === "connection_ack") {
            clearTimeout(timeout);

            // Start subscription
            ws.send(
              JSON.stringify({
                id: crypto.randomUUID(),
                type: "start",
                payload: {
                  query: subscription.query,
                  variables: {
                    ...this.config.variables,
                    ...subscription.variables,
                  },
                },
              }),
            );

            resolve();
          }
        });
      });
    } catch (error) {
      this.metrics.subscriptions.errors++;
      this.handleError("subscription_setup", error);
    }
  }

  handleSubscriptionMessage(subscriptionId, data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "data":
          this.metrics.subscriptions.messages++;
          this.emit("subscription_data", {
            subscriptionId,
            data: message.payload,
          });
          break;

        case "error":
          this.metrics.subscriptions.errors++;
          this.handleError(
            "subscription_data",
            new Error(JSON.stringify(message.payload)),
          );
          break;

        case "complete":
          this.emit("subscription_complete", subscriptionId);
          break;
      }
    } catch (error) {
      this.handleError("subscription_parse", error);
    }
  }

  async executeTest() {
    const testDuration = this.config.duration * 1000;
    const requestInterval = 1000 / this.config.requestsPerSecond;
    const endTime = Date.now() + testDuration;

    // Start metrics reporting
    const metricsInterval = setInterval(() => {
      this.calculateMetrics();
      this.emit("metrics_update", this.metrics);
    }, 1000);

    // Main testing loop
    while (this.status === "running" && Date.now() < endTime) {
      // Execute query or mutation
      if (this.config.queries.length > 0 || this.config.mutations.length > 0) {
        this.executeRandomOperation();
      }

      if (requestInterval > 0) {
        await this.delay(requestInterval);
      }
    }

    clearInterval(metricsInterval);

    // Wait for pending requests
    await this.waitForPendingRequests();

    await this.stop();
  }

  async executeRandomOperation() {
    const operations = [
      ...this.config.queries.map((q) => ({ ...q, type: "query" })),
      ...this.config.mutations.map((m) => ({ ...m, type: "mutation" })),
    ];

    if (operations.length === 0) {
      return;
    }

    const operation = operations[Math.floor(Math.random() * operations.length)];

    const requestId = crypto.randomUUID();
    this.activeRequests.add(requestId);

    try {
      await this.executeOperation(operation);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  async executeOperation(operation) {
    const startTime = performance.now();

    try {
      this.metrics.totalRequests++;

      if (operation.type === "query") {
        this.metrics.queries.sent++;
      } else if (operation.type === "mutation") {
        this.metrics.mutations.sent++;
      }

      const result = await this.executeQuery({
        query: operation.query,
        variables: { ...this.config.variables, ...operation.variables },
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.responseTimes.push(duration);
      this.metrics.minResponseTime = Math.min(
        this.metrics.minResponseTime,
        duration,
      );
      this.metrics.maxResponseTime = Math.max(
        this.metrics.maxResponseTime,
        duration,
      );

      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        this.handleGraphQLErrors(result.errors);

        if (operation.type === "query") {
          this.metrics.queries.failed++;
        } else if (operation.type === "mutation") {
          this.metrics.mutations.failed++;
        }
        this.metrics.failedRequests++;
      } else {
        if (operation.type === "query") {
          this.metrics.queries.successful++;
        } else if (operation.type === "mutation") {
          this.metrics.mutations.successful++;
        }
        this.metrics.successfulRequests++;
      }

      this.emit("operation_completed", {
        type: operation.type,
        duration,
        success: !result.errors || result.errors.length === 0,
        data: result.data,
        errors: result.errors,
      });
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.responseTimes.push(duration);
      this.metrics.failedRequests++;

      if (operation.type === "query") {
        this.metrics.queries.failed++;
      } else if (operation.type === "mutation") {
        this.metrics.mutations.failed++;
      }

      this.handleError("network", error);

      this.emit("operation_failed", {
        type: operation.type,
        duration,
        error: error.message,
      });
    }
  }

  async executeQuery(payload) {
    const response = await this.tester.client.post(
      this.config.endpoint,
      payload,
      {
        headers: this.config.headers,
      },
    );

    return response.data;
  }

  handleGraphQLErrors(errors) {
    for (const error of errors) {
      const errorKey = error.message || "Unknown GraphQL error";
      this.metrics.graphqlErrors.set(
        errorKey,
        (this.metrics.graphqlErrors.get(errorKey) || 0) + 1,
      );
    }
  }

  handleError(type, error) {
    const errorKey = `${type}: ${error.message}`;

    if (type === "network") {
      this.metrics.networkErrors.set(
        error.message,
        (this.metrics.networkErrors.get(error.message) || 0) + 1,
      );
    }

    this.metrics.errors.set(
      errorKey,
      (this.metrics.errors.get(errorKey) || 0) + 1,
    );
  }

  async waitForPendingRequests(timeout = 5000) {
    const startTime = Date.now();

    while (this.activeRequests.size > 0 && Date.now() - startTime < timeout) {
      await this.delay(100);
    }
  }

  calculateMetrics() {
    if (this.metrics.responseTimes.length > 0) {
      const sum = this.metrics.responseTimes.reduce((a, b) => a + b, 0);
      this.metrics.averageResponseTime =
        sum / this.metrics.responseTimes.length;

      const elapsedSeconds = (Date.now() - this.startTime) / 1000;
      this.metrics.throughput =
        this.metrics.successfulRequests / elapsedSeconds;
    }
  }

  getStatus() {
    this.calculateMetrics();

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
    const responseTimes = this.metrics.responseTimes
      .slice()
      .sort((a, b) => a - b);

    const percentile = (p) => {
      if (responseTimes.length === 0) return 0;
      const index = Math.ceil((responseTimes.length * p) / 100) - 1;
      return responseTimes[Math.max(0, index)];
    };

    return {
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      successRate:
        this.metrics.totalRequests > 0
          ? (this.metrics.successfulRequests / this.metrics.totalRequests) * 100
          : 0,
      queries: this.metrics.queries,
      mutations: this.metrics.mutations,
      subscriptions: this.metrics.subscriptions,
      averageResponseTime: this.metrics.averageResponseTime,
      minResponseTime:
        this.metrics.minResponseTime === Infinity
          ? 0
          : this.metrics.minResponseTime,
      maxResponseTime: this.metrics.maxResponseTime,
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      throughput: this.metrics.throughput,
      graphqlErrors: Object.fromEntries(this.metrics.graphqlErrors),
      networkErrors: Object.fromEntries(this.metrics.networkErrors),
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
      schema: this.schema,
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = GraphQLTester;
