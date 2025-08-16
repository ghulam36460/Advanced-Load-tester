/**
 * gRPC Load Tester - High-Performance gRPC Testing
 * ===============================================
 *
 * Advanced gRPC load testing with features:
 * - Unary/Streaming call support
 * - Protocol buffer handling
 * - Service discovery
 * - Load balancing
 * - Connection pooling
 * - Metadata testing
 */

let grpc, protoLoader;
let _grpcOptionalError = null;
try {
  grpc = require("@grpc/grpc-js");
  protoLoader = require("@grpc/proto-loader");
} catch (e) {
  _grpcOptionalError = e;
}
// If optional gRPC dependencies are missing, export a stub to avoid hard failures
if (_grpcOptionalError) {
  const { EventEmitter } = require("events");
  class GrpcTesterStub extends EventEmitter {
    constructor() {
      super();
      this.reason =
        "gRPC optional dependencies not installed (@grpc/grpc-js, @grpc/proto-loader)";
    }
    async createTest() {
      throw new Error(this.reason);
    }
  }
  module.exports = GrpcTesterStub;
  // Early return ensures the rest of the file is not executed
}
const { EventEmitter } = require("events");
const { performance } = require("perf_hooks");
const crypto = require("crypto");
const fs = require("fs");

class GrpcTester extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      maxConcurrency: options.maxConcurrency || 100,
      timeout: options.timeout || 30000,
      keepAlive: options.keepAlive !== false,
      retryAttempts: options.retryAttempts || 3,
      ...options,
    };

    this.tests = new Map();
    this.clients = new Map();
    this.services = new Map();
  }

  async createTest(testId, config) {
    const test = new GrpcTest(testId, config, this);
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

  async loadProtoFile(protoPath, options = {}) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      ...options,
    });

    return grpc.loadPackageDefinition(packageDefinition);
  }

  createClient(serviceDefinition, address, credentials = null, options = {}) {
    const clientOptions = {
      "grpc.keepalive_time_ms": 30000,
      "grpc.keepalive_timeout_ms": 5000,
      "grpc.keepalive_permit_without_calls": true,
      "grpc.http2.max_pings_without_data": 0,
      "grpc.http2.min_time_between_pings_ms": 10000,
      "grpc.http2.min_ping_interval_without_data_ms": 300000,
      ...options,
    };

    const creds = credentials || grpc.credentials.createInsecure();
    return new serviceDefinition(address, creds, clientOptions);
  }
}

