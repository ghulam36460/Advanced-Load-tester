/**
 * Real-Time Performance Tracker - Modern Implementation
 * ====================================================
 *
 * Features:
 * - Real-time progress bars and metrics
 * - Python + JS integration
 * - Downloadable reports and logs
 * - Live performance visualization
 * - No matplotlib dependency
 */

const { EventEmitter } = require("events");
const fs = require("fs").promises;
const path = require("path");

class RealTimePerformanceTracker extends EventEmitter {
  constructor(io, options = {}) {
    super();

    this.io = io;
    this.options = {
      updateInterval: 1000, // 1 second updates
      dataRetention: 300000, // 5 minutes of data retention
      enableLogging: true,
      enableReports: true,
      reportsDir: "./reports",
      logsDir: "./logs",
      ...options,
    };

    this.activeTests = new Map();
    this.performanceData = new Map();
    this.systemMetrics = {
      cpu: 0,
      memory: 0,
      timestamp: Date.now(),
    };

    this.isTracking = false;
    this.trackingInterval = null;

    this.initializeDirectories();
  }

  async initializeDirectories() {
    try {
      await fs.mkdir(this.options.reportsDir, { recursive: true });
      await fs.mkdir(this.options.logsDir, { recursive: true });
    } catch (error) {
      console.error("Error creating directories:", error);
    }
  }

  async startTracking() {
    if (this.isTracking) return;

    this.isTracking = true;
    this.trackingInterval = setInterval(() => {
      this.updateRealTimeMetrics();
    }, this.options.updateInterval);

    console.log("🚀 Real-time performance tracking started");
    this.emit("tracking_started");
  }

