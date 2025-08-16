/**
 * Browser Load Tester - Real Browser Automation Testing
 * ====================================================
 *
 * Advanced browser-based load testing using Puppeteer:
 * - Real browser automation
 * - JavaScript execution testing
 * - SPA navigation
 * - Performance metrics collection
 * - Screenshot capture
 * - Network monitoring
 */

let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch (error) {
  console.warn("Puppeteer not available. Browser testing will be disabled.");
  puppeteer = null;
}

const { EventEmitter } = require("events");
const { performance } = require("perf_hooks");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");

class BrowserTester extends EventEmitter {
  constructor(options = {}) {
    super();

    this.puppeteerAvailable = puppeteer !== null;

    if (!this.puppeteerAvailable) {
      console.warn(
        "BrowserTester initialized without Puppeteer. Browser testing features disabled.",
      );
    }

    this.options = {
      headless: options.headless !== false,
      maxBrowsers: options.maxBrowsers || 10,
      browserTimeout: options.browserTimeout || 60000,
      navigationTimeout: options.navigationTimeout || 30000,
      screenshotPath: options.screenshotPath || "../results/screenshots",
      ...options,
    };

    this.tests = new Map();
    this.browsers = new Map();
    this.browserPool = [];
  }

  async createTest(testId, config) {
    if (!this.puppeteerAvailable) {
      throw new Error(
        "Browser testing not available. Puppeteer is not installed.",
      );
    }
    const test = new BrowserTest(testId, config, this);
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

  async createBrowser(browserOptions = {}) {
    const browser = await puppeteer.launch({
      headless: this.options.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
      ...browserOptions,
    });

    return browser;
  }

  async getBrowser() {
    if (this.browserPool.length > 0) {
      return this.browserPool.pop();
    }

    if (this.browsers.size < this.options.maxBrowsers) {
      const browser = await this.createBrowser();
      const browserId = crypto.randomUUID();
      this.browsers.set(browserId, browser);
      return { browser, browserId };
    }

    // Wait for available browser
    return new Promise((resolve) => {
      const checkForBrowser = () => {
        if (this.browserPool.length > 0) {
          resolve(this.browserPool.pop());
        } else {
          setTimeout(checkForBrowser, 100);
        }
      };
      checkForBrowser();
    });
  }

  releaseBrowser(browserInfo) {
    this.browserPool.push(browserInfo);
  }

  async closeAllBrowsers() {
    for (const browser of this.browsers.values()) {
      try {
        await browser.close();
      } catch (error) {
        console.error("Error closing browser:", error);
      }
    }
    this.browsers.clear();
    this.browserPool = [];
  }
}

class BrowserTest extends EventEmitter {
  constructor(testId, config, tester) {
    super();

    this.testId = testId;
    this.config = {
      scenarios: [],
      workers: 5,
      duration: 60,
      iterationsPerSecond: 1,
      viewport: { width: 1280, height: 720 },
      userAgent: "",
      networkConditions: null,
      captureScreenshots: false,
      captureNetworkLogs: false,
      captureConsoleLogs: false,
      ...config,
    };
    this.tester = tester;

    this.status = "idle";
    this.startTime = null;
    this.endTime = null;
    this.activeSessions = new Map();

    this.metrics = {
      totalIterations: 0,
      successfulIterations: 0,
      failedIterations: 0,
      totalPageLoads: 0,
      successfulPageLoads: 0,
      failedPageLoads: 0,
      averagePageLoadTime: 0,
      minPageLoadTime: Infinity,
      maxPageLoadTime: 0,
      pageLoadTimes: [],
      averageScenarioTime: 0,
      scenarioTimes: [],
      networkRequests: 0,
      networkErrors: 0,
      jsErrors: 0,
      performanceMetrics: [],
      errors: new Map(),
      scenarioStats: new Map(),
    };

    this.screenshots = [];
    this.networkLogs = [];
    this.consoleLogs = [];
  }

