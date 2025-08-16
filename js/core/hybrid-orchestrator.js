/**
 * Hybrid Test Orchestrator - JavaScript Side
 * =========================================
 *
 * This module orchestrates hybrid tests that utilize both JavaScript and Python
 * load testing capabilities, providing unified control and coordination.
 */

const PythonBridgeClient = require("./python-bridge-client");
const LoadTester = require("./load-tester");
const WebSocketTester = require("./websocket-tester");
const GraphQLTester = require("./graphql-tester");
const BrowserTester = require("./browser-tester");
const MetricsCollector = require("../utils/metrics-collector");
const EventEmitter = require("events");

class HybridTestOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Bridge configuration
      pythonBridge: {
        pythonApiUrl: config.pythonApiUrl || "http://localhost:5000",
        websocketUrl: config.websocketUrl || "ws://localhost:8080",
        ...config.pythonBridge,
      },

      // Test coordination
      coordination: {
        syncMetrics: true,
        syncResults: true,
        realTimeUpdates: true,
        crossPlatformValidation: true,
        ...config.coordination,
      },

      // Default test settings
      defaultTest: {
        duration: 300,
        workers: 50,
        protocols: ["http"],
        ...config.defaultTest,
      },

      ...config,
    };

    // Initialize components
    this.pythonBridge = new PythonBridgeClient(this.config.pythonBridge);
    this.metricsCollector = new MetricsCollector();

    // Test runners
    this.loadTester = new LoadTester();
    this.webSocketTester = new WebSocketTester();
    this.graphqlTester = new GraphQLTester();
    this.browserTester = new BrowserTester();

    // State management
    this.activeTests = new Map();
    this.testResults = new Map();
    this.combinedMetrics = {};
    this.hybridTestPlan = null;

    // Bind event handlers
    this.setupEventHandlers();
  }

  /**
   * Initialize the hybrid orchestrator
   */
  async initialize() {
    try {
      console.log("🚀 Initializing Hybrid Test Orchestrator...");

      // Connect to Python bridge
      const connected = await this.pythonBridge.connect();
      if (!connected) {
        console.warn(
          "⚠️ Python bridge not available, running in JavaScript-only mode",
        );
      }

      // Initialize test runners
      await this.loadTester.initialize();
      await this.webSocketTester.initialize();
      await this.graphqlTester.initialize();
      await this.browserTester.initialize();

      console.log("✅ Hybrid Test Orchestrator initialized");
      this.emit("initialized");

      return true;
    } catch (error) {
      console.error("❌ Failed to initialize Hybrid Test Orchestrator:", error);
      throw error;
    }
  }

  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // Python bridge events
    this.pythonBridge.on("connected", () => {
      console.log("🔗 Python bridge connected");
      this.emit("pythonConnected");
    });

    this.pythonBridge.on("disconnected", () => {
      console.log("📡 Python bridge disconnected");
      this.emit("pythonDisconnected");
    });

    this.pythonBridge.on("metrics", (metrics) => {
      this.handlePythonMetrics(metrics);
    });

    this.pythonBridge.on("testStatus", (status) => {
      this.handlePythonTestStatus(status);
    });

    this.pythonBridge.on("alert", (alert) => {
      this.emit("alert", { source: "python", ...alert });
    });

    // Test runner events
    this.setupTestRunnerEvents();
  }

  /**
   * Set up test runner event handlers
   */
  setupTestRunnerEvents() {
    const testRunners = [
  { name: "http", runner: this.loadTester },
  { name: "websocket", runner: this.webSocketTester },
  { name: "graphql", runner: this.graphqlTester },
  { name: "browser", runner: this.browserTester },
    ];

    testRunners.forEach(({ name, runner }) => {
      runner.on("testStarted", (testId) => {
        this.activeTests.set(`js_${name}_${testId}`, {
          type: name,
          runner: runner,
          startTime: Date.now(),
          status: "running",
        });
        this.emit("testStarted", {
          testId: `js_${name}_${testId}`,
          type: name,
        });
      });

      runner.on("testCompleted", (testId, results) => {
        const fullTestId = `js_${name}_${testId}`;
        this.testResults.set(fullTestId, results);
        this.activeTests.delete(fullTestId);
        this.emit("testCompleted", { testId: fullTestId, type: name, results });
      });

      runner.on("metrics", (metrics) => {
        this.handleJavaScriptMetrics(name, metrics);
      });

      runner.on("error", (error) => {
        this.emit("error", { source: name, error });
      });
    });
  }

  /**
   * Handle Python metrics updates
   */
  handlePythonMetrics(metrics) {
    this.combinedMetrics.python = metrics;
    this.updateCombinedMetrics();
    this.emit("metricsUpdate", this.combinedMetrics);
  }

  /**
   * Handle JavaScript metrics updates
   */
  handleJavaScriptMetrics(source, metrics) {
    if (!this.combinedMetrics.javascript) {
      this.combinedMetrics.javascript = {};
    }

    this.combinedMetrics.javascript[source] = metrics;
    this.updateCombinedMetrics();
    this.emit("metricsUpdate", this.combinedMetrics);
  }

  /**
   * Update combined metrics
   */
  updateCombinedMetrics() {
  const python = this.combinedMetrics.python || {};
  const _javascript = this.combinedMetrics.javascript || {};

    // Calculate combined totals
    const combined = {
      totalRequests:
        (python.total_requests || 0) + this.sumJSMetrics("totalRequests"),
      successfulRequests:
        (python.successful_requests || 0) +
        this.sumJSMetrics("successfulRequests"),
      failedRequests:
        (python.failed_requests || 0) + this.sumJSMetrics("failedRequests"),
      avgResponseTime: this.calculateWeightedAverage([
        {
          value: python.avg_response_time || 0,
          weight: python.total_requests || 0,
        },
        {
          value: this.getJSAvgResponseTime(),
          weight: this.sumJSMetrics("totalRequests"),
        },
      ]),
      requestsPerSecond:
        (python.requests_per_second || 0) +
        this.sumJSMetrics("requestsPerSecond"),
      timestamp: Date.now(),
    };

    combined.successRate =
      combined.totalRequests > 0
        ? (combined.successfulRequests / combined.totalRequests) * 100
        : 0;

    this.combinedMetrics.combined = combined;
  }

  /**
   * Sum JavaScript metrics across all test types
   */
  sumJSMetrics(metric) {
    const jsMetrics = this.combinedMetrics.javascript || {};
    return Object.values(jsMetrics).reduce((sum, metrics) => {
      return sum + (metrics[metric] || 0);
    }, 0);
  }

  /**
   * Get average response time from JavaScript tests
   */
  getJSAvgResponseTime() {
    const jsMetrics = this.combinedMetrics.javascript || {};
    const values = Object.values(jsMetrics)
      .filter((m) => m.avgResponseTime > 0)
      .map((m) => ({ value: m.avgResponseTime, weight: m.totalRequests || 1 }));

    return this.calculateWeightedAverage(values);
  }

  /**
   * Calculate weighted average
   */
  calculateWeightedAverage(values) {
    if (values.length === 0) return 0;

    const totalWeight = values.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight === 0) return 0;

    const weightedSum = values.reduce((sum, v) => sum + v.value * v.weight, 0);
    return weightedSum / totalWeight;
  }

  /**
   * Handle Python test status updates
   */
  handlePythonTestStatus(status) {
    this.emit("pythonTestStatus", status);
  }

  // =====================================
  // Hybrid Test Execution
  // =====================================

  /**
   * Execute a hybrid test plan
   */
  async executeHybridTest(testPlan) {
    try {
      console.log("🎯 Starting hybrid test execution...");
      this.hybridTestPlan = testPlan;

      const { python = {}, javascript = {}, coordination = {} } = testPlan;

      // Validate test plan
      this.validateTestPlan(testPlan);

      // Execute based on coordination strategy
      if (coordination.sequential) {
        await this.executeSequentialTest(python, javascript, coordination);
      } else {
        await this.executeParallelTest(python, javascript, coordination);
      }

      // Generate combined results
      const results = await this.generateCombinedResults();

      console.log("✅ Hybrid test execution completed");
      this.emit("hybridTestCompleted", results);

      return results;
    } catch (error) {
      console.error("❌ Hybrid test execution failed:", error);
      this.emit("hybridTestFailed", error);
      throw error;
    }
  }

  /**
   * Validate test plan
   */
  validateTestPlan(testPlan) {
    if (!testPlan.python && !testPlan.javascript) {
      throw new Error(
        "Test plan must include at least Python or JavaScript configuration",
      );
    }

    // Validate Python configuration
    if (testPlan.python && !this.pythonBridge.isConnected()) {
      console.warn(
        "⚠️ Python configuration specified but Python bridge not connected",
      );
    }

    // Validate JavaScript configuration
    if (testPlan.javascript) {
      const jsConfig = testPlan.javascript;
      if (jsConfig.protocols) {
        const validProtocols = ["http", "websocket", "graphql", "browser"];
        const invalidProtocols = jsConfig.protocols.filter(
          (p) => !validProtocols.includes(p),
        );
        if (invalidProtocols.length > 0) {
          throw new Error(`Invalid protocols: ${invalidProtocols.join(", ")}`);
        }
      }
    }
  }

  /**
   * Execute sequential test
   */
  async executeSequentialTest(pythonConfig, jsConfig, coordination) {
    const pythonFirst = coordination.pythonFirst !== false;

    if (pythonFirst) {
      // Python first, then JavaScript
      if (pythonConfig && Object.keys(pythonConfig).length > 0) {
        console.log("🐍 Starting Python test phase...");
        await this.executePythonTest(pythonConfig);

        // Wait for Python test to complete
        await this.waitForPythonTestCompletion();
      }

      if (jsConfig && Object.keys(jsConfig).length > 0) {
        console.log("🟨 Starting JavaScript test phase...");
        await this.executeJavaScriptTest(jsConfig);
      }
    } else {
      // JavaScript first, then Python
      if (jsConfig && Object.keys(jsConfig).length > 0) {
        console.log("🟨 Starting JavaScript test phase...");
        await this.executeJavaScriptTest(jsConfig);

        // Wait for JS test to complete
        await this.waitForJavaScriptTestCompletion();
      }

      if (pythonConfig && Object.keys(pythonConfig).length > 0) {
        console.log("🐍 Starting Python test phase...");
        await this.executePythonTest(pythonConfig);
      }
    }
  }

  /**
   * Execute parallel test
   */
  async executeParallelTest(pythonConfig, jsConfig, _coordination) {
    const promises = [];

    // Start Python test
    if (pythonConfig && Object.keys(pythonConfig).length > 0) {
      console.log("🐍 Starting Python test (parallel)...");
      promises.push(this.executePythonTest(pythonConfig));
    }

    // Start JavaScript test
    if (jsConfig && Object.keys(jsConfig).length > 0) {
      console.log("🟨 Starting JavaScript test (parallel)...");
      promises.push(this.executeJavaScriptTest(jsConfig));
    }

    // Wait for all tests to complete
    await Promise.all(promises);
  }

  /**
   * Execute Python test
   */
  async executePythonTest(config) {
    if (!this.pythonBridge.isConnected()) {
      throw new Error("Python bridge not connected");
    }

    try {
      // Update Python configuration
      await this.pythonBridge.updatePythonConfig(config);

      // Start Python test
      const result = await this.pythonBridge.controlPythonTest("start", config);

      console.log("🐍 Python test started:", result);
      return result;
    } catch (error) {
      console.error("❌ Failed to execute Python test:", error);
      throw error;
    }
  }

  /**
   * Execute JavaScript test
   */
  async executeJavaScriptTest(config) {
    const protocols = config.protocols || ["http"];
    const testPromises = [];

    // Start tests for each protocol
    for (const protocol of protocols) {
      try {
        let testPromise;

        switch (protocol) {
          case "http":
            testPromise = this.startHttpTest(config);
            break;
          case "websocket":
            testPromise = this.startWebSocketTest(config);
            break;
          case "graphql":
            testPromise = this.startGraphQLTest(config);
            break;
          case "browser":
            testPromise = this.startBrowserTest(config);
            break;
          default:
            console.warn(`Unknown protocol: ${protocol}`);
            continue;
        }

        testPromises.push(testPromise);
      } catch (error) {
        console.error(`Failed to start ${protocol} test:`, error);
      }
    }

    // Wait for all JavaScript tests to complete
    return Promise.all(testPromises);
  }

  /**
   * Start HTTP test
   */
  async startHttpTest(config) {
    const testConfig = {
      urls: config.targets || config.urls || ["http://example.com"],
      workers: config.workers || this.config.defaultTest.workers,
      duration: config.duration || this.config.defaultTest.duration,
      requestsPerSecond: config.requestsPerSecond,
      ...config.http,
    };

    return this.loadTester.startTest(testConfig);
  }

  /**
   * Start WebSocket test
   */
  async startWebSocketTest(config) {
    const testConfig = {
      urls: config.websocketUrls || ["ws://example.com"],
      connections: config.connections || config.workers || 50,
      duration: config.duration || this.config.defaultTest.duration,
      messagesPerSecond: config.messagesPerSecond,
      ...config.websocket,
    };

    return this.webSocketTester.startTest(testConfig);
  }

  /**
   * Start GraphQL test
   */
  async startGraphQLTest(config) {
    const testConfig = {
      endpoint: config.graphqlEndpoint || "http://example.com/graphql",
      queries: config.graphqlQueries || [],
      workers: config.workers || 25,
      duration: config.duration || this.config.defaultTest.duration,
      ...config.graphql,
    };

    return this.graphqlTester.startTest(testConfig);
  }

  /**
   * Start browser test
   */
  async startBrowserTest(config) {
    const testConfig = {
      scenarios: config.browserScenarios || [],
      browsers: config.browsers || config.workers || 10,
      duration: config.duration || this.config.defaultTest.duration,
      headless: config.headless !== false,
      ...config.browser,
    };

    return this.browserTester.startTest(testConfig);
  }

  /**
   * Wait for Python test completion
   */
  async waitForPythonTestCompletion() {
    return new Promise((resolve) => {
      const checkStatus = async () => {
        try {
          const status = await this.pythonBridge.controlPythonTest("status");
          if (status.status === "stopped" || status.status === "no_test") {
            resolve();
          } else {
            setTimeout(checkStatus, 1000);
          }
        } catch (error) {
          // If we can't get status, assume test is done
          resolve();
        }
      };

      checkStatus();
    });
  }

  /**
   * Wait for JavaScript test completion
   */
  async waitForJavaScriptTestCompletion() {
    return new Promise((resolve) => {
      const checkStatus = () => {
        if (this.activeTests.size === 0) {
          resolve();
        } else {
          setTimeout(checkStatus, 1000);
        }
      };

      checkStatus();
    });
  }

  /**
   * Generate combined results
   */
  async generateCombinedResults() {
    const results = {
      testPlan: this.hybridTestPlan,
      executionTime: Date.now(),
      python: {},
      javascript: {},
      combined: this.combinedMetrics.combined || {},
    };

    // Get Python results
    if (this.pythonBridge.isConnected()) {
      try {
        results.python = await this.pythonBridge.getPythonMetrics();
      } catch (error) {
        console.warn("Failed to get Python results:", error);
        results.python = this.combinedMetrics.python || {};
      }
    }

    // Get JavaScript results
    results.javascript = {};
    for (const [testId, testResult] of this.testResults.entries()) {
      results.javascript[testId] = testResult;
    }

    // Sync results with Python bridge
    if (this.pythonBridge.isConnected()) {
      try {
        await this.pythonBridge.syncTestResults(results.javascript);
      } catch (error) {
        console.warn("Failed to sync results with Python:", error);
      }
    }

    return results;
  }

  // =====================================
  // Control Methods
  // =====================================

  /**
   * Stop all tests
   */
  async stopAllTests() {
    console.log("🛑 Stopping all tests...");

    const promises = [];

    // Stop Python tests
    if (this.pythonBridge.isConnected()) {
      promises.push(this.pythonBridge.controlPythonTest("stop"));
    }

    // Stop JavaScript tests
    promises.push(this.loadTester.stopAllTests());
    promises.push(this.webSocketTester.stopAllTests());
    promises.push(this.graphqlTester.stopAllTests());
    promises.push(this.browserTester.stopAllTests());

    await Promise.allSettled(promises);

    // Clear active tests
    this.activeTests.clear();

    console.log("✅ All tests stopped");
    this.emit("allTestsStopped");
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      pythonConnected: this.pythonBridge.isConnected(),
      activeTests: Array.from(this.activeTests.keys()),
      completedTests: Array.from(this.testResults.keys()),
      combinedMetrics: this.combinedMetrics,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log("🧹 Cleaning up Hybrid Test Orchestrator...");

    // Stop all tests
    await this.stopAllTests();

    // Disconnect from Python bridge
    this.pythonBridge.disconnect();

    // Cleanup test runners
    await Promise.allSettled([
      this.loadTester.cleanup(),
      this.webSocketTester.cleanup(),
      this.graphqlTester.cleanup(),
      this.browserTester.cleanup(),
    ]);

    console.log("✅ Hybrid Test Orchestrator cleaned up");
  }
}

module.exports = HybridTestOrchestrator;