  async stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }

    console.log("⏹️ Real-time performance tracking stopped");
    this.emit("tracking_stopped");
  }

  registerTest(testId, testConfig = {}) {
    const testData = {
      id: testId,
      config: testConfig,
      startTime: Date.now(),
      endTime: null,
      status: "running",
      progress: {
        percentage: 0,
        requestsSent: 0,
        requestsCompleted: 0,
        requestsTotal:
          testConfig.totalRequests ||
          testConfig.workers *
            testConfig.requestsPerSecond *
            testConfig.duration ||
          1000,
        timeElapsed: 0,
        timeTotal: testConfig.duration * 1000 || 60000,
      },
      metrics: {
        totalRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        currentRPS: 0,
        errorRate: 0,
        throughput: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        statusCodes: {},
        responseTimeDistribution: [],
      },
      realTimeData: [],
      logs: [],
    };

    this.activeTests.set(testId, testData);
    this.performanceData.set(testId, []);

    this.broadcastTestUpdate(testId, "test_started", testData);
    this.logEvent(testId, "Test started", testConfig);

    return testData;
  }

  updateTestProgress(testId, progressUpdate) {
    const test = this.activeTests.get(testId);
    if (!test) return;

    const timeElapsed = Date.now() - test.startTime;
    const timeTotal = test.progress.timeTotal;
    const timePercentage = Math.min((timeElapsed / timeTotal) * 100, 100);

    // Update progress
    Object.assign(test.progress, {
      ...progressUpdate,
      timeElapsed,
      percentage: Math.max(
        timePercentage,
        (progressUpdate.requestsCompleted / test.progress.requestsTotal) * 100,
      ),
    });

    // Check if test is complete
    if (test.progress.percentage >= 100 || timeElapsed >= timeTotal) {
      test.status = "completed";
      test.endTime = Date.now();
      this.logEvent(testId, "Test completed");
    }

    this.broadcastTestUpdate(testId, "progress_updated", test.progress);
  }

  updateTestMetrics(testId, metricsUpdate) {
    const test = this.activeTests.get(testId);
    if (!test) return;

    const timestamp = Date.now();

    // Update metrics
    Object.assign(test.metrics, metricsUpdate);

    // Calculate derived metrics
    if (test.metrics.totalRequests > 0) {
      test.metrics.errorRate =
        (test.metrics.failedRequests / test.metrics.totalRequests) * 100;
    }

    // Update response time statistics
    if (metricsUpdate.responseTime) {
      test.metrics.minResponseTime = Math.min(
        test.metrics.minResponseTime,
        metricsUpdate.responseTime,
      );
      test.metrics.maxResponseTime = Math.max(
        test.metrics.maxResponseTime,
        metricsUpdate.responseTime,
      );
      test.metrics.responseTimeDistribution.push({
        timestamp,
        responseTime: metricsUpdate.responseTime,
      });
    }

    // Store real-time data point
    const dataPoint = {
      timestamp,
      rps: test.metrics.currentRPS,
      responseTime: test.metrics.averageResponseTime,
      errorRate: test.metrics.errorRate,
      activeConnections: test.metrics.activeConnections || 0,
    };

    test.realTimeData.push(dataPoint);

    // Clean old data
    const cutoff = timestamp - this.options.dataRetention;
    test.realTimeData = test.realTimeData.filter((d) => d.timestamp > cutoff);
    test.metrics.responseTimeDistribution =
      test.metrics.responseTimeDistribution.filter((d) => d.timestamp > cutoff);

    this.broadcastTestUpdate(testId, "metrics_updated", test.metrics);
  }

  updateRealTimeMetrics() {
    const summary = this.generateRealTimeSummary();

    // Broadcast to all connected clients
    this.io.emit("realtime_update", {
      timestamp: Date.now(),
      tests: summary.tests,
      overall: summary.overall,
      system: this.systemMetrics,
    });

    // Update system metrics
    this.updateSystemMetrics();
  }

  generateRealTimeSummary() {
    const tests = {};
    let totalRPS = 0;
    let totalActiveTests = 0;
    let totalRequests = 0;
    let totalErrors = 0;
    let avgResponseTime = 0;

    for (const [testId, test] of this.activeTests) {
      const progress = this.calculateProgress(test);

      tests[testId] = {
        id: testId,
        status: test.status,
        progress,
        metrics: test.metrics,
        recentData: test.realTimeData.slice(-30), // Last 30 data points
        config: test.config,
      };

      if (test.status === "running") {
        totalActiveTests++;
        totalRPS += test.metrics.currentRPS || 0;
      }

      totalRequests += test.metrics.totalRequests || 0;
      totalErrors += test.metrics.failedRequests || 0;
      avgResponseTime += test.metrics.averageResponseTime || 0;
    }

    const overall = {
      activeTests: totalActiveTests,
      totalTests: this.activeTests.size,
      totalRPS,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      averageResponseTime:
        this.activeTests.size > 0 ? avgResponseTime / this.activeTests.size : 0,
    };

    return { tests, overall };
  }

  calculateProgress(test) {
    const timeElapsed = Date.now() - test.startTime;
    const timeTotal = test.progress.timeTotal;
    const timePercentage = Math.min((timeElapsed / timeTotal) * 100, 100);

    const requestPercentage =
      test.progress.requestsTotal > 0
        ? (test.progress.requestsCompleted / test.progress.requestsTotal) * 100
        : 0;

    return {
      ...test.progress,
      timeElapsed,
      timePercentage,
      requestPercentage,
      overallPercentage: Math.max(timePercentage, requestPercentage),
      estimatedTimeRemaining: this.calculateETA(test),
    };
  }

  calculateETA(test) {
    if (test.status !== "running") return 0;

    const timeElapsed = Date.now() - test.startTime;
    const progress = test.progress.percentage;

    if (progress <= 0) return test.progress.timeTotal;

    const estimatedTotal = (timeElapsed / progress) * 100;
    return Math.max(0, estimatedTotal - timeElapsed);
  }

  updateSystemMetrics() {
    const os = require("os");

    try {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;

      this.systemMetrics = {
        cpu: process.cpuUsage().user / 1000000, // Convert to percentage
        memory: memoryUsage,
        timestamp: Date.now(),
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
      };
    } catch (error) {
      console.error("Error updating system metrics:", error);
    }
  }

  async generateReport(testId) {
    const test = this.activeTests.get(testId);
    if (!test) return null;

    const report = {
      testId,
      config: test.config,
      startTime: test.startTime,
      endTime: test.endTime || Date.now(),
      duration: (test.endTime || Date.now()) - test.startTime,
      status: test.status,
      summary: {
        totalRequests: test.metrics.totalRequests,
        completedRequests: test.metrics.completedRequests,
        failedRequests: test.metrics.failedRequests,
        averageResponseTime: test.metrics.averageResponseTime,
        minResponseTime:
          test.metrics.minResponseTime === Infinity
            ? 0
            : test.metrics.minResponseTime,
        maxResponseTime: test.metrics.maxResponseTime,
        errorRate: test.metrics.errorRate,
        throughput: test.metrics.throughput,
        statusCodes: test.metrics.statusCodes,
      },
      performanceData: test.realTimeData,
      responseTimeDistribution: test.metrics.responseTimeDistribution,
      logs: test.logs,
      generatedAt: Date.now(),
    };

    if (this.options.enableReports) {
      await this.saveReport(testId, report);
    }

    return report;
  }

  async saveReport(testId, report) {
    try {
      const filename = `report_${testId}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filepath = path.join(this.options.reportsDir, filename);

      await fs.writeFile(filepath, JSON.stringify(report, null, 2));

      console.log(`📊 Report saved: ${filepath}`);
      this.logEvent(testId, "Report generated", { filepath });

      return filepath;
    } catch (error) {
      console.error("Error saving report:", error);
      return null;
    }
  }

  async exportLogs(testId) {
    const test = this.activeTests.get(testId);
    if (!test) return null;

    try {
      const filename = `logs_${testId}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filepath = path.join(this.options.logsDir, filename);

      await fs.writeFile(filepath, JSON.stringify(test.logs, null, 2));

      console.log(`📋 Logs exported: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error("Error exporting logs:", error);
      return null;
    }
  }

  async exportCSV(testId) {
    const test = this.activeTests.get(testId);
    if (!test) return null;

    try {
      const csvData = this.convertToCSV(test.realTimeData);
      const filename = `data_${testId}_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      const filepath = path.join(this.options.reportsDir, filename);

      await fs.writeFile(filepath, csvData);

      console.log(`📈 CSV exported: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error("Error exporting CSV:", error);
      return null;
    }
  }

  convertToCSV(data) {
    if (!data || data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(",")];

    for (const row of data) {
      const values = headers.map((header) => {
        const value = row[header];
        return typeof value === "string" ? `"${value}"` : value;
      });
      csvRows.push(values.join(","));
    }

    return csvRows.join("\n");
  }

  logEvent(testId, message, data = null) {
    const logEntry = {
      timestamp: Date.now(),
      testId,
      message,
      data,
    };

    const test = this.activeTests.get(testId);
    if (test) {
      test.logs.push(logEntry);
    }

    if (this.options.enableLogging) {
      console.log(
        `[${new Date().toISOString()}] ${testId}: ${message}`,
        data || "",
      );
    }

    this.emit("log_entry", logEntry);
  }

  broadcastTestUpdate(testId, eventType, data = null) {
    this.io.emit("test_update", {
      testId,
      eventType,
      data,
      timestamp: Date.now(),
    });

    this.emit("test_update", { testId, eventType, data });
  }

  completeTest(testId) {
    const test = this.activeTests.get(testId);
    if (!test) return;

    test.status = "completed";
    test.endTime = Date.now();
    test.progress.percentage = 100;

    this.logEvent(testId, "Test completed");
    this.broadcastTestUpdate(testId, "test_completed", test);

    // Generate final report
    this.generateReport(testId);
  }

  getTest(testId) {
    return this.activeTests.get(testId);
  }

  getAllTests() {
    return Array.from(this.activeTests.values());
  }

  getTestReport(testId) {
    return this.generateReport(testId);
  }

  async cleanup() {
    await this.stopTracking();
    this.activeTests.clear();
    this.performanceData.clear();
  }
}

module.exports = RealTimePerformanceTracker;
