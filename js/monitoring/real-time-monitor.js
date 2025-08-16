/**
 * Real-Time Monitor - Live Performance Monitoring
 * =============================================
 *
 * Advanced real-time monitoring system:
 * - Live metrics streaming
 * - Alert system
 * - Performance thresholds
 * - Dashboard integration
 * - WebSocket broadcasting
 */

const { EventEmitter } = require("events");
const os = require("os");

class RealTimeMonitor extends EventEmitter {
  constructor(io, options = {}) {
    super();

    this.io = io; // Socket.IO instance
    this.options = {
      monitoringInterval: options.monitoringInterval || 1000,
      systemMetricsInterval: options.systemMetricsInterval || 5000,
      alertThresholds: {
        responseTime: options.responseTimeThreshold || 5000,
        errorRate: options.errorRateThreshold || 10,
        cpuUsage: options.cpuUsageThreshold || 80,
        memoryUsage: options.memoryUsageThreshold || 80,
        ...options.alertThresholds,
      },
      enableAlerts: options.enableAlerts !== false,
      enableSystemMonitoring: options.enableSystemMonitoring !== false,
      ...options,
    };

    this.activeTests = new Map();
    this.systemMetrics = {
      cpu: 0,
      memory: 0,
      loadAverage: [0, 0, 0],
      uptime: 0,
      platform: os.platform(),
      architecture: os.arch(),
      nodeVersion: process.version,
    };

    this.alerts = [];
    this.monitoringInterval = null;
    this.systemInterval = null;
  }

  async start() {
    // Start monitoring intervals
    this.startMonitoring();

    if (this.options.enableSystemMonitoring) {
      this.startSystemMonitoring();
    }

    console.log("Real-time monitoring started");
    this.emit("monitoring_started");
  }