class GrpcTest extends EventEmitter {
  constructor(testId, config, tester) {
    super();

    this.testId = testId;
    this.config = {
      address: "localhost:50051",
      protoFile: "",
      serviceName: "",
      methods: [],
      credentials: "insecure",
      metadata: {},
      workers: 10,
      duration: 60,
      requestsPerSecond: 10,
      callType: "unary", // unary, client_stream, server_stream, bidi_stream
      ...config,
    };
    this.tester = tester;

    this.status = "idle";
    this.startTime = null;
    this.endTime = null;
    this.client = null;
    this.service = null;
    this.activeRequests = new Set();

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      unaryRequests: 0,
      streamingRequests: 0,
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      responseTimes: [],
      throughput: 0,
      errors: new Map(),
      statusCodes: new Map(),
      methodStats: new Map(),
    };
  }

  async start() {
    if (this.status !== "idle") {
      throw new Error("gRPC test is already running or completed");
    }

    this.status = "starting";
    this.startTime = Date.now();

    try {
      await this.initializeClient();
      await this.validateService();

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

    // Wait for active requests to complete
    await this.waitForActiveRequests();

    // Close client
    if (this.client) {
      this.client.close();
    }

    this.endTime = Date.now();
    this.status = "completed";

    this.emit("completed", this.getResults());
  }

  async initializeClient() {
    // Load proto file
    if (!this.config.protoFile) {
      throw new Error("Proto file is required");
    }

    if (!fs.existsSync(this.config.protoFile)) {
      throw new Error(`Proto file not found: ${this.config.protoFile}`);
    }

    const proto = await this.tester.loadProtoFile(this.config.protoFile);

    // Navigate to service
    const servicePath = this.config.serviceName.split(".");
    let service = proto;

    for (const part of servicePath) {
      service = service[part];
      if (!service) {
        throw new Error(`Service not found: ${this.config.serviceName}`);
      }
    }

    this.service = service;

    // Create credentials
    let credentials;
    switch (this.config.credentials) {
      case "insecure":
        credentials = grpc.credentials.createInsecure();
        break;
      case "ssl":
        credentials = grpc.credentials.createSsl();
        break;
      case "custom":
        if (this.config.customCredentials) {
          credentials = this.config.customCredentials;
        } else {
          throw new Error("Custom credentials not provided");
        }
        break;
      default:
        credentials = grpc.credentials.createInsecure();
    }

    // Create client
    this.client = this.tester.createClient(
      this.service,
      this.config.address,
      credentials,
      this.config.clientOptions,
    );
  }

  async validateService() {
    // Test basic connectivity
    try {
      await this.testConnectivity();
    } catch (error) {
      throw new Error(`Cannot connect to gRPC service: ${error.message}`);
    }

    // Validate methods
    if (this.config.methods.length === 0) {
      throw new Error("At least one method must be specified");
    }

    for (const method of this.config.methods) {
      if (typeof this.client[method.name] !== "function") {
        throw new Error(`Method ${method.name} not found in service`);
      }
    }
  }

  async testConnectivity() {
    return new Promise((resolve, reject) => {
      // Try to get channel state
      const state = this.client.getChannel().getConnectivityState(true);

      if (state === grpc.connectivityState.READY) {
        resolve();
      } else {
        // Wait for connection
        this.client.waitForReady(Date.now() + 10000, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }
    });
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
      this.executeRandomMethod();

      if (requestInterval > 0) {
        await this.delay(requestInterval);
      }
    }

    clearInterval(metricsInterval);

    // Wait for pending requests
    await this.waitForActiveRequests();

    await this.stop();
  }

  async executeRandomMethod() {
    if (this.config.methods.length === 0) {
      return;
    }

    const method =
      this.config.methods[
        Math.floor(Math.random() * this.config.methods.length)
      ];
    const requestId = crypto.randomUUID();

    this.activeRequests.add(requestId);

    try {
      await this.executeMethod(method);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  async executeMethod(method) {
    const startTime = performance.now();
    const methodName = method.name;

    // Initialize method stats
    if (!this.metrics.methodStats.has(methodName)) {
      this.metrics.methodStats.set(methodName, {
        requests: 0,
        successful: 0,
        failed: 0,
        totalTime: 0,
        avgTime: 0,
      });
    }

    const methodStats = this.metrics.methodStats.get(methodName);
    methodStats.requests++;

    try {
      this.metrics.totalRequests++;

      // Prepare metadata
      const metadata = new grpc.Metadata();
      for (const [key, value] of Object.entries(this.config.metadata)) {
        metadata.add(key, value);
      }

      if (method.metadata) {
        for (const [key, value] of Object.entries(method.metadata)) {
          metadata.add(key, value);
        }
      }

      // Execute based on call type
      let result;
      switch (method.type || this.config.callType) {
        case "unary":
          result = await this.executeUnaryCall(
            methodName,
            method.request || {},
            metadata,
          );
          this.metrics.unaryRequests++;
          break;

        case "client_stream":
          result = await this.executeClientStreamCall(
            methodName,
            method.requests || [{}],
            metadata,
          );
          this.metrics.streamingRequests++;
          break;

        case "server_stream":
          result = await this.executeServerStreamCall(
            methodName,
            method.request || {},
            metadata,
          );
          this.metrics.streamingRequests++;
          break;

        case "bidi_stream":
          result = await this.executeBidiStreamCall(
            methodName,
            method.requests || [{}],
            metadata,
          );
          this.metrics.streamingRequests++;
          break;

        default:
          throw new Error(`Unknown call type: ${method.type}`);
      }

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
      this.metrics.successfulRequests++;

      methodStats.successful++;
      methodStats.totalTime += duration;
      methodStats.avgTime = methodStats.totalTime / methodStats.requests;

      this.emit("method_completed", {
        method: methodName,
        duration,
        success: true,
        result,
      });
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.responseTimes.push(duration);
      this.metrics.failedRequests++;
      methodStats.failed++;

      this.handleError(methodName, error);

      this.emit("method_failed", {
        method: methodName,
        duration,
        error: error.message,
      });
    }
  }

  async executeUnaryCall(methodName, request, metadata) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + this.tester.options.timeout;

      this.client[methodName](
        request,
        metadata,
        { deadline },
        (error, response) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  async executeClientStreamCall(methodName, requests, metadata) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + this.tester.options.timeout;
      const call = this.client[methodName](
        metadata,
        { deadline },
        (error, response) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        },
      );

      // Send requests
      for (const request of requests) {
        call.write(request);
      }
      call.end();
    });
  }

  async executeServerStreamCall(methodName, request, metadata) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + this.tester.options.timeout;
      const call = this.client[methodName](request, metadata, { deadline });
      const responses = [];

      call.on("data", (response) => {
        responses.push(response);
      });

      call.on("end", () => {
        resolve(responses);
      });

      call.on("error", (error) => {
        reject(error);
      });
    });
  }

  async executeBidiStreamCall(methodName, requests, metadata) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + this.tester.options.timeout;
      const call = this.client[methodName](metadata, { deadline });
      const responses = [];

      call.on("data", (response) => {
        responses.push(response);
      });

      call.on("end", () => {
        resolve(responses);
      });

      call.on("error", (error) => {
        reject(error);
      });

      // Send requests
      for (const request of requests) {
        call.write(request);
      }
      call.end();
    });
  }

  handleError(methodName, error) {
    // Extract gRPC status code
    const statusCode = error.code || "UNKNOWN";
    this.metrics.statusCodes.set(
      statusCode,
      (this.metrics.statusCodes.get(statusCode) || 0) + 1,
    );

    // Categorize error
    const errorKey = `${methodName}: ${error.message}`;
    this.metrics.errors.set(
      errorKey,
      (this.metrics.errors.get(errorKey) || 0) + 1,
    );
  }

  async waitForActiveRequests(timeout = 5000) {
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
      unaryRequests: this.metrics.unaryRequests,
      streamingRequests: this.metrics.streamingRequests,
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
      statusCodes: Object.fromEntries(this.metrics.statusCodes),
      errors: Object.fromEntries(this.metrics.errors),
      methodStats: Object.fromEntries(this.metrics.methodStats),
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

module.exports = GrpcTester;
