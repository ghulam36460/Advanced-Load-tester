/**
 * Advanced Load Tester - Core Load Testing Module
 * ==============================================
 *
 * High-performance HTTP load testing with advanced features:
 * - Concurrent request handling
 * - Smart request distribution
 * - Advanced retry mechanisms
 * - Real-time metrics collection
 * - Dynamic scaling
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const { Worker } = require("worker_threads");
const { performance } = require("perf_hooks");
const { EventEmitter } = require("events");
const crypto = require("crypto");

class LoadTester extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      maxConcurrency: options.maxConcurrency || 1000,
      defaultTimeout: options.defaultTimeout || 30000,
      keepAlive: options.keepAlive !== false,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      enableMetrics: options.enableMetrics !== false,
      metricsInterval: options.metricsInterval || 1000,
      ...options,
    };

    this.httpAgent = new http.Agent({
      keepAlive: this.options.keepAlive,
      maxSockets: this.options.maxConcurrency,
      maxFreeSockets: 256,
      timeout: this.options.defaultTimeout,
    });

    this.httpsAgent = new https.Agent({
      keepAlive: this.options.keepAlive,
      maxSockets: this.options.maxConcurrency,
      maxFreeSockets: 256,
      timeout: this.options.defaultTimeout,
      rejectUnauthorized: false, // Allow self-signed certificates
    });

    this.axios = axios.create({
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      timeout: this.options.defaultTimeout,
    });

    this.tests = new Map();
    this.workers = new Map();
    this.metrics = new Map();
  }

  async createTest(testId, config) {
    const test = new LoadTest(testId, config, this);
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

  async executeRequest(requestConfig, testContext = {}) {
    const startTime = performance.now();
    const requestId = crypto.randomUUID();

    try {
      // Prepare request configuration
      const config = {
        method: requestConfig.method || "GET",
        url: requestConfig.url,
        headers: {
          "User-Agent": requestConfig.userAgent || "AdvancedLoadTester/1.0",
          ...requestConfig.headers,
        },
        timeout: requestConfig.timeout || this.options.defaultTimeout,
        maxRedirects: requestConfig.maxRedirects || 5,
        validateStatus: () => true, // Don't throw on HTTP error status
        ...requestConfig,
      };

      // Add proxy if specified
      if (requestConfig.proxy) {
        config.proxy = requestConfig.proxy;
      }

      // Execute request with retry logic
      let response;
      let lastError;

      for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
        try {
          response = await this.axios(config);
          break;
        } catch (error) {
          lastError = error;

          if (attempt < this.options.retryAttempts) {
            await this.delay(this.options.retryDelay * attempt);
          }
        }
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      if (!response) {
        throw lastError;
      }

      // Create result object
      const result = {
        requestId,
        url: config.url,
        method: config.method,
        status: response.status,
        statusText: response.statusText,
        duration,
        size: this.getResponseSize(response),
        headers: response.headers,
        timestamp: new Date().toISOString(),
        success: response.status >= 200 && response.status < 400,
        error: null,
      };

      // Emit metrics event
      this.emit("request_completed", result, testContext);

      return result;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      const result = {
        requestId,
        url: requestConfig.url,
        method: requestConfig.method || "GET",
        status: 0,
        statusText: "Error",
        duration,
        size: 0,
        headers: {},
        timestamp: new Date().toISOString(),
        success: false,
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
      };

      this.emit("request_failed", result, testContext);
      return result;
    }
  }

  getResponseSize(response) {
    let size = 0;

    if (response.headers["content-length"]) {
      size = parseInt(response.headers["content-length"]);
    } else if (response.data) {
      if (typeof response.data === "string") {
        size = Buffer.byteLength(response.data, "utf8");
      } else if (Buffer.isBuffer(response.data)) {
        size = response.data.length;
      } else {
        size = JSON.stringify(response.data).length;
      }
    }

    return size;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async createWorker(workerScript, workerData) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerScript, { workerData });

      worker.on("message", (message) => {
        if (message.type === "ready") {
          resolve(worker);
        }
      });

      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });

      // Timeout for worker initialization
      setTimeout(() => {
        reject(new Error("Worker initialization timeout"));
      }, 10000);
    });
  }

  destroy() {
    // Clean up all tests
    for (const test of this.tests.values()) {
      test.stop();
    }
    this.tests.clear();

    // Close HTTP agents
    this.httpAgent.destroy();
    this.httpsAgent.destroy();

    // Terminate workers
    for (const worker of this.workers.values()) {
      worker.terminate();
    }
    this.workers.clear();
  }
}

class LoadTest extends EventEmitter {
  constructor(testId, config, loadTester) {
    super();

    this.testId = testId;
    this.config = {
      targets: [],
      workers: 10,
      requestsPerSecond: 100,
      duration: 60,
      rampUpTime: 10,
      rampDownTime: 10,
      thinkTime: 0,
      scenario: "default",
      ...config,
    };

    // Convert url to targets array if needed
    if (this.config.url && !this.config.targets.length) {
      this.config.targets = [
        {
          url: this.config.url,
          method: this.config.method || "GET",
          weight: 1,
          headers: this.config.headers || {},
        },
      ];
    }

    this.loadTester = loadTester;

    this.status = "idle";
    this.startTime = null;
    this.endTime = null;
    this.workers = new Map();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalBytes: 0,
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      responseTimes: [],
      statusCodes: new Map(),
      errors: new Map(),
      throughput: 0,
      startTime: null,
      endTime: null,
    };

    this.metricsInterval = null;
    this.requestQueue = [];
    this.completedRequests = [];
  }

  async start() {
    if (this.status !== "idle") {
      throw new Error("Test is already running or completed");
    }

    this.status = "starting";
    this.startTime = Date.now();
    this.metrics.startTime = this.startTime;

    try {
      // Validate configuration
      this.validateConfig();

      // Prepare targets
      this.prepareTargets();

      // Start metrics collection
      this.startMetricsCollection();

      // Create and start workers
      await this.createWorkers();

      // Start test execution
      this.status = "running";
      await this.executeTest();
    } catch (error) {
      this.status = "failed";
      this.emit("error", error);
      throw error;
    }
  }

  async stop() {
    if (this.status === "stopping" || this.status === "completed") {
      return;
    }

    this.status = "stopping";

    // Stop metrics collection
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Stop all workers
    for (const worker of this.workers.values()) {
      try {
        await worker.terminate();
      } catch (error) {
        console.error("Error terminating worker:", error);
      }
    }
    this.workers.clear();

    this.endTime = Date.now();
    this.metrics.endTime = this.endTime;
    this.status = "completed";

    this.emit("completed", this.getResults());
  }

  validateConfig() {
    if (!this.config.targets || this.config.targets.length === 0) {
      throw new Error("No targets specified");
    }

    if (this.config.workers < 1) {
      throw new Error("Workers must be at least 1");
    }

    if (this.config.duration < 1) {
      throw new Error("Duration must be at least 1 second");
    }

    if (this.config.requestsPerSecond < 1) {
      throw new Error("Requests per second must be at least 1");
    }
  }

  prepareTargets() {
    // Normalize target URLs
    this.config.targets = this.config.targets.map((target) => {
      if (typeof target === "string") {
        return {
          url: target,
          method: "GET",
          weight: 1,
        };
      }
      return {
        method: "GET",
        weight: 1,
        ...target,
      };
    });

    // Calculate total weight for weighted selection
    this.totalWeight = this.config.targets.reduce(
      (sum, target) => sum + target.weight,
      0,
    );
  }

  startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.calculateMetrics();
      this.emit("metrics_update", this.metrics);
    }, 1000);
  }

  async createWorkers() {
    const workerScript = require.resolve("./load-test-worker.js");

    for (let i = 0; i < this.config.workers; i++) {
      const workerData = {
        testId: this.testId,
        workerId: i,
        config: this.config,
      };

      try {
        const worker = await this.loadTester.createWorker(
          workerScript,
          workerData,
        );
        this.workers.set(i, worker);

        // Handle worker messages
        worker.on("message", (message) => {
          this.handleWorkerMessage(i, message);
        });

        worker.on("error", (error) => {
          console.error(`Worker ${i} error:`, error);
        });
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }
  }

  async executeTest() {
    const totalRequests = this.config.requestsPerSecond * this.config.duration;
    const requestInterval = 1000 / this.config.requestsPerSecond;

    // Distribute requests across workers
    const requestsPerWorker = Math.ceil(totalRequests / this.config.workers);

    console.log(
      `Starting test: ${this.config.workers} workers, ${this.config.requestsPerSecond} RPS, ${this.config.duration}s duration`,
    );
    console.log(
      `Ramp-up: ${this.config.rampUpTime}s, Ramp-down: ${this.config.rampDownTime}s`,
    );

    // Send start command to all workers
    for (const worker of this.workers.values()) {
      worker.postMessage({
        type: "start",
        requestsPerWorker,
        requestInterval,
        targets: this.config.targets,
        duration: this.config.duration * 1000,
      });
    }

    // Wait for test duration
    await this.loadTester.delay(this.config.duration * 1000);

    // Send stop command to all workers
    for (const worker of this.workers.values()) {
      worker.postMessage({ type: "stop" });
    }

    // Wait a bit for workers to finish
    await this.loadTester.delay(5000);

    await this.stop();
  }

  handleWorkerMessage(workerId, message) {
    switch (message.type) {
      case "request_completed":
        this.handleRequestCompleted(message.data);
        break;
      case "request_failed":
        this.handleRequestFailed(message.data);
        break;
      case "worker_stats":
        this.handleWorkerStats(workerId, message.data);
        break;
      case "error":
        console.error(`Worker ${workerId} error:`, message.error);
        break;
    }
  }

  handleRequestCompleted(requestData) {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.metrics.totalBytes += requestData.size;
    this.metrics.responseTimes.push(requestData.duration);

    // Update min/max response times
    this.metrics.minResponseTime = Math.min(
      this.metrics.minResponseTime,
      requestData.duration,
    );
    this.metrics.maxResponseTime = Math.max(
      this.metrics.maxResponseTime,
      requestData.duration,
    );

    // Track status codes
    const statusCode = requestData.status;
    this.metrics.statusCodes.set(
      statusCode,
      (this.metrics.statusCodes.get(statusCode) || 0) + 1,
    );

    this.completedRequests.push(requestData);
    this.emit("request_completed", requestData);
  }

  handleRequestFailed(requestData) {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    this.metrics.responseTimes.push(requestData.duration);

    // Track errors
    const errorKey = requestData.error
      ? requestData.error.message
      : "Unknown error";
    this.metrics.errors.set(
      errorKey,
      (this.metrics.errors.get(errorKey) || 0) + 1,
    );

    this.completedRequests.push(requestData);
    this.emit("request_failed", requestData);
  }

  handleWorkerStats(workerId, stats) {
    this.emit("worker_stats", { workerId, stats });
  }

  calculateMetrics() {
    if (this.metrics.responseTimes.length > 0) {
      // Calculate average response time
      const sum = this.metrics.responseTimes.reduce((a, b) => a + b, 0);
      this.metrics.averageResponseTime =
        sum / this.metrics.responseTimes.length;

      // Calculate throughput (requests per second)
      const elapsedSeconds = (Date.now() - this.startTime) / 1000;
      this.metrics.throughput = this.metrics.totalRequests / elapsedSeconds;
    }
  }

  getStatus() {
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
    const responseTimes = this.metrics.responseTimes.slice();
    responseTimes.sort((a, b) => a - b);

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
      totalBytes: this.metrics.totalBytes,
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
      completedRequests:
        this.completedRequests.length > 1000
          ? this.completedRequests.slice(-1000)
          : this.completedRequests, // Keep last 1000 requests
    };
  }

  selectTarget() {
    if (this.config.targets.length === 1) {
      return this.config.targets[0];
    }

    // Weighted random selection
    let random = Math.random() * this.totalWeight;

    for (const target of this.config.targets) {
      random -= target.weight;
      if (random <= 0) {
        return target;
      }
    }

    return this.config.targets[0]; // Fallback
  }
}

module.exports = LoadTester;
