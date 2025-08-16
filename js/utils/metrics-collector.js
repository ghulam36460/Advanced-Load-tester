/**
 * Metrics Collector - Advanced Performance Analytics
 * ================================================
 *
 * Comprehensive metrics collection and analysis:
 * - Real-time data aggregation
 * - Statistical analysis
 * - Performance benchmarking
 * - Trend analysis
 * - Export capabilities
 */

const { EventEmitter } = require("events");
const fs = require("fs").promises;
const path = require("path");

class MetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      aggregationInterval: options.aggregationInterval || 1000,
      retentionPeriod: options.retentionPeriod || 24 * 60 * 60 * 1000, // 24 hours
      maxDataPoints: options.maxDataPoints || 10000,
      enablePersistence: options.enablePersistence !== false,
      outputDirectory: options.outputDirectory || "../results",
      ...options,
    };

    this.testMetrics = new Map(); // testId -> metrics
    this.timeSeriesData = new Map(); // testId -> time series data
    this.aggregatedData = new Map(); // testId -> aggregated statistics
    this.intervals = new Map(); // testId -> interval handles
  }

  async initialize() {
    // Create output directory if it doesn't exist
    if (this.options.enablePersistence) {
      try {
        await fs.mkdir(this.options.outputDirectory, { recursive: true });
      } catch (error) {
        console.warn("Could not create output directory:", error.message);
      }
    }
  }

  startCollection(testId) {
    if (this.intervals.has(testId)) {
      return; // Already collecting
    }

    // Initialize metrics storage
    this.testMetrics.set(testId, {
      startTime: Date.now(),
      endTime: null,
      requests: [],
      responses: [],
      errors: [],
      connections: [],
      system: [],
    });

    this.timeSeriesData.set(testId, {
      timestamps: [],
      requestsPerSecond: [],
      responseTime: [],
      errorRate: [],
      throughput: [],
      activeConnections: [],
      cpuUsage: [],
      memoryUsage: [],
    });

    this.aggregatedData.set(testId, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      medianResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      throughput: 0,
      errorRate: 0,
      responseTimes: [],
      statusCodes: new Map(),
      errorTypes: new Map(),
    });

    // Start periodic aggregation
    const interval = setInterval(() => {
      this.aggregateMetrics(testId);
    }, this.options.aggregationInterval);

    this.intervals.set(testId, interval);

    this.emit("collection_started", testId);
  }

  stopCollection(testId) {
    const interval = this.intervals.get(testId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(testId);
    }

    // Final aggregation
    this.aggregateMetrics(testId);

    // Mark end time
    const metrics = this.testMetrics.get(testId);
    if (metrics) {
      metrics.endTime = Date.now();
    }

    // Persist data if enabled
    if (this.options.enablePersistence) {
      this.persistMetrics(testId);
    }

    this.emit("collection_stopped", testId);
  }

  recordRequest(testId, requestData) {
    const metrics = this.testMetrics.get(testId);
    if (!metrics) return;

    metrics.requests.push({
      timestamp: Date.now(),
      ...requestData,
    });

    // Update aggregated data
    const aggregated = this.aggregatedData.get(testId);
    if (aggregated) {
      aggregated.totalRequests++;

      if (requestData.success) {
        aggregated.successfulRequests++;
      } else {
        aggregated.failedRequests++;
      }

      if (requestData.responseTime) {
        aggregated.responseTimes.push(requestData.responseTime);
        aggregated.minResponseTime = Math.min(
          aggregated.minResponseTime,
          requestData.responseTime,
        );
        aggregated.maxResponseTime = Math.max(
          aggregated.maxResponseTime,
          requestData.responseTime,
        );
      }

      if (requestData.statusCode) {
        const count = aggregated.statusCodes.get(requestData.statusCode) || 0;
        aggregated.statusCodes.set(requestData.statusCode, count + 1);
      }

      if (requestData.error) {
        const errorType = requestData.error.type || "Unknown";
        const count = aggregated.errorTypes.get(errorType) || 0;
        aggregated.errorTypes.set(errorType, count + 1);
      }
    }

    this.emit("request_recorded", testId, requestData);
  }

  recordResponse(testId, responseData) {
    const metrics = this.testMetrics.get(testId);
    if (!metrics) return;

    metrics.responses.push({
      timestamp: Date.now(),
      ...responseData,
    });

    this.emit("response_recorded", testId, responseData);
  }

  recordError(testId, errorData) {
    const metrics = this.testMetrics.get(testId);
    if (!metrics) return;

    metrics.errors.push({
      timestamp: Date.now(),
      ...errorData,
    });

    this.emit("error_recorded", testId, errorData);
  }

  recordConnection(testId, connectionData) {
    const metrics = this.testMetrics.get(testId);
    if (!metrics) return;

    metrics.connections.push({
      timestamp: Date.now(),
      ...connectionData,
    });

    this.emit("connection_recorded", testId, connectionData);
  }

  recordSystemMetrics(testId, systemData) {
    const metrics = this.testMetrics.get(testId);
    if (!metrics) return;

    metrics.system.push({
      timestamp: Date.now(),
      ...systemData,
    });

    this.emit("system_metrics_recorded", testId, systemData);
  }

  aggregateMetrics(testId) {
    const metrics = this.testMetrics.get(testId);
    const timeSeries = this.timeSeriesData.get(testId);
    const aggregated = this.aggregatedData.get(testId);

    if (!metrics || !timeSeries || !aggregated) return;

    const now = Date.now();
    const windowStart = now - this.options.aggregationInterval;

    // Calculate requests per second
    const recentRequests = metrics.requests.filter(
      (r) => r.timestamp >= windowStart,
    );
    const requestsPerSecond =
      recentRequests.length / (this.options.aggregationInterval / 1000);

    // Calculate average response time for recent requests
    const recentResponseTimes = recentRequests
      .filter((r) => r.responseTime)
      .map((r) => r.responseTime);

    const averageResponseTime =
      recentResponseTimes.length > 0
        ? recentResponseTimes.reduce((sum, time) => sum + time, 0) /
          recentResponseTimes.length
        : 0;

    // Calculate error rate
    const recentErrors = recentRequests.filter((r) => !r.success).length;
    const errorRate =
      recentRequests.length > 0
        ? (recentErrors / recentRequests.length) * 100
        : 0;

    // Calculate throughput (bytes per second)
    const throughput =
      recentRequests.reduce((sum, r) => sum + (r.bytesReceived || 0), 0) /
      (this.options.aggregationInterval / 1000);

    // Get active connections
    const activeConnections = metrics.connections.filter(
      (c) => c.active,
    ).length;

    // Update time series
    timeSeries.timestamps.push(now);
    timeSeries.requestsPerSecond.push(requestsPerSecond);
    timeSeries.responseTime.push(averageResponseTime);
    timeSeries.errorRate.push(errorRate);
    timeSeries.throughput.push(throughput);
    timeSeries.activeConnections.push(activeConnections);

    // Add system metrics if available
    const recentSystemMetrics = metrics.system.filter(
      (s) => s.timestamp >= windowStart,
    );
    if (recentSystemMetrics.length > 0) {
      const latestSystem = recentSystemMetrics[recentSystemMetrics.length - 1];
      timeSeries.cpuUsage.push(latestSystem.cpuUsage || 0);
      timeSeries.memoryUsage.push(latestSystem.memoryUsage || 0);
    } else {
      timeSeries.cpuUsage.push(0);
      timeSeries.memoryUsage.push(0);
    }

    // Trim time series data to max data points
    this.trimTimeSeries(timeSeries);

    // Update aggregated statistics
    this.updateAggregatedStats(aggregated);

    this.emit("metrics_aggregated", testId, {
      requestsPerSecond,
      averageResponseTime,
      errorRate,
      throughput,
      activeConnections,
    });
  }

  trimTimeSeries(timeSeries) {
    const maxPoints = this.options.maxDataPoints;

    Object.keys(timeSeries).forEach((key) => {
      if (
        Array.isArray(timeSeries[key]) &&
        timeSeries[key].length > maxPoints
      ) {
        timeSeries[key] = timeSeries[key].slice(-maxPoints);
      }
    });
  }

  updateAggregatedStats(aggregated) {
    if (aggregated.responseTimes.length > 0) {
      // Sort for percentile calculations
      const sorted = aggregated.responseTimes.slice().sort((a, b) => a - b);

      aggregated.averageResponseTime =
        aggregated.responseTimes.reduce((sum, time) => sum + time, 0) /
        aggregated.responseTimes.length;

      aggregated.medianResponseTime = this.calculatePercentile(sorted, 50);
      aggregated.p95ResponseTime = this.calculatePercentile(sorted, 95);
      aggregated.p99ResponseTime = this.calculatePercentile(sorted, 99);
    }

    // Calculate overall error rate
    aggregated.errorRate =
      aggregated.totalRequests > 0
        ? (aggregated.failedRequests / aggregated.totalRequests) * 100
        : 0;

    // Calculate throughput
    aggregated.throughput = aggregated.successfulRequests; // This could be refined
  }

  calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;

    const index = Math.ceil((sortedArray.length * percentile) / 100) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  getMetrics(testId) {
    const metrics = this.testMetrics.get(testId);
    const timeSeries = this.timeSeriesData.get(testId);
    const aggregated = this.aggregatedData.get(testId);

    if (!metrics || !timeSeries || !aggregated) {
      return null;
    }

    return {
      testId,
      startTime: metrics.startTime,
      endTime: metrics.endTime,
      duration: metrics.endTime
        ? metrics.endTime - metrics.startTime
        : Date.now() - metrics.startTime,
      timeSeries: this.getRecentTimeSeries(timeSeries, 100), // Last 100 data points
      aggregated: {
        ...aggregated,
        statusCodes: Object.fromEntries(aggregated.statusCodes),
        errorTypes: Object.fromEntries(aggregated.errorTypes),
        responseTimes: undefined, // Don't include raw data in summary
      },
      summary: this.generateSummary(aggregated),
    };
  }

  getRecentTimeSeries(timeSeries, count = 100) {
    const recent = {};

    Object.keys(timeSeries).forEach((key) => {
      if (Array.isArray(timeSeries[key])) {
        recent[key] = timeSeries[key].slice(-count);
      }
    });

    return recent;
  }

  getCompleteResults(testId) {
    const metrics = this.testMetrics.get(testId);
    const timeSeries = this.timeSeriesData.get(testId);
    const aggregated = this.aggregatedData.get(testId);

    if (!metrics || !timeSeries || !aggregated) {
      return null;
    }

    return {
      testId,
      startTime: metrics.startTime,
      endTime: metrics.endTime,
      duration: metrics.endTime
        ? metrics.endTime - metrics.startTime
        : Date.now() - metrics.startTime,
      timeSeries,
      aggregated: {
        ...aggregated,
        statusCodes: Object.fromEntries(aggregated.statusCodes),
        errorTypes: Object.fromEntries(aggregated.errorTypes),
      },
      summary: this.generateSummary(aggregated),
      rawData: {
        requestCount: metrics.requests.length,
        responseCount: metrics.responses.length,
        errorCount: metrics.errors.length,
        connectionCount: metrics.connections.length,
        systemMetricCount: metrics.system.length,
      },
    };
  }

  generateSummary(aggregated) {
    return {
      totalRequests: aggregated.totalRequests,
      successfulRequests: aggregated.successfulRequests,
      failedRequests: aggregated.failedRequests,
      successRate:
        aggregated.totalRequests > 0
          ? (
              (aggregated.successfulRequests / aggregated.totalRequests) *
              100
            ).toFixed(2) + "%"
          : "0%",
      errorRate: aggregated.errorRate.toFixed(2) + "%",
      averageResponseTime: aggregated.averageResponseTime.toFixed(2) + "ms",
      medianResponseTime: aggregated.medianResponseTime.toFixed(2) + "ms",
      p95ResponseTime: aggregated.p95ResponseTime.toFixed(2) + "ms",
      p99ResponseTime: aggregated.p99ResponseTime.toFixed(2) + "ms",
      minResponseTime:
        aggregated.minResponseTime === Infinity
          ? "0ms"
          : aggregated.minResponseTime.toFixed(2) + "ms",
      maxResponseTime: aggregated.maxResponseTime.toFixed(2) + "ms",
      throughput: aggregated.throughput,
    };
  }

  async persistMetrics(testId) {
    try {
      const results = this.getCompleteResults(testId);
      if (!results) return;

      const filename = `test_${testId}_${Date.now()}.json`;
      const filepath = path.join(this.options.outputDirectory, filename);

      await fs.writeFile(filepath, JSON.stringify(results, null, 2));

      this.emit("metrics_persisted", testId, filepath);
    } catch (error) {
      console.error(
        `Failed to persist metrics for test ${testId}:`,
        error.message,
      );
      this.emit("persistence_error", testId, error);
    }
  }

  async exportMetrics(testId, format = "json") {
    const results = this.getCompleteResults(testId);
    if (!results) {
      throw new Error(`No metrics found for test ${testId}`);
    }

    switch (format.toLowerCase()) {
      case "json":
        return JSON.stringify(results, null, 2);

      case "csv":
        return this.exportToCSV(results);

      case "html":
        return this.exportToHTML(results);

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  exportToCSV(results) {
    // Export time series data as CSV
    const timeSeries = results.timeSeries;
    if (!timeSeries.timestamps.length) return "";

    const headers = [
      "timestamp",
      "requestsPerSecond",
      "responseTime",
      "errorRate",
      "throughput",
      "activeConnections",
    ];
    const rows = [headers.join(",")];

    for (let i = 0; i < timeSeries.timestamps.length; i++) {
      const row = [
        new Date(timeSeries.timestamps[i]).toISOString(),
        timeSeries.requestsPerSecond[i] || 0,
        timeSeries.responseTime[i] || 0,
        timeSeries.errorRate[i] || 0,
        timeSeries.throughput[i] || 0,
        timeSeries.activeConnections[i] || 0,
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  exportToHTML(results) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Load Test Results - ${results.testId}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .metric { margin: 5px 0; }
        .chart { width: 100%; height: 300px; background: #fff; border: 1px solid #ddd; margin: 10px 0; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Load Test Results</h1>
    <div class="summary">
        <h2>Summary</h2>
        <div class="metric"><strong>Test ID:</strong> ${results.testId}</div>
        <div class="metric"><strong>Duration:</strong> ${(results.duration / 1000).toFixed(2)}s</div>
        <div class="metric"><strong>Total Requests:</strong> ${results.summary.totalRequests}</div>
        <div class="metric"><strong>Success Rate:</strong> ${results.summary.successRate}</div>
        <div class="metric"><strong>Average Response Time:</strong> ${results.summary.averageResponseTime}</div>
        <div class="metric"><strong>Throughput:</strong> ${results.summary.throughput}</div>
    </div>
    
    <h2>Detailed Statistics</h2>
    <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Successful Requests</td><td>${results.summary.successfulRequests}</td></tr>
        <tr><td>Failed Requests</td><td>${results.summary.failedRequests}</td></tr>
        <tr><td>Error Rate</td><td>${results.summary.errorRate}</td></tr>
        <tr><td>Median Response Time</td><td>${results.summary.medianResponseTime}</td></tr>
        <tr><td>95th Percentile</td><td>${results.summary.p95ResponseTime}</td></tr>
        <tr><td>99th Percentile</td><td>${results.summary.p99ResponseTime}</td></tr>
        <tr><td>Min Response Time</td><td>${results.summary.minResponseTime}</td></tr>
        <tr><td>Max Response Time</td><td>${results.summary.maxResponseTime}</td></tr>
    </table>
</body>
</html>
        `;
  }

  clearMetrics(testId) {
    this.testMetrics.delete(testId);
    this.timeSeriesData.delete(testId);
    this.aggregatedData.delete(testId);

    const interval = this.intervals.get(testId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(testId);
    }

    this.emit("metrics_cleared", testId);
  }

  getAllTestIds() {
    return Array.from(this.testMetrics.keys());
  }

  destroy() {
    // Clear all intervals
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }

    // Clear all data
    this.testMetrics.clear();
    this.timeSeriesData.clear();
    this.aggregatedData.clear();
    this.intervals.clear();
  }
}

module.exports = MetricsCollector;
