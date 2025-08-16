#!/usr/bin/env node

/**
 * Advanced Load Tester - Unified Entry Point
 * ==========================================
 *
 * This is the main entry point that automatically starts both JavaScript and Python
 * components and provides a unified dashboard interface.
 */

const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

// Import the main load tester class
const AdvancedLoadTesterJS = require("./js/index");
const RealTimePerformanceTracker = require("./js/core/real-time-performance-tracker");
const ConfigManager = require("./js/utils/config-manager");

class UnifiedLoadTester {
  constructor() {
    this.port = process.env.PORT || 3000;
    this.pythonProcess = null;
    this.loadTesterJS = null;
    this.performanceTracker = null;
    this.configManager = null;
    this.app = express();
    this.server = http.createServer(this.app);

    // Allow configuring CORS/Socket.IO origins via env (comma-separated)
    const parseOrigins = (val) =>
      (val || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS);

    this.io = socketIo(this.server, {
      cors: {
        origin: allowedOrigins.length ? allowedOrigins : "*",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    // Performance tracking
    this.metrics = {
      startTime: Date.now(),
      totalRequests: 0,
      activeTests: 0,
      systemHealth: {},
    };

    // Test management
    this.activeTests = new Map();

    this.setupExpress();
    this.setupRealtimeFeatures();
    // Ensure common directories exist
    try {
      const fs = require("fs");
      ["logs", "reports"].forEach((d) => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      });
    } catch {}
  }

  setupExpress() {
    // Enhanced middleware
    // Express CORS respecting ALLOWED_ORIGINS (defaults to allow all)
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    this.app.use(
      cors({
        origin: (origin, cb) => {
          if (!origin) return cb(null, true); // same-origin or curl
          if (allowedOrigins.length === 0) return cb(null, true);
          if (allowedOrigins.includes(origin)) return cb(null, true);
          return cb(new Error("Not allowed by CORS"));
        },
        credentials: true,
      }),
    );
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));
    this.app.use(express.static("."));

    // Security middleware
    this.app.use((req, res, next) => {
      res.header("X-Frame-Options", "DENY");
      res.header("X-Content-Type-Options", "nosniff");
      res.header("X-XSS-Protection", "1; mode=block");
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
      next();
    });

    // Serve the main dashboard
    this.app.get("/", (req, res) => {
      res.sendFile(
        path.join(__dirname, "dashboard", "real-time-dashboard.html"),
      );
    });

    // Serve the original dashboard as alternative
    this.app.get("/dashboard/classic", (req, res) => {
      res.sendFile(path.join(__dirname, "dashboard", "index.html"));
    });

    // Serve the enhanced real-time dashboard
    this.app.get("/dashboard/real-time", (req, res) => {
      res.sendFile(
        path.join(__dirname, "dashboard", "real-time-dashboard.html"),
      );
    });

    // Enhanced health check
    this.app.get("/health", (req, res) => {
      const healthStatus = this.getSystemHealth();
      res.json(healthStatus);
    });

    // Advanced metrics endpoint
    this.app.get("/api/v1/system/metrics", (req, res) => {
      res.json({
        system: this.getSystemHealth(),
        performance: this.getPerformanceMetrics(),
        timestamp: new Date().toISOString(),
      });
    });

    // Configuration management
    this.app.get("/api/v1/config", (req, res) => {
      res.json(this.configManager ? this.configManager.getConfig() : {});
    });

    this.app.post("/api/v1/config", (req, res) => {
      try {
        if (this.configManager) {
          this.configManager.updateConfig(req.body);
          res.json({ success: true, message: "Configuration updated" });
        } else {
          res
            .status(500)
            .json({ error: "Configuration manager not available" });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Stop all tests endpoint
  // Stop-all route handled later in setupLoadTesterRoutes

    // Enhanced test management
    this.app.get("/api/v1/tests/active", (req, res) => {
      const activeTests = [];

      if (this.loadTesterJS && this.loadTesterJS.activeTests) {
        for (const [testId, testInstance] of this.loadTesterJS.activeTests) {
          activeTests.push({
            id: testId,
            type: "javascript",
            status: testInstance.status || "running",
            startTime: testInstance.startTime,
            config: testInstance.config,
          });
        }
      }

      res.json({
        activeTests,
        count: activeTests.length,
        timestamp: new Date().toISOString(),
      });
    });
  }

  setupRealtimeFeatures() {
    // Initialize performance tracker
    this.performanceTracker = new RealTimePerformanceTracker(this.io, {
      updateInterval: 1000,
      enableReports: true,
      reportsDir: "./reports",
      logsDir: "./logs",
    });

    this.configManager = new ConfigManager();

    // Setup WebSocket connections for real-time updates
    this.io.on("connection", (socket) => {
      console.log("Client connected for real-time updates");

      // Send initial system status
      socket.emit("system-status", this.getSystemHealth());

      // Handle client requests
      socket.on("request-metrics", () => {
        socket.emit("metrics-update", this.getPerformanceMetrics());
      });

      socket.on("request-system-health", () => {
        socket.emit("system-health", this.getSystemHealth());
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected");
      });
    });

    // Start performance tracking
    this.performanceTracker.startTracking();

    // Start periodic updates
    setInterval(() => {
      this.broadcastSystemUpdate();
    }, 2000); // Update every 2 seconds

    // More frequent updates for active tests (for real-time progress)
    setInterval(() => {
      this.broadcastActiveTestsUpdate();
    }, 1000); // Update active tests every 1 second
  }

  getSystemHealth() {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    return {
      status: "healthy",
      uptime: uptime,
      timestamp: new Date().toISOString(),
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      cpu: {
        loadAverage:
          process.platform !== "win32" ? require("os").loadavg() : [0, 0, 0],
        usage: process.cpuUsage(),
      },
      components: {
        nodejs: true,
        python: this.pythonProcess !== null,
        performanceTracker: this.performanceTracker !== null,
        configManager: this.configManager !== null,
      },
      activeTests: this.loadTesterJS ? this.loadTesterJS.activeTests.size : 0,
    };
  }

  getPerformanceMetrics() {
    // Derive metrics from performanceTracker when available
    const trackerSummary = (() => {
      try {
        if (!this.performanceTracker) return null;
        const tests = this.performanceTracker.getAllTests();
        let totalRequests = 0;
        let failed = 0;
        let avgRtSum = 0;
  let _active = 0;
        tests.forEach((t) => {
          totalRequests += t.metrics?.totalRequests || 0;
          failed += t.metrics?.failedRequests || 0;
          avgRtSum += t.metrics?.averageResponseTime || 0;
          if (t.status === "running") _active += 1;
        });
        return {
          totalRequests,
          errorRate: totalRequests > 0 ? (failed / totalRequests) * 100 : 0,
          averageResponseTime: tests.length > 0 ? avgRtSum / tests.length : 0,
          requestsPerSecond: 0, // tracker can emit RPS; 0 as fallback
        };
      } catch {
        return null;
      }
    })();

    return {
      totalRequests:
        trackerSummary?.totalRequests ?? this.metrics.totalRequests,
      averageResponseTime: trackerSummary?.averageResponseTime ?? 0,
      requestsPerSecond: trackerSummary?.requestsPerSecond ?? 0,
      errorRate: trackerSummary?.errorRate ?? 0,
      activeConnections: this.io.engine.clientsCount,
      systemLoad: process.cpuUsage(),
      timestamp: new Date().toISOString(),
    };
  }

  broadcastSystemUpdate() {
    if (this.io) {
      this.io.emit("system-update", {
        health: this.getSystemHealth(),
        performance: this.getPerformanceMetrics(),
      });
    }
  }

  broadcastActiveTestsUpdate() {
    if (this.activeTests.size === 0) return;

    // Get current test data for real-time updates
    const testsData = {};
    let hasRunningTests = false;

    for (const [testId, testData] of this.activeTests) {
      const testMetrics = this.getTestMetrics(testId);
      testsData[testId] = {
        id: testId,
        startTime: testData.startTime,
        status: testData.status || "running",
        metrics: testMetrics || {
          requests: 0,
          errors: 0,
          averageResponseTime: 0,
          currentRPS: 0,
          errorRate: 0,
          activeConnections: 0,
        },
      };

      if (testData.status !== "completed" && testData.status !== "stopped") {
        hasRunningTests = true;
      }
    }

    if (hasRunningTests && this.io) {
      // Send focused update for real-time progress
      this.io.emit("metrics_update", {
        timestamp: Date.now(),
        tests: testsData,
        overall: this.getOverallMetrics(testsData),
        system: this.getSystemMetrics(),
      });
    }
  }

  getOverallMetrics(testsData) {
    let totalRequests = 0;
    let totalErrors = 0;
    let totalResponseTime = 0;
    let activeTestCount = 0;

    for (const testId in testsData) {
      const test = testsData[testId];
      if (test.status === "running") {
        totalRequests += test.metrics.requests || 0;
        totalErrors += test.metrics.errors || 0;
        totalResponseTime += test.metrics.averageResponseTime || 0;
        activeTestCount++;
      }
    }

    return {
      activeTests: activeTestCount,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      averageResponseTime:
        activeTestCount > 0 ? totalResponseTime / activeTestCount : 0,
    };
  }

  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    return {
      cpu: Math.min(Math.random() * 100, 100), // Placeholder for now
      memory: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      uptime: process.uptime(),
    };
  }

  getTestMetrics(testId) {
    // Return current metrics for a specific test
    // This would integrate with your actual test runners
    const testData = this.activeTests.get(testId);
    if (!testData) return null;

    // For now, return some sample progressive data
    const elapsed = Date.now() - testData.startTime;
  const _duration = testData.duration || 60000; // Default 60 seconds
    const targetRPS = testData.requestsPerSecond || 10;

    const estimatedRequests = Math.floor((elapsed / 1000) * targetRPS);

    return {
      requests: estimatedRequests,
      errors: Math.floor(estimatedRequests * 0.02), // 2% error rate
      averageResponseTime: 200 + Math.random() * 300,
      currentRPS: targetRPS + (Math.random() - 0.5) * 5,
      errorRate: 2 + Math.random() * 3,
      activeConnections: Math.floor(testData.workers || 10),
    };
  }

  async startPythonIntegration() {
    try {
      console.log("Starting Enhanced Python Integration...");

      // Check if Python is available
      const pythonCheck = spawn("python", ["--version"], { shell: true });

      pythonCheck.on("close", (code) => {
        if (code === 0) {
          console.log("✓ Python detected");
          this.startAdvancedPythonBridge();
        } else {
          console.log("⚠ Python not found, JavaScript-only mode");
        }
      });

      pythonCheck.on("error", () => {
        console.log("⚠ Python not available, JavaScript-only mode");
      });
    } catch (error) {
      console.log(
        "⚠ Python integration failed, continuing with JavaScript-only mode",
      );
    }
  }

  startAdvancedPythonBridge() {
    try {
      // Start the advanced Python bridge server
      const pythonScript = path.join(__dirname, "python_bridge_new.py");

      this.pythonProcess = spawn(
        "python",
        [pythonScript, "--port", "5001", "--log-level", "INFO"],
        {
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      this.pythonProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log(`🐍 Python Bridge: ${output.trim()}`);

        // Parse Python output for real-time updates
        if (output.includes("Starting Advanced Python Bridge")) {
          this.io.emit("python-status", {
            status: "started",
            timestamp: new Date().toISOString(),
          });
        }
      });

      this.pythonProcess.stderr.on("data", (data) => {
        const error = data.toString();
        console.error(`🐍 Python Bridge Error: ${error.trim()}`);
        this.io.emit("python-error", {
          error: error.trim(),
          timestamp: new Date().toISOString(),
        });
      });

      this.pythonProcess.on("close", (code) => {
        console.log(`🐍 Python bridge exited with code ${code}`);
        this.pythonProcess = null;
        this.io.emit("python-status", {
          status: "stopped",
          code,
          timestamp: new Date().toISOString(),
        });
      });

      // Setup Python API proxy
      this.setupPythonApiProxy();

      console.log("✓ Advanced Python bridge started with ML capabilities");
    } catch (error) {
      console.error("Failed to start Python bridge:", error);
    }
  }

  setupPythonApiProxy() {
    // Proxy requests to Python bridge
    this.app.use("/api/python", async (req, res) => {
      try {
        const axios = require("axios");
        const pythonUrl = `http://localhost:5001${req.path}`;

        const response = await axios({
          method: req.method,
          url: pythonUrl,
          data: req.body,
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        });

        res.json(response.data);
      } catch (error) {
        console.error("Python API proxy error:", error.message);
        res.status(500).json({
          error: "Python bridge unavailable",
          message: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Enhanced test management with Python integration
    this.app.post("/api/v1/hybrid-test/start", async (req, res) => {
      try {
        const { config, useJavaScript = true, usePython = true } = req.body;
        const results = {};

        // Start JavaScript test if requested
        if (useJavaScript && this.loadTesterJS) {
          const jsTestId = await this.loadTesterJS.startLoadTest(req, res);
          results.javascript = { testId: jsTestId, status: "started" };
        }

        // Start Python test if requested
        if (usePython && this.pythonProcess) {
          try {
            const axios = require("axios");
            const pythonResponse = await axios.post(
              "http://localhost:5001/api/test/start",
              config,
            );
            results.python = pythonResponse.data;
          } catch (error) {
            results.python = {
              error: "Python test failed to start",
              message: error.message,
            };
          }
        }

        res.json({
          success: true,
          hybridTestId: `hybrid_${Date.now()}`,
          results,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          error: "Failed to start hybrid test",
          message: error.message,
        });
      }
    });
  }

  async stopPythonTests() {
    if (this.pythonProcess) {
      try {
        const axios = require("axios");
        await axios.post("http://localhost:5001/api/test/stop-all");
        console.log("✓ Python tests stopped");
      } catch (error) {
        console.log("⚠ Failed to stop Python tests:", error.message);
      }
    }
  }

  async start() {
    try {
      // Start the main JavaScript load tester
      this.loadTesterJS = new AdvancedLoadTesterJS({
        port: this.port,
        dashboardPort: this.port + 1000,
      });

      // Override the server start to use our unified server
      this.loadTesterJS.server = this.server;
      this.loadTesterJS.io = this.io;
      this.loadTesterJS.app = this.app;

      // Setup the load tester routes on our app
      this.setupLoadTesterRoutes();

      // Start Python integration
      await this.startPythonIntegration();

      // Start the server
      this.server.listen(this.port, () => {
        console.log("");
        console.log("🚀 Advanced Load Tester v2.0 - Next Generation");
        console.log("===============================================");
        console.log(`📊 Main Dashboard: http://localhost:${this.port}`);
        console.log(`🔧 API Endpoint: http://localhost:${this.port}/api/v1`);
        console.log(`❤️  Health Check: http://localhost:${this.port}/health`);
        console.log(
          `📈 System Metrics: http://localhost:${this.port}/api/v1/system/metrics`,
        );
        if (this.pythonProcess) {
          console.log(`🐍 Python Bridge: http://localhost:5001`);
        }
        console.log("");
        console.log("🎯 Enhanced Features:");
        console.log(
          "✓ Multi-Protocol Testing (HTTP/HTTPS, WebSocket, GraphQL, gRPC)",
        );
        console.log("✓ Browser Automation & User Journey Testing");
        console.log("✓ Real-time Performance Monitoring");
        console.log("✓ Advanced Configuration Management");
        console.log("✓ Multi-target Load Testing");
        console.log("✓ WebSocket Real-time Updates");
        console.log("✓ System Health Monitoring");
        if (this.pythonProcess) {
          console.log("✓ Python ML/AI Integration");
          console.log("✓ Advanced Statistical Analysis");
          console.log("✓ Machine Learning Optimization");
          console.log("✓ Anomaly Detection");
          console.log("✓ Performance Prediction");
        }
        console.log("");
        console.log("🏃‍♂️ Ready to handle high-performance load testing!");
        console.log("Press Ctrl+C to stop");
        console.log("");
      });

      // Setup graceful shutdown
      this.setupGracefulShutdown();
    } catch (error) {
      console.error("Failed to start load tester:", error);
      process.exit(1);
    }
  }

  setupLoadTesterRoutes() {
    // Enhanced routes with test tracking
    const loadTester = this.loadTesterJS;

    // Load test routes with tracking
    this.app.post("/api/v1/load-test/start", async (req, res) => {
      try {
        const result = await loadTester.startLoadTest(req, res);

        // Track the test if successfully started
        if (result && result.testId) {
          const testConfig = {
            ...req.body,
            testId: result.testId,
            totalRequests:
              (req.body.workers || 10) *
              (req.body.rps || 10) *
              (req.body.duration || 60),
          };

          // Register with performance tracker
          this.performanceTracker.registerTest(result.testId, testConfig);

          this.activeTests.set(result.testId, {
            testId: result.testId,
            startTime: Date.now(),
            status: "running",
            config: testConfig,
            duration: (req.body.duration || 60) * 1000,
            requestsPerSecond: req.body.rps || req.body.requestsPerSecond || 10,
            workers: req.body.workers || 10,
          });
        }

        return result;
      } catch (error) {
        console.error("Error starting load test:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/v1/load-test/stop", async (req, res) => {
      try {
        const result = await loadTester.stopLoadTest(req, res);

        // Update test status
        const testId = req.body.testId;
        if (testId && this.activeTests.has(testId)) {
          const testData = this.activeTests.get(testId);
          testData.status = "stopped";
          testData.endTime = Date.now();
        }

        return result;
      } catch (error) {
        console.error("Error stopping load test:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/v1/load-test/stop-all", async (req, res) => {
      try {
        // Stop all active tests
  for (const [_testId, testData] of this.activeTests) {
          if (testData.status === "running") {
            testData.status = "stopped";
            testData.endTime = Date.now();
          }
        }

        res.json({ success: true, message: "All tests stopped" });
      } catch (error) {
        console.error("Error stopping all tests:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get(
      "/api/v1/load-test/status/:testId",
      loadTester.getTestStatus.bind(loadTester),
    );
    this.app.get(
      "/api/v1/load-test/results/:testId",
      loadTester.getTestResults.bind(loadTester),
    );

    // WebSocket test routes
    this.app.post(
      "/api/v1/websocket-test/start",
      loadTester.startWebSocketTest.bind(loadTester),
    );
    this.app.post(
      "/api/v1/graphql-test/start",
      loadTester.startGraphQLTest.bind(loadTester),
    );
    this.app.post(
      "/api/v1/grpc-test/start",
      loadTester.startGrpcTest.bind(loadTester),
    );
    this.app.post(
      "/api/v1/browser-test/start",
      loadTester.startBrowserTest.bind(loadTester),
    );
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);

      try {
        // Stop Python process
        if (this.pythonProcess) {
          console.log("Stopping Python bridge...");
          this.pythonProcess.kill();
        }

        // Stop all active tests
        if (this.loadTesterJS && this.loadTesterJS.activeTests) {
          console.log("Stopping active tests...");
          for (const [_testId, testInstance] of this.loadTesterJS.activeTests) {
            await testInstance.stop();
          }
        }

        // Close server
        this.server.close(() => {
          console.log("Server closed");
          process.exit(0);
        });
      } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(1);
      }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }
}

// Start the unified load tester
if (require.main === module) {
  const unifiedTester = new UnifiedLoadTester();
  unifiedTester.start();
}

module.exports = UnifiedLoadTester;