  async start() {
    if (this.status !== "idle") {
      throw new Error("Browser test is already running or completed");
    }

    this.status = "starting";
    this.startTime = Date.now();

    try {
      await this.validateConfig();
      await this.createWorkers();

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

    // Stop all sessions
    for (const session of this.activeSessions.values()) {
      try {
        await session.stop();
      } catch (error) {
        console.error("Error stopping browser session:", error);
      }
    }
    this.activeSessions.clear();

    this.endTime = Date.now();
    this.status = "completed";

    this.emit("completed", this.getResults());
  }

  async validateConfig() {
    if (!this.config.scenarios || this.config.scenarios.length === 0) {
      throw new Error("At least one scenario is required");
    }

    // Validate each scenario
    for (const scenario of this.config.scenarios) {
      if (!scenario.steps || scenario.steps.length === 0) {
        throw new Error("Each scenario must have at least one step");
      }

      for (const step of scenario.steps) {
        if (!step.type) {
          throw new Error("Each step must have a type");
        }
      }
    }

    // Create screenshots directory if needed
    if (this.config.captureScreenshots) {
      try {
        await fs.mkdir(this.tester.options.screenshotPath, { recursive: true });
      } catch (error) {
        console.warn("Could not create screenshots directory:", error.message);
      }
    }
  }

  async createWorkers() {
    for (let i = 0; i < this.config.workers; i++) {
      const session = new BrowserSession(i, this.config, this.tester, this);
      this.activeSessions.set(i, session);
    }
  }

  async executeTest() {
    const testDuration = this.config.duration * 1000;
    const endTime = Date.now() + testDuration;

    // Start metrics reporting
    const metricsInterval = setInterval(() => {
      this.calculateMetrics();
      this.emit("metrics_update", this.metrics);
    }, 1000);

    // Start all sessions
    const sessionPromises = Array.from(this.activeSessions.values()).map(
      (session) => session.start(endTime),
    );

    await Promise.allSettled(sessionPromises);

    clearInterval(metricsInterval);
    await this.stop();
  }

  handleSessionMetrics(sessionId, metrics) {
    // Aggregate metrics from session
    this.metrics.totalIterations += metrics.iterations;
    this.metrics.successfulIterations += metrics.successfulIterations;
    this.metrics.failedIterations += metrics.failedIterations;
    this.metrics.totalPageLoads += metrics.pageLoads;
    this.metrics.successfulPageLoads += metrics.successfulPageLoads;
    this.metrics.failedPageLoads += metrics.failedPageLoads;
    this.metrics.networkRequests += metrics.networkRequests;
    this.metrics.networkErrors += metrics.networkErrors;
    this.metrics.jsErrors += metrics.jsErrors;

    // Merge arrays
    this.metrics.pageLoadTimes.push(...metrics.pageLoadTimes);
    this.metrics.scenarioTimes.push(...metrics.scenarioTimes);
    this.metrics.performanceMetrics.push(...metrics.performanceMetrics);

    // Merge error maps
    for (const [error, count] of metrics.errors) {
      this.metrics.errors.set(
        error,
        (this.metrics.errors.get(error) || 0) + count,
      );
    }

    // Merge scenario stats
    for (const [scenario, stats] of metrics.scenarioStats) {
      if (!this.metrics.scenarioStats.has(scenario)) {
        this.metrics.scenarioStats.set(scenario, {
          executions: 0,
          successful: 0,
          failed: 0,
          totalTime: 0,
        });
      }
      const currentStats = this.metrics.scenarioStats.get(scenario);
      currentStats.executions += stats.executions;
      currentStats.successful += stats.successful;
      currentStats.failed += stats.failed;
      currentStats.totalTime += stats.totalTime;
    }

    // Store additional data
    if (metrics.screenshots) {
      this.screenshots.push(...metrics.screenshots);
    }
    if (metrics.networkLogs) {
      this.networkLogs.push(...metrics.networkLogs);
    }
    if (metrics.consoleLogs) {
      this.consoleLogs.push(...metrics.consoleLogs);
    }
  }

  calculateMetrics() {
    if (this.metrics.pageLoadTimes.length > 0) {
      const sum = this.metrics.pageLoadTimes.reduce((a, b) => a + b, 0);
      this.metrics.averagePageLoadTime =
        sum / this.metrics.pageLoadTimes.length;
      this.metrics.minPageLoadTime = Math.min(...this.metrics.pageLoadTimes);
      this.metrics.maxPageLoadTime = Math.max(...this.metrics.pageLoadTimes);
    }

    if (this.metrics.scenarioTimes.length > 0) {
      const sum = this.metrics.scenarioTimes.reduce((a, b) => a + b, 0);
      this.metrics.averageScenarioTime =
        sum / this.metrics.scenarioTimes.length;
    }

    // Calculate scenario averages
    for (const stats of this.metrics.scenarioStats.values()) {
      stats.averageTime =
        stats.executions > 0 ? stats.totalTime / stats.executions : 0;
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
    const pageLoadTimes = this.metrics.pageLoadTimes
      .slice()
      .sort((a, b) => a - b);

    const percentile = (arr, p) => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((arr.length * p) / 100) - 1;
      return arr[Math.max(0, index)];
    };

    return {
      totalIterations: this.metrics.totalIterations,
      successfulIterations: this.metrics.successfulIterations,
      failedIterations: this.metrics.failedIterations,
      iterationSuccessRate:
        this.metrics.totalIterations > 0
          ? (this.metrics.successfulIterations / this.metrics.totalIterations) *
            100
          : 0,
      totalPageLoads: this.metrics.totalPageLoads,
      successfulPageLoads: this.metrics.successfulPageLoads,
      failedPageLoads: this.metrics.failedPageLoads,
      pageLoadSuccessRate:
        this.metrics.totalPageLoads > 0
          ? (this.metrics.successfulPageLoads / this.metrics.totalPageLoads) *
            100
          : 0,
      averagePageLoadTime: this.metrics.averagePageLoadTime,
      minPageLoadTime:
        this.metrics.minPageLoadTime === Infinity
          ? 0
          : this.metrics.minPageLoadTime,
      maxPageLoadTime: this.metrics.maxPageLoadTime,
      p50PageLoadTime: percentile(pageLoadTimes, 50),
      p90PageLoadTime: percentile(pageLoadTimes, 90),
      p95PageLoadTime: percentile(pageLoadTimes, 95),
      p99PageLoadTime: percentile(pageLoadTimes, 99),
      averageScenarioTime: this.metrics.averageScenarioTime,
      networkRequests: this.metrics.networkRequests,
      networkErrors: this.metrics.networkErrors,
      jsErrors: this.metrics.jsErrors,
      errors: Object.fromEntries(this.metrics.errors),
      scenarioStats: Object.fromEntries(this.metrics.scenarioStats),
      screenshotCount: this.screenshots.length,
      networkLogCount: this.networkLogs.length,
      consoleLogCount: this.consoleLogs.length,
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
      screenshots: this.screenshots.slice(-100), // Keep last 100 screenshots
      networkLogs: this.networkLogs.slice(-1000), // Keep last 1000 network logs
      consoleLogs: this.consoleLogs.slice(-500), // Keep last 500 console logs
      performanceMetrics: this.metrics.performanceMetrics.slice(-100), // Keep last 100 performance entries
    };
  }
}

class BrowserSession {
  constructor(sessionId, config, tester, test) {
    this.sessionId = sessionId;
    this.config = config;
    this.tester = tester;
    this.test = test;
    this.browser = null;
    this.page = null;
    this.isRunning = false;

    this.metrics = {
      iterations: 0,
      successfulIterations: 0,
      failedIterations: 0,
      pageLoads: 0,
      successfulPageLoads: 0,
      failedPageLoads: 0,
      pageLoadTimes: [],
      scenarioTimes: [],
      performanceMetrics: [],
      networkRequests: 0,
      networkErrors: 0,
      jsErrors: 0,
      errors: new Map(),
      scenarioStats: new Map(),
      screenshots: [],
      networkLogs: [],
      consoleLogs: [],
    };
  }

