/**
 * Advanced Load Tester - Main Node.js Entry Point
 * ===============================================
 *
 * This is the main Node.js component that provides JavaScript-based
 * load testing capabilities and integrates with the Python framework.
 */

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const winston = require("winston");
// Ensure logs directory exists for file transports and compute absolute paths
let LOG_ERROR_PATH = null;
let LOG_COMBINED_PATH = null;
try {
  const fs = require("fs");
  const path = require("path");
  const logsDir = path.resolve(__dirname, "..", "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  LOG_ERROR_PATH = path.join(logsDir, "error.log");
  LOG_COMBINED_PATH = path.join(logsDir, "combined.log");
} catch (_err) {
  // optional: logs dir pre-creation failure can be ignored
}
const { v4: uuidv4 } = require("uuid");

// Simplified load tester - only include essential modules that exist
const LoadTester = require("./core/load-tester");
const WebSocketTester = require("./core/websocket-tester");
const GraphQLTester = require("./core/graphql-tester");
let GrpcTester = null;
try {
  GrpcTester = require("./core/grpc-tester");
} catch (_e) {
  // Optional dependency not installed; gRPC routes will be disabled gracefully
  GrpcTester = null;
}
// const BrowserTester = require('./core/browser-tester'); // Temporarily disabled to avoid circular dependency
const MetricsCollector = require("./utils/metrics-collector");

// Configure logging
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "advanced-load-tester" },
  transports: [
    new winston.transports.File({
      filename: LOG_ERROR_PATH || "logs/error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: LOG_COMBINED_PATH || "logs/combined.log",
    }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

class AdvancedLoadTesterJS {
  constructor(options = {}) {
    this.options = {
      port: process.env.PORT || 3000,
      dashboardPort: process.env.DASHBOARD_PORT || 8080,
      redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
      enableClustering: process.env.ENABLE_CLUSTERING === "true",
      maxWorkers:
        parseInt(process.env.MAX_WORKERS) || require("os").cpus().length,
      ...options,
    };

    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.loadTester = new LoadTester();
    this.webSocketTester = new WebSocketTester();
    this.graphqlTester = new GraphQLTester();
    this.grpcTester = GrpcTester ? new GrpcTester() : null;
    // this.browserTester = new BrowserTester(); // Temporarily disabled
    this.browserTester = null; // Placeholder
    this.metricsCollector = new MetricsCollector();

    this.activeTests = new Map();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  // Basic validators for specific test types
  validateWebSocketConfig(config) {
    const errors = [];
    if (!config || typeof config !== 'object') {
      errors.push('config must be an object');
    } else {
      if (!config.url || typeof config.url !== 'string') {
        errors.push('url is required and must be a string');
      } else if (!/^wss?:\/\//i.test(config.url)) {
        errors.push('url must start with ws:// or wss://');
      }
      if (config.connections && (!Number.isInteger(config.connections) || config.connections < 1)) {
        errors.push('connections must be a positive integer');
      }
      if (config.messagesPerSecond && (typeof config.messagesPerSecond !== 'number' || config.messagesPerSecond < 0)) {
        errors.push('messagesPerSecond must be a non-negative number');
      }
    }
    return { valid: errors.length === 0, errors };
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());

    // Logging middleware
    this.app.use(
      morgan("combined", {
        stream: { write: (message) => logger.info(message.trim()) },
      }),
    );

    // Body parsing middleware
    this.app.use(express.json({ limit: "50mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "50mb" }));

    // Static file serving
    this.app.use("/static", express.static("../dashboard/static"));
    this.app.use("/results", express.static("../results"));
  }

  setupRoutes() {
    // Health check
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: require("../package.json").version,
      });
    });

    // API Routes - simplified, main routes handled in app.js
    // Basic test endpoints are implemented in app.js

    // Load test endpoints
    this.app.post("/api/v1/load-test/start", this.startLoadTest.bind(this));
    this.app.post("/api/v1/load-test/stop", this.stopLoadTest.bind(this));
    this.app.get(
      "/api/v1/load-test/status/:testId",
      this.getTestStatus.bind(this),
    );
    this.app.get(
      "/api/v1/load-test/results/:testId",
      this.getTestResults.bind(this),
    );

    // WebSocket test endpoints
    this.app.post(
      "/api/v1/websocket-test/start",
      this.startWebSocketTest.bind(this),
    );
    this.app.post(
      "/api/v1/graphql-test/start",
      this.startGraphQLTest.bind(this),
    );
    this.app.post("/api/v1/grpc-test/start", this.startGrpcTest.bind(this));
    this.app.post(
      "/api/v1/browser-test/start",
      this.startBrowserTest.bind(this),
    );

    // Hybrid testing routes
    this.app.post("/api/v1/hybrid/test/start", this.startHybridTest.bind(this));
    this.app.post("/api/v1/hybrid/test/stop", this.stopHybridTest.bind(this));
    this.app.get("/api/v1/hybrid/status", this.getHybridStatus.bind(this));
    this.app.get("/api/v1/hybrid/metrics", this.getHybridMetrics.bind(this));
    this.app.post(
      "/api/v1/hybrid/python/execute",
      this.executePythonCode.bind(this),
    );
    this.app.get(
      "/api/v1/hybrid/python/metrics",
      this.getPythonMetrics.bind(this),
    );
    this.app.post(
      "/api/v1/hybrid/python/config",
      this.updatePythonConfig.bind(this),
    );
    this.app.post("/api/v1/metrics/sync", this.syncMetrics.bind(this));

    // Dashboard route
    this.app.get("/", (req, res) => {
      const path = require("path");
      // Prefer real-time dashboard if present
      const rt = path.join(__dirname, "../dashboard/real-time-dashboard.html");
      res.sendFile(rt);
    });

    // Error handling
  this.app.use((err, req, res, _next) => {
      logger.error("Express error:", err);
      res.status(500).json({
        error: "Internal server error",
        message: err.message,
        timestamp: new Date().toISOString(),
      });
    });
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      socket.on("subscribe_metrics", (testId) => {
        socket.join(`metrics_${testId}`);
        logger.info(
          `Client ${socket.id} subscribed to metrics for test ${testId}`,
        );
      });

      socket.on("unsubscribe_metrics", (testId) => {
        socket.leave(`metrics_${testId}`);
        logger.info(
          `Client ${socket.id} unsubscribed from metrics for test ${testId}`,
        );
      });

      socket.on("get_active_tests", () => {
        socket.emit("active_tests", Array.from(this.activeTests.keys()));
      });

      socket.on("disconnect", () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });
  }

  async startLoadTest(req, res) {
    try {
      const testConfig = req.body;
      const testId = uuidv4();

      // Validate configuration
      const validationResult = this.validateTestConfig(testConfig);
      if (!validationResult.valid) {
        return res.status(400).json({
          error: "Invalid configuration",
          details: validationResult.errors,
        });
      }

      // Start the test
      const testInstance = await this.loadTester.createTest(testId, testConfig);
      this.activeTests.set(testId, testInstance);

      // Start metrics collection
      this.metricsCollector.startCollection(testId);

      // Start the test execution
      testInstance.start().catch((err) => {
        logger.error(`Test ${testId} failed:`, err);
        this.activeTests.delete(testId);
      });

      res.json({
        testId,
        status: "started",
        config: testConfig,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Load test started: ${testId}`);
    } catch (error) {
      logger.error("Failed to start load test:", error);
      res.status(500).json({
        error: "Failed to start test",
        message: error.message,
      });
    }
  }

  async stopLoadTest(req, res) {
    try {
      const { testId } = req.body;
      const testInstance = this.activeTests.get(testId);

      if (!testInstance) {
        return res.status(404).json({
          error: "Test not found",
          testId,
        });
      }

      await testInstance.stop();
      this.activeTests.delete(testId);
      this.metricsCollector.stopCollection(testId);

      res.json({
        testId,
        status: "stopped",
        timestamp: new Date().toISOString(),
      });

      logger.info(`Load test stopped: ${testId}`);
    } catch (error) {
      logger.error("Failed to stop load test:", error);
      res.status(500).json({
        error: "Failed to stop test",
        message: error.message,
      });
    }
  }

  async getTestStatus(req, res) {
    try {
      const { testId } = req.params;
      const testInstance = this.activeTests.get(testId);

      if (!testInstance) {
        return res.status(404).json({
          error: "Test not found",
          testId,
        });
      }

      const status = await testInstance.getStatus();
      const metrics = this.metricsCollector.getMetrics(testId);

      res.json({
        testId,
        status,
        metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get test status:", error);
      res.status(500).json({
        error: "Failed to get test status",
        message: error.message,
      });
    }
  }

  async getTestResults(req, res) {
    try {
      const { testId } = req.params;
      const results = await this.metricsCollector.getCompleteResults(testId);

      if (!results) {
        return res.status(404).json({
          error: "Results not found",
          testId,
        });
      }

      res.json({
        testId,
        results,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get test results:", error);
      res.status(500).json({
        error: "Failed to get test results",
        message: error.message,
      });
    }
  }

  async startWebSocketTest(req, res) {
    try {
      const testConfig = req.body;
      const testId = uuidv4();

      // Validate WebSocket configuration before starting
      const wsValidation = this.validateWebSocketConfig(testConfig || {});
      if (!wsValidation.valid) {
        return res.status(400).json({
          error: "Invalid WebSocket configuration",
          details: wsValidation.errors,
        });
      }

      const testInstance = await this.webSocketTester.createTest(
        testId,
        testConfig,
      );
      this.activeTests.set(testId, testInstance);

      testInstance.start().catch((err) => {
        logger.error(`WebSocket test ${testId} failed:`, err);
        this.activeTests.delete(testId);
      });

      res.json({
        testId,
        status: "started",
        type: "websocket",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to start WebSocket test:", error);
      res.status(500).json({
        error: "Failed to start WebSocket test",
        message: error.message,
      });
    }
  }

  async startGraphQLTest(req, res) {
    try {
      const testConfig = req.body;
      const testId = uuidv4();

      const testInstance = await this.graphqlTester.createTest(
        testId,
        testConfig,
      );
      this.activeTests.set(testId, testInstance);

      testInstance.start().catch((err) => {
        logger.error(`GraphQL test ${testId} failed:`, err);
        this.activeTests.delete(testId);
      });

      res.json({
        testId,
        status: "started",
        type: "graphql",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to start GraphQL test:", error);
      res.status(500).json({
        error: "Failed to start GraphQL test",
        message: error.message,
      });
    }
  }

  async startGrpcTest(req, res) {
    try {
      const testConfig = req.body;
      const testId = uuidv4();
      if (!this.grpcTester) {
        return res.status(503).json({
          error:
            "gRPC tester not available (optional dependencies not installed)",
        });
      }

      const testInstance = await this.grpcTester.createTest(testId, testConfig);
      this.activeTests.set(testId, testInstance);

      testInstance.start().catch((err) => {
        logger.error(`gRPC test ${testId} failed:`, err);
        this.activeTests.delete(testId);
      });

      res.json({
        testId,
        status: "started",
        type: "grpc",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to start gRPC test:", error);
      res.status(500).json({
        error: "Failed to start gRPC test",
        message: error.message,
      });
    }
  }

  async startBrowserTest(req, res) {
    try {
      const testConfig = req.body;
      const testId = uuidv4();
      if (!this.browserTester) {
        return res.status(503).json({
          error:
            "Browser tester not available (puppeteer not installed or disabled)",
        });
      }

      const testInstance = await this.browserTester.createTest(
        testId,
        testConfig,
      );
      this.activeTests.set(testId, testInstance);

      testInstance.start().catch((err) => {
        logger.error(`Browser test ${testId} failed:`, err);
        this.activeTests.delete(testId);
      });

      res.json({
        testId,
        status: "started",
        type: "browser",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to start browser test:", error);
      res.status(500).json({
        error: "Failed to start browser test",
        message: error.message,
      });
    }
  }

  validateTestConfig(config) {
    const errors = [];

    // Check for either targets array or url
    if (!config.targets && !config.url) {
      errors.push("Either targets array or url must be provided");
    }

    // If targets is provided, validate it
    if (
      config.targets &&
      (!Array.isArray(config.targets) || config.targets.length === 0)
    ) {
      errors.push("targets must be a non-empty array");
    }
  // Note: WebSocket-specific config is validated in startWebSocketTest()

    // If url is provided, validate it
    if (config.url && typeof config.url !== "string") {
      errors.push("url must be a string");
    }

    if (
      config.workers &&
      (typeof config.workers !== "number" || config.workers < 1)
    ) {
      errors.push("workers must be a positive number");
    }

    if (
      config.duration &&
      (typeof config.duration !== "number" || config.duration < 1)
    ) {
      errors.push("duration must be a positive number");
    }

    if (config.rps && (typeof config.rps !== "number" || config.rps < 1)) {
      errors.push("rps (requests per second) must be a positive number");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // Removed duplicate start() with undefined monitor/proxyManager; see single start() below

  // =====================================
  // Hybrid Testing Methods
  // =====================================

  async startHybridTest(req, res) {
    try {
      const testPlan = req.body;

      if (!this.hybridOrchestrator) {
        return res.status(503).json({
          error: "Hybrid orchestrator not available",
        });
      }

      const testId = uuidv4();

      // Execute hybrid test
      const results = await this.hybridOrchestrator.executeHybridTest(testPlan);

      res.json({
        testId,
        status: "completed",
        results,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to start hybrid test:", error);
      res.status(500).json({
        error: "Failed to start hybrid test",
        message: error.message,
      });
    }
  }

  async stopHybridTest(req, res) {
    try {
      if (!this.hybridOrchestrator) {
        return res.status(503).json({
          error: "Hybrid orchestrator not available",
        });
      }

      await this.hybridOrchestrator.stopAllTests();

      res.json({
        status: "stopped",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to stop hybrid test:", error);
      res.status(500).json({
        error: "Failed to stop hybrid test",
        message: error.message,
      });
    }
  }

  async getHybridStatus(req, res) {
    try {
      if (!this.hybridOrchestrator) {
        return res.status(503).json({
          error: "Hybrid orchestrator not available",
        });
      }

      const status = this.hybridOrchestrator.getStatus();

      res.json({
        ...status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get hybrid status:", error);
      res.status(500).json({
        error: "Failed to get hybrid status",
        message: error.message,
      });
    }
  }

  async getHybridMetrics(req, res) {
    try {
      if (!this.hybridOrchestrator) {
        return res.status(503).json({
          error: "Hybrid orchestrator not available",
        });
      }

      const metrics = this.hybridOrchestrator.combinedMetrics;

      res.json({
        metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get hybrid metrics:", error);
      res.status(500).json({
        error: "Failed to get hybrid metrics",
        message: error.message,
      });
    }
  }

  async executePythonCode(req, res) {
    try {
      const { code, context } = req.body;

      if (!this.pythonBridge || !this.pythonBridge.isConnected()) {
        return res.status(503).json({
          error: "Python bridge not connected",
        });
      }

      const result = await this.pythonBridge.executePythonCode(code, context);

      res.json({
        result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to execute Python code:", error);
      res.status(500).json({
        error: "Failed to execute Python code",
        message: error.message,
      });
    }
  }

  async getPythonMetrics(req, res) {
    try {
      if (!this.pythonBridge || !this.pythonBridge.isConnected()) {
        return res.status(503).json({
          error: "Python bridge not connected",
        });
      }

      const metrics = await this.pythonBridge.getPythonMetrics();

      res.json({
        metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get Python metrics:", error);
      res.status(500).json({
        error: "Failed to get Python metrics",
        message: error.message,
      });
    }
  }

  async updatePythonConfig(req, res) {
    try {
      const config = req.body;

      if (!this.pythonBridge || !this.pythonBridge.isConnected()) {
        return res.status(503).json({
          error: "Python bridge not connected",
        });
      }

      const result = await this.pythonBridge.updatePythonConfig(config);

      res.json({
        result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to update Python config:", error);
      res.status(500).json({
        error: "Failed to update Python config",
        message: error.message,
      });
    }
  }

  async syncMetrics(req, res) {
    try {
      const { metrics, source } = req.body;

      // Process metrics sync from Python
      if (source === "python" && this.hybridOrchestrator) {
        this.hybridOrchestrator.handlePythonMetrics(metrics);
      }

      res.json({
        status: "synced",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to sync metrics:", error);
      res.status(500).json({
        error: "Failed to sync metrics",
        message: error.message,
      });
    }
  }

  async start() {
    try {
      // Initialize hybrid orchestrator
      if (this.hybridOrchestrator) {
        await this.hybridOrchestrator.initialize();
      }

      // Start server
      this.server.listen(this.options.port, () => {
        logger.info(
          `Advanced Load Tester JS started on port ${this.options.port}`,
        );
        logger.info(
          `Dashboard available at http://localhost:${this.options.port}`,
        );

        if (this.pythonBridge) {
          logger.info("Python bridge integration enabled");
          this.pythonBridge.connect().catch((err) => {
            logger.warn("Python bridge connection failed:", err.message);
          });
        }
      });
    } catch (error) {
      logger.error("Failed to start Advanced Load Tester JS:", error);
      throw error;
    }
  }

  async stop() {
    try {
      // Stop all active tests
  for (const [_testId, testInstance] of this.activeTests) {
        await testInstance.stop();
      }
      this.activeTests.clear();

      // Stop hybrid orchestrator
      if (this.hybridOrchestrator) {
        await this.hybridOrchestrator.cleanup();
      }

      // Disconnect Python bridge
      if (this.pythonBridge) {
        this.pythonBridge.disconnect();
      }

      // Stop monitoring if present
      if (this.monitor && typeof this.monitor.stop === "function") {
        await this.monitor.stop();
      }

      // Close server
      this.server.close();

      logger.info("Advanced Load Tester JS stopped");
    } catch (error) {
      logger.error("Error stopping Advanced Load Tester JS:", error);
    }
  }
}

// Handle process signals
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  if (process.loadTesterInstance) {
    await process.loadTesterInstance.stop();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  if (process.loadTesterInstance) {
    await process.loadTesterInstance.stop();
  }
  process.exit(0);
});

// Guard against unexpected errors causing process exit
process.on('unhandledRejection', (reason) => {
  try {
    logger.error('Unhandled Rejection:', reason);
  } catch (e) { console.error('Unhandled Rejection:', reason); }
});

process.on('uncaughtException', (err) => {
  try {
    logger.error('Uncaught Exception:', err);
  } catch (e) { console.error('Uncaught Exception:', err); }
});

// Start the application if this file is run directly
if (require.main === module) {
  const loadTester = new AdvancedLoadTesterJS();
  process.loadTesterInstance = loadTester;
  loadTester.start().catch((error) => {
    logger.error("Failed to start application:", error);
    process.exit(1);
  });
}

module.exports = AdvancedLoadTesterJS;
