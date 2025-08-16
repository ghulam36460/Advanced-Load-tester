/**
 * Advanced Load Test Worker
 * ========================
 *
 * High-performance worker thread for executing HTTP requests with:
 * - Ramp-up and ramp-down functionality
 * - Human behavior simulation
 * - Proxy rotation
 * - Anti-detection measures
 * - Real-time metrics reporting
 */

const { parentPort, workerData } = require("worker_threads");
const axios = require("axios");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { performance } = require("perf_hooks");

class LoadTestWorker {
  constructor(data) {
    this.workerId = data.workerId;
    this.testId = data.testId;
    this.config = data.config;

    this.isRunning = false;
    this.requests = 0;
    this.errors = 0;
    this.totalResponseTime = 0;
    this.minResponseTime = Infinity;
    this.maxResponseTime = 0;
    this.startTime = null;

    // Anti-detection user agents
    this.userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0",
    ];

    // Proxy list (would be populated from config or external source)
    this.proxies = [];

    this.setupAxios();
    this.setupMessageHandlers();

    // Signal ready
    parentPort.postMessage({ type: "ready" });
  }

  setupAxios() {
    // Create HTTP agents with optimized settings
    this.httpAgent = new http.Agent({
      keepAlive: this.config.keepAlive !== false,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: this.config.timeout || 30000,
    });

    this.httpsAgent = new https.Agent({
      keepAlive: this.config.keepAlive !== false,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: this.config.timeout || 30000,
      rejectUnauthorized: false, // Allow self-signed certificates
    });

    this.axios = axios.create({
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent,
      timeout: this.config.timeout || 30000,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on HTTP error status
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        DNT: "1",
        Connection: this.config.keepAlive ? "keep-alive" : "close",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    // Add request interceptor for anti-detection
    if (this.config.antiDetection) {
      this.axios.interceptors.request.use((config) => {
        // Randomize user agent
        config.headers["User-Agent"] = this.getRandomUserAgent();

        // Add realistic headers
        config.headers["Cache-Control"] = "max-age=0";
        config.headers["Sec-Fetch-Site"] = "none";
        config.headers["Sec-Fetch-Mode"] = "navigate";
        config.headers["Sec-Fetch-User"] = "?1";
        config.headers["Sec-Fetch-Dest"] = "document";

        return config;
      });
    }
  }

  setupMessageHandlers() {
    parentPort.on("message", (message) => {
      switch (message.type) {
        case "start":
          this.startTest(message);
          break;
        case "stop":
          this.stopTest();
          break;
      }
    });
  }

  async startTest(params) {
    this.isRunning = true;
    this.startTime = Date.now();
    this.requestsPerWorker = params.requestsPerWorker;
    this.requestInterval = params.requestInterval;
    this.targets = params.targets;
    this.duration = params.duration;

    console.log(
      `Worker ${this.workerId}: Starting test with ${this.requestsPerWorker} requests, RPS: ${this.config.requestsPerSecond}, Duration: ${this.config.duration}s`,
    );

    try {
      await this.executeLoadTest();
    } catch (error) {
      parentPort.postMessage({
        type: "error",
        error: error.message,
      });
    }
  }

  async executeLoadTest() {
    const endTime = Date.now() + this.duration;
    let currentRPS = 0;
    const targetRPS =
      (this.config.requestsPerSecond || 10) / (this.config.workers || 1); // RPS per worker

    // Calculate ramp-up steps
    const rampUpDuration = (this.config.rampUpTime || 0) * 1000; // Convert to ms
    const rampDownDuration = (this.config.rampDownTime || 0) * 1000;
    const rampUpIncrement =
      rampUpDuration > 0 ? targetRPS / (rampUpDuration / 1000) : targetRPS;

    console.log(
      `Worker ${this.workerId}: Target RPS: ${targetRPS}, Ramp-up: ${this.config.rampUpTime || 0}s, Ramp-down: ${this.config.rampDownTime || 0}s`,
    );

    // Start stats reporting
    const statsInterval = setInterval(() => {
      this.sendStats();
    }, 1000);

    while (this.isRunning && Date.now() < endTime) {
      const elapsed = Date.now() - this.startTime;
      const remaining = endTime - Date.now();

      // Calculate current RPS based on ramp-up/ramp-down
      if (rampUpDuration > 0 && elapsed < rampUpDuration) {
        // Ramp-up phase
        currentRPS = Math.min(targetRPS, (elapsed / 1000) * rampUpIncrement);
      } else if (rampDownDuration > 0 && remaining < rampDownDuration) {
        // Ramp-down phase
        currentRPS = Math.max(0.1, targetRPS * (remaining / rampDownDuration));
      } else {
        // Steady state
        currentRPS = targetRPS;
      }

      // Calculate delay between requests
      const requestDelay = currentRPS > 0 ? 1000 / currentRPS : 1000;

      // Execute requests in batches for better performance
      const batchSize = Math.max(1, Math.floor(currentRPS * 0.1)); // 10 batches per second
      const promises = [];

      for (let i = 0; i < batchSize && this.isRunning; i++) {
        promises.push(this.executeRequest());

        // Add human behavior delay
        if (this.config.humanBehavior) {
          await this.randomDelay(10, 100);
        }
      }

      // Wait for all requests in batch to complete
      await Promise.allSettled(promises);

      // Wait before next batch
      const batchDelay = Math.max(10, requestDelay / batchSize);
      await this.delay(batchDelay);
    }

    clearInterval(statsInterval);
    console.log(
      `Worker ${this.workerId}: Test completed. Requests: ${this.requests}, Errors: ${this.errors}`,
    );
    this.sendStats(); // Send final stats
  }

  async executeRequest() {
    if (!this.isRunning) return;

    const startTime = performance.now();
    const target = this.selectTarget();

    try {
      const requestConfig = {
        method: target.method || "GET",
        url: target.url,
        headers: {
          ...target.headers,
          "X-Request-ID": crypto.randomUUID(),
          "X-Worker-ID": this.workerId,
        },
        timeout: this.config.timeout || 30000,
      };

      // Add proxy if configured
      if (this.config.useProxies && this.proxies.length > 0) {
        requestConfig.proxy = this.getRandomProxy();
      }

      // Add request body for POST/PUT requests
      if (["POST", "PUT", "PATCH"].includes(requestConfig.method)) {
        requestConfig.data = target.body || {
          timestamp: Date.now(),
          workerId: this.workerId,
          requestId: crypto.randomUUID(),
          testData: "load-test-data",
        };
        requestConfig.headers["Content-Type"] = "application/json";
      }

      const response = await this.axios(requestConfig);
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.requests++;
      this.totalResponseTime += duration;
      this.minResponseTime = Math.min(this.minResponseTime, duration);
      this.maxResponseTime = Math.max(this.maxResponseTime, duration);

      const result = {
        requestId: crypto.randomUUID(),
        url: target.url,
        method: requestConfig.method,
        status: response.status,
        statusText: response.statusText,
        duration,
        size: this.getResponseSize(response),
        timestamp: Date.now(),
        success: response.status >= 200 && response.status < 400,
        workerId: this.workerId,
      };

      parentPort.postMessage({
        type: "request_completed",
        data: result,
      });

      // Human behavior simulation - random think time
      if (this.config.humanBehavior) {
        await this.simulateThinkTime();
      }
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.errors++;
      this.totalResponseTime += duration;

      const result = {
        requestId: crypto.randomUUID(),
        url: target.url,
        method: target.method || "GET",
        status: 0,
        statusText: "Error",
        duration,
        size: 0,
        timestamp: Date.now(),
        success: false,
        error: {
          message: error.message,
          code: error.code,
        },
        workerId: this.workerId,
      };

      parentPort.postMessage({
        type: "request_failed",
        data: result,
      });
    }
  }

  selectTarget() {
    if (!this.targets || this.targets.length === 0) {
      throw new Error("No targets available");
    }

    if (this.targets.length === 1) {
      return this.targets[0];
    }

    // Weighted random selection
    let totalWeight = this.targets.reduce(
      (sum, target) => sum + (target.weight || 1),
      0,
    );
    let random = Math.random() * totalWeight;

    for (const target of this.targets) {
      random -= target.weight || 1;
      if (random <= 0) {
        return target;
      }
    }

    return this.targets[0]; // Fallback
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getRandomProxy() {
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
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

  async simulateThinkTime() {
    // Simulate human reading/processing time
    const thinkTime = Math.random() * 1000 + 100; // 0.1-1.1 seconds
    await this.delay(thinkTime);
  }

  async randomDelay(min, max) {
    const delay = Math.random() * (max - min) + min;
    await this.delay(delay);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  sendStats() {
    const elapsed = Date.now() - this.startTime;
    const elapsedSeconds = elapsed / 1000;

    const stats = {
      workerId: this.workerId,
      requests: this.requests,
      errors: this.errors,
      averageResponseTime:
        this.requests > 0 ? this.totalResponseTime / this.requests : 0,
      minResponseTime:
        this.minResponseTime === Infinity ? 0 : this.minResponseTime,
      maxResponseTime: this.maxResponseTime,
      errorRate: this.requests > 0 ? (this.errors / this.requests) * 100 : 0,
      requestsPerSecond:
        elapsedSeconds > 0 ? this.requests / elapsedSeconds : 0,
      timestamp: Date.now(),
      elapsedTime: elapsed,
    };

    parentPort.postMessage({
      type: "worker_stats",
      data: stats,
    });
  }

  stopTest() {
    this.isRunning = false;
    this.sendStats(); // Send final stats
    console.log(`Worker ${this.workerId}: Stopping test`);
  }
}

// Initialize worker if this is a worker thread
if (workerData) {
  new LoadTestWorker(workerData);
} else {
  console.error("This file should only be run as a worker thread");
  process.exit(1);
}

module.exports = LoadTestWorker;