  async start(endTime) {
    this.isRunning = true;

    try {
      // Get browser from pool
      const browserInfo = await this.tester.getBrowser();
      this.browser = browserInfo.browser;

      // Create new page
      this.page = await this.browser.newPage();

      // Set viewport
      await this.page.setViewport(this.config.viewport);

      // Set user agent if specified
      if (this.config.userAgent) {
        await this.page.setUserAgent(this.config.userAgent);
      }

      // Set network conditions if specified
      if (this.config.networkConditions) {
        const client = await this.page.target().createCDPSession();
        await client.send(
          "Network.emulateNetworkConditions",
          this.config.networkConditions,
        );
      }

      // Set up event listeners
      this.setupEventListeners();

      // Execute scenarios
      const iterationInterval = 1000 / this.config.iterationsPerSecond;

      while (this.isRunning && Date.now() < endTime) {
        await this.executeRandomScenario();

        if (iterationInterval > 0) {
          await this.delay(iterationInterval);
        }
      }
    } catch (error) {
      console.error(`Browser session ${this.sessionId} error:`, error);
    } finally {
      await this.cleanup();
    }
  }

  async stop() {
    this.isRunning = false;
    await this.cleanup();
  }

  async cleanup() {
    try {
      if (this.page) {
        await this.page.close();
      }

      // Return browser to pool
      if (this.browser) {
        this.tester.releaseBrowser({ browser: this.browser });
      }
    } catch (error) {
      console.error("Error during browser session cleanup:", error);
    }

    // Report final metrics
    this.test.handleSessionMetrics(this.sessionId, this.metrics);
  }