  async stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.systemInterval) {
      clearInterval(this.systemInterval);
      this.systemInterval = null;
    }

    console.log("Real-time monitoring stopped");
    this.emit("monitoring_stopped");
  }

  startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      this.collectAndBroadcastMetrics();
    }, this.options.monitoringInterval);
  }

  startSystemMonitoring() {
    this.systemInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.systemMetricsInterval);
  }

  registerTest(testId, testConfig = {}) {
    this.activeTests.set(testId, {
      id: testId,
      config: testConfig,
      startTime: Date.now(),
      metrics: {
        requests: 0,
        responses: 0,
        errors: 0,
        averageResponseTime: 0,
        currentRPS: 0,
        errorRate: 0,
        throughput: 0,
        activeConnections: 0,
      },
      recentData: {
        requests: [],
        responses: [],
        errors: [],
      },
      alerts: [],
    });

    this.broadcastTestUpdate(testId, "test_registered");
    this.emit("test_registered", testId);
  }

  unregisterTest(_testId) {
    if (this.activeTests.has(_testId)) {
      this.activeTests.delete(_testId);
      this.broadcastTestUpdate(_testId, "test_unregistered");
      this.emit("test_unregistered", _testId);
    }
  }

  updateTestMetrics(_testId, metricsUpdate) {
    const test = this.activeTests.get(_testId);
    if (!test) return;

    // Update test metrics
    Object.assign(test.metrics, metricsUpdate);

    // Store recent data for trend analysis
    const now = Date.now();

    if (metricsUpdate.requests !== undefined) {
      test.recentData.requests.push({
        timestamp: now,
        value: metricsUpdate.requests,
      });
    }

    if (metricsUpdate.responses !== undefined) {
      test.recentData.responses.push({
        timestamp: now,
        value: metricsUpdate.responses,
      });
    }

    if (metricsUpdate.errors !== undefined) {
      test.recentData.errors.push({
        timestamp: now,
        value: metricsUpdate.errors,
      });
    }

    // Keep only recent data (last 5 minutes)
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    test.recentData.requests = test.recentData.requests.filter(
      (d) => d.timestamp > fiveMinutesAgo,
    );
    test.recentData.responses = test.recentData.responses.filter(
      (d) => d.timestamp > fiveMinutesAgo,
    );
    test.recentData.errors = test.recentData.errors.filter(
      (d) => d.timestamp > fiveMinutesAgo,
    );

    // Check for alerts
    if (this.options.enableAlerts) {
      this.checkAlerts(_testId, test);
    }

    this.emit("test_metrics_updated", _testId, metricsUpdate);
  }

  collectAndBroadcastMetrics() {
    const summary = this.generateSummary();

    // Broadcast to all connected clients
    this.io.emit("metrics_update", {
      timestamp: Date.now(),
      system: this.systemMetrics,
      tests: summary.tests,
      overall: summary.overall,
      alerts: this.alerts.slice(-10), // Last 10 alerts
    });

    this.emit("metrics_broadcasted", summary);
  }

  collectSystemMetrics() {
    try {
      // CPU usage calculation
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;

      cpus.forEach((cpu) => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });

      const idle = totalIdle / cpus.length;
      const total = totalTick / cpus.length;
      const cpuUsage = 100 - ~~((100 * idle) / total);

      // Memory usage
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsage = (usedMemory / totalMemory) * 100;

      // Update system metrics
      this.systemMetrics = {
        ...this.systemMetrics,
        cpu: cpuUsage,
        memory: memoryUsage,
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
        totalMemory,
        freeMemory,
        usedMemory,
      };

      // Check system alerts
      if (this.options.enableAlerts) {
        this.checkSystemAlerts();
      }

      this.emit("system_metrics_updated", this.systemMetrics);
    } catch (error) {
      console.error("Error collecting system metrics:", error);
    }
  }

  generateSummary() {
    const tests = {};
    let totalRequests = 0;
    let totalErrors = 0;
    let totalActiveConnections = 0;
    let avgResponseTime = 0;
    let testsCount = 0;

    for (const [_testId, test] of this.activeTests) {
      const testSummary = {
        id: _testId,
        startTime: test.startTime,
        duration: Date.now() - test.startTime,
        status: this.getTestStatus(test),
        metrics: { ...test.metrics },
        trends: this.calculateTrends(test),
        alerts: test.alerts.slice(-5), // Last 5 alerts for this test
      };

      tests[_testId] = testSummary;

      // Aggregate for overall summary
      totalRequests += test.metrics.requests || 0;
      totalErrors += test.metrics.errors || 0;
      totalActiveConnections += test.metrics.activeConnections || 0;
      avgResponseTime += test.metrics.averageResponseTime || 0;
      testsCount++;
    }

    const overall = {
      activeTests: testsCount,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      averageResponseTime: testsCount > 0 ? avgResponseTime / testsCount : 0,
      totalActiveConnections,
      systemHealth: this.getSystemHealth(),
    };

    return { tests, overall };
  }

  getTestStatus(test) {
    const now = Date.now();
    const recentActivity =
      test.recentData.requests.filter((r) => now - r.timestamp < 10000).length > // Last 10 seconds
      0;

    if (recentActivity) {
      return "running";
    } else if (test.metrics.requests > 0) {
      return "completed";
    } else {
      return "idle";
    }
  }

  calculateTrends(test) {
    const trends = {
      requestTrend: "stable",
      responseTrend: "stable",
      errorTrend: "stable",
    };

    // Calculate request trend
    if (test.recentData.requests.length >= 2) {
      const recent = test.recentData.requests.slice(-5);
      const older = test.recentData.requests.slice(-10, -5);

      if (recent.length > 0 && older.length > 0) {
        const recentAvg =
          recent.reduce((sum, r) => sum + r.value, 0) / recent.length;
        const olderAvg =
          older.reduce((sum, r) => sum + r.value, 0) / older.length;

        const change = ((recentAvg - olderAvg) / olderAvg) * 100;

        if (change > 10) {
          trends.requestTrend = "increasing";
        } else if (change < -10) {
          trends.requestTrend = "decreasing";
        }
      }
    }

    // Similar calculations for response and error trends...

    return trends;
  }

  getSystemHealth() {
    const cpu = this.systemMetrics.cpu;
    const memory = this.systemMetrics.memory;

    if (cpu > 90 || memory > 90) {
      return "critical";
    } else if (cpu > 70 || memory > 70) {
      return "warning";
    } else {
      return "healthy";
    }
  }

  checkAlerts(_testId, test) {
    const thresholds = this.options.alertThresholds;
    const metrics = test.metrics;

    // Response time alert
    if (metrics.averageResponseTime > thresholds.responseTime) {
      this.createAlert(
        _testId,
        "high_response_time",
        `High response time: ${metrics.averageResponseTime.toFixed(2)}ms (threshold: ${thresholds.responseTime}ms)`,
      );
    }

    // Error rate alert
    if (metrics.errorRate > thresholds.errorRate) {
      this.createAlert(
        _testId,
        "high_error_rate",
        `High error rate: ${metrics.errorRate.toFixed(2)}% (threshold: ${thresholds.errorRate}%)`,
      );
    }

    // Custom alert conditions can be added here...
  }

  checkSystemAlerts() {
    const thresholds = this.options.alertThresholds;
    const system = this.systemMetrics;

    // CPU usage alert
    if (system.cpu > thresholds.cpuUsage) {
      this.createAlert(
        "system",
        "high_cpu_usage",
        `High CPU usage: ${system.cpu.toFixed(2)}% (threshold: ${thresholds.cpuUsage}%)`,
      );
    }

    // Memory usage alert
    if (system.memory > thresholds.memoryUsage) {
      this.createAlert(
        "system",
        "high_memory_usage",
        `High memory usage: ${system.memory.toFixed(2)}% (threshold: ${thresholds.memoryUsage}%)`,
      );
    }
  }

  createAlert(testId, type, message, severity = "warning") {
    const alert = {
      id: Date.now() + Math.random(),
      testId,
      type,
      message,
      severity,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.alerts.push(alert);

    // Add to test-specific alerts
    if (testId !== "system") {
      const test = this.activeTests.get(testId);
      if (test) {
        test.alerts.push(alert);
      }
    }

    // Keep only recent alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    // Broadcast alert
    this.io.emit("alert_created", alert);
    this.emit("alert_created", alert);

    console.log(`ALERT [${severity.toUpperCase()}] ${testId}: ${message}`);
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      this.io.emit("alert_acknowledged", alert);
      this.emit("alert_acknowledged", alert);
    }
  }

  broadcastTestUpdate(testId, eventType, data = null) {
    this.io.emit("test_update", {
      testId,
      eventType,
      data,
      timestamp: Date.now(),
    });
  }

  getActiveTests() {
    return Array.from(this.activeTests.keys());
  }

  getTestDetails(testId) {
    const test = this.activeTests.get(testId);
    if (!test) return null;

    return {
      ...test,
      status: this.getTestStatus(test),
      trends: this.calculateTrends(test),
    };
  }

  getAllAlerts(acknowledged = false) {
    return this.alerts.filter((alert) => alert.acknowledged === acknowledged);
  }

  getSystemStatus() {
    return {
      metrics: this.systemMetrics,
      health: this.getSystemHealth(),
      alerts: this.alerts.filter(
        (a) => a.testId === "system" && !a.acknowledged,
      ),
    };
  }

  // Add missing method for compatibility
  getAverageResponseTime() {
    let totalResponseTime = 0;
    let testsCount = 0;

  for (const [_testId, test] of this.activeTests) {
      if (test.metrics.averageResponseTime) {
        totalResponseTime += test.metrics.averageResponseTime;
        testsCount++;
      }
    }

    return testsCount > 0 ? totalResponseTime / testsCount : 0;
  }

  // Add missing method for compatibility
  getRequestsPerSecond() {
    let totalRPS = 0;

  for (const [_testId, test] of this.activeTests) {
      if (test.metrics.currentRPS) {
        totalRPS += test.metrics.currentRPS;
      }
    }

    return totalRPS;
  }

  // Add missing method for compatibility
  getErrorRate() {
    let totalRequests = 0;
    let totalErrors = 0;

  for (const [_testId, test] of this.activeTests) {
      totalRequests += test.metrics.requests || 0;
      totalErrors += test.metrics.errors || 0;
    }

    return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  }

  // Add missing method for compatibility
  getActiveConnections() {
    let totalConnections = 0;

    for (const [_testId, test] of this.activeTests) {
      totalConnections += test.metrics.activeConnections || 0;
    }

    return totalConnections;
  }
}

module.exports = RealTimeMonitor;