  setupEventListeners() {
    // Network monitoring
    if (this.config.captureNetworkLogs) {
      this.page.on("request", (request) => {
        this.metrics.networkRequests++;
        this.metrics.networkLogs.push({
          timestamp: Date.now(),
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
        });
      });

      this.page.on("requestfailed", (request) => {
        this.metrics.networkErrors++;
        this.handleError(
          "network",
          new Error(`Request failed: ${request.url()}`),
        );
      });
    }

    // Console monitoring
    if (this.config.captureConsoleLogs) {
      this.page.on("console", (msg) => {
        this.metrics.consoleLogs.push({
          timestamp: Date.now(),
          type: msg.type(),
          text: msg.text(),
        });

        if (msg.type() === "error") {
          this.metrics.jsErrors++;
          this.handleError("javascript", new Error(msg.text()));
        }
      });

      this.page.on("pageerror", (error) => {
        this.metrics.jsErrors++;
        this.handleError("javascript", error);
      });
    }
  }

  async executeRandomScenario() {
    if (this.config.scenarios.length === 0) {
      return;
    }

    const scenario =
      this.config.scenarios[
        Math.floor(Math.random() * this.config.scenarios.length)
      ];
    await this.executeScenario(scenario);
  }

  async executeScenario(scenario) {
    const startTime = performance.now();
    const scenarioName = scenario.name || "Unnamed Scenario";

    // Initialize scenario stats
    if (!this.metrics.scenarioStats.has(scenarioName)) {
      this.metrics.scenarioStats.set(scenarioName, {
        executions: 0,
        successful: 0,
        failed: 0,
        totalTime: 0,
      });
    }

    const scenarioStats = this.metrics.scenarioStats.get(scenarioName);
    scenarioStats.executions++;
    this.metrics.iterations++;

    try {
      // Execute steps
      for (const step of scenario.steps) {
        await this.executeStep(step);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.scenarioTimes.push(duration);
      this.metrics.successfulIterations++;
      scenarioStats.successful++;
      scenarioStats.totalTime += duration;

      // Capture screenshot if enabled
      if (this.config.captureScreenshots) {
        await this.captureScreenshot(scenarioName);
      }

      // Collect performance metrics
      await this.collectPerformanceMetrics();
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.scenarioTimes.push(duration);
      this.metrics.failedIterations++;
      scenarioStats.failed++;
      scenarioStats.totalTime += duration;

      this.handleError("scenario", error);
    }
  }

  async executeStep(step) {
    switch (step.type) {
      case "navigate":
        await this.navigate(step.url, step.options);
        break;

      case "click":
        await this.click(step.selector, step.options);
        break;

      case "type":
        await this.type(step.selector, step.text, step.options);
        break;

      case "wait":
        await this.wait(step.duration || step.selector, step.options);
        break;

      case "scroll":
        await this.scroll(step.options);
        break;

      case "evaluate":
        await this.evaluate(step.script, step.options);
        break;

      case "screenshot":
        await this.captureScreenshot(step.name);
        break;

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  async navigate(url, options = {}) {
    const startTime = performance.now();

    try {
      this.metrics.pageLoads++;

      const response = await this.page.goto(url, {
        waitUntil: options.waitUntil || "networkidle2",
        timeout: options.timeout || this.tester.options.navigationTimeout,
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.pageLoadTimes.push(duration);

      if (response && response.ok()) {
        this.metrics.successfulPageLoads++;
      } else {
        this.metrics.failedPageLoads++;
        throw new Error(
          `Navigation failed with status: ${response ? response.status() : "unknown"}`,
        );
      }
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.metrics.pageLoadTimes.push(duration);
      this.metrics.failedPageLoads++;
      throw error;
    }
  }

  async click(selector, options = {}) {
    await this.page.waitForSelector(selector, {
      timeout: options.timeout || 5000,
    });
    await this.page.click(selector, options);
  }

  async type(selector, text, options = {}) {
    await this.page.waitForSelector(selector, {
      timeout: options.timeout || 5000,
    });

    if (options.clear) {
      await this.page.click(selector, { clickCount: 3 });
    }

    await this.page.type(selector, text, options);
  }

  async wait(duration, options = {}) {
    if (typeof duration === "number") {
      await this.page.waitForTimeout(duration);
    } else {
      // Assume it's a selector
      await this.page.waitForSelector(duration, options);
    }
  }

  async scroll(options = {}) {
    await this.page.evaluate((opts) => {
      window.scrollBy(opts.x || 0, opts.y || window.innerHeight);
    }, options);
  }

  async evaluate(script, options = {}) {
    return await this.page.evaluate(script, options.args);
  }

  async captureScreenshot(name) {
    try {
      const filename = `${this.sessionId}_${name}_${Date.now()}.png`;
      const filepath = path.join(this.tester.options.screenshotPath, filename);

      await this.page.screenshot({
        path: filepath,
        fullPage: false,
      });

      this.metrics.screenshots.push({
        name,
        filename,
        filepath,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Screenshot capture failed:", error);
    }
  }

  async collectPerformanceMetrics() {
    try {
      const metrics = await this.page.evaluate(() => {
        const perf = performance.getEntriesByType("navigation")[0];
        const paint = performance.getEntriesByType("paint");

        return {
          navigationStart: perf.navigationStart,
          domContentLoaded:
            perf.domContentLoadedEventEnd - perf.navigationStart,
          loadComplete: perf.loadEventEnd - perf.navigationStart,
          firstPaint:
            paint.find((p) => p.name === "first-paint")?.startTime || 0,
          firstContentfulPaint:
            paint.find((p) => p.name === "first-contentful-paint")?.startTime ||
            0,
        };
      });

      this.metrics.performanceMetrics.push({
        timestamp: Date.now(),
        ...metrics,
      });
    } catch (error) {
      console.error("Performance metrics collection failed:", error);
    }
  }

  handleError(type, error) {
    const errorKey = `${type}: ${error.message}`;
    this.metrics.errors.set(
      errorKey,
      (this.metrics.errors.get(errorKey) || 0) + 1,
    );
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = BrowserTester;
