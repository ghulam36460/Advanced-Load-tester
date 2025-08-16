/**
 * Proxy Manager - Advanced Proxy Handling with Auto-Generation
 * ============================================================
 *
 * Comprehensive proxy management system:
 * - Automatic proxy generation via Python integration
 * - Proxy rotation and load balancing
 * - Health checking and validation
 * - Authentication support
 * - Automatic failover
 * - Performance monitoring
 * - Multiple proxy sources (free proxies, APIs, manual)
 */

const axios = require("axios");
const { EventEmitter } = require("events");
const crypto = require("crypto");
const fs = require("fs").promises;
const { spawn } = require("child_process");
const path = require("path");

class ProxyManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      healthCheckInterval: options.healthCheckInterval || 60000,
      healthCheckTimeout: options.healthCheckTimeout || 10000,
      maxRetries: options.maxRetries || 3,
      rotationStrategy: options.rotationStrategy || "round-robin", // round-robin, random, weighted
      enableHealthCheck: options.enableHealthCheck !== false,
      testUrl: options.testUrl || "https://httpbin.org/ip",

      // Auto-generation options
      enableAutoGeneration: options.enableAutoGeneration !== false,
      minProxies: options.minProxies || 10,
      maxProxies: options.maxProxies || 100,
      generationInterval: options.generationInterval || 300000, // 5 minutes
      pythonBridgeUrl: options.pythonBridgeUrl || "http://localhost:5001",

      ...options,
    };

    this.proxies = new Map();
    this.healthyProxies = new Set();
    this.unhealthyProxies = new Set();
    this.currentIndex = 0;
    this.stats = new Map();
    this.healthCheckInterval = null;
    this.generationInterval = null;

    // Proxy generation status
    this.isGenerating = false;
    this.lastGeneration = null;
    this.generationStats = {
      total: 0,
      successful: 0,
      failed: 0,
      lastUpdate: null,
    };
  }

  async initialize() {
    console.log("Initializing Advanced Proxy Manager...");

    // Load proxies from configuration
    await this.loadProxies();

    // Start auto-generation if enabled and needed
    if (
      this.options.enableAutoGeneration &&
      this.healthyProxies.size < this.options.minProxies
    ) {
      await this.generateProxies();
    }

    // Start health checking if enabled
    if (this.options.enableHealthCheck) {
      await this.startHealthChecking();
    }

    // Start auto-generation monitoring
    if (this.options.enableAutoGeneration) {
      this.startAutoGeneration();
    }

    console.log(
      `Proxy Manager initialized with ${this.healthyProxies.size} healthy proxies`,
    );
  }

  async generateProxies(count = null) {
    if (this.isGenerating) {
      console.log("Proxy generation already in progress");
      return;
    }

    const targetCount = count || this.options.maxProxies;
    console.log(`Starting proxy generation for ${targetCount} proxies...`);

    this.isGenerating = true;
    this.emit("proxy_generation_started", { targetCount });

    try {
      // Try Python bridge first (preferred method)
      const generatedProxies = await this.generateProxiesViaPython(targetCount);

      if (generatedProxies.length > 0) {
        console.log(
          `Generated ${generatedProxies.length} proxies via Python bridge`,
        );

        // Add generated proxies
        for (const proxyConfig of generatedProxies) {
          await this.addProxy(proxyConfig);
        }

        this.generationStats.successful += generatedProxies.length;
      } else {
        // Fallback to JavaScript methods
        console.log("Python generation failed, using fallback methods...");
        await this.generateProxiesViaJavaScript(targetCount);
      }

      this.generationStats.total += targetCount;
      this.generationStats.lastUpdate = Date.now();
      this.lastGeneration = Date.now();

      this.emit("proxy_generation_completed", {
        generated: generatedProxies.length,
        healthy: this.healthyProxies.size,
        total: this.proxies.size,
      });
    } catch (error) {
      console.error("Proxy generation failed:", error.message);
      this.generationStats.failed += targetCount;
      this.emit("proxy_generation_failed", { error: error.message });
    } finally {
      this.isGenerating = false;
    }
  }

  async generateProxiesViaPython(count = 50) {
    try {
      console.log(`Requesting ${count} proxies from Python bridge...`);

      // Call Python proxy manager via bridge
      const response = await axios.post(
        `${this.options.pythonBridgeUrl}/api/proxies/generate`,
        {
          count: count,
          validate: true,
          sources: ["free_proxy", "proxy_list_api", "gimmeproxy_api"],
        },
        {
          timeout: 60000, // 1 minute timeout for generation
        },
      );

      if (response.data && response.data.success && response.data.proxies) {
        return response.data.proxies.map((proxy) => ({
          protocol: proxy.protocol || "http",
          host: proxy.host,
          port: proxy.port,
          auth: proxy.username
            ? {
                username: proxy.username,
                password: proxy.password,
              }
            : null,
          weight: 1,
          source: proxy.source || "python_generator",
          country: proxy.country,
          anonymity: proxy.anonymity,
          speed: proxy.speed,
        }));
      }
    } catch (error) {
      console.error("Python proxy generation failed:", error.message);

      // Try direct Python script execution as fallback
      return await this.generateProxiesViaScript(count);
    }

    return [];
  }

  async generateProxiesViaScript(count = 50) {
    return new Promise((resolve, _reject) => {
      console.log("Executing Python proxy generator script...");

      const scriptPath = path.join(__dirname, "../../proxy_manager.py");
      const pythonProcess = spawn(
        "python",
        [scriptPath, "--generate", count.toString()],
        {
          cwd: path.join(__dirname, "../.."),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let output = "";
      let errorOutput = "";

      pythonProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code === 0) {
          try {
            // Parse JSON output from Python script
            const lines = output.trim().split("\n");
            const jsonLine = lines.find((line) => line.startsWith("{"));

            if (jsonLine) {
              const result = JSON.parse(jsonLine);
              if (result.proxies) {
                resolve(result.proxies);
                return;
              }
            }

            console.log("Python script output:", output);
            resolve([]);
          } catch (error) {
            console.error("Failed to parse Python output:", error.message);
            resolve([]);
          }
        } else {
          console.error("Python script failed:", errorOutput);
          resolve([]);
        }
      });

      setTimeout(() => {
        pythonProcess.kill();
        resolve([]);
      }, 120000); // 2 minute timeout
    });
  }

  async generateProxiesViaJavaScript(count = 50) {
    console.log("Generating proxies via JavaScript fallback methods...");

    // Free proxy APIs that can be called directly
    const freeProxyApis = [
      {
        url: "https://www.proxy-list.download/api/v1/get?type=http",
        parser: this.parseProxyListApi.bind(this),
      },
      {
        url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
        parser: this.parseSimpleList.bind(this),
      },
      {
        url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
        parser: this.parseSimpleList.bind(this),
      },
    ];

    const proxies = [];

    for (const api of freeProxyApis) {
      try {
        console.log(`Fetching from ${api.url}...`);
        const response = await axios.get(api.url, {
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        const apiProxies = api.parser(response.data);
        proxies.push(
          ...apiProxies.slice(0, Math.ceil(count / freeProxyApis.length)),
        );

        console.log(`Fetched ${apiProxies.length} proxies from ${api.url}`);
      } catch (error) {
        console.error(`Failed to fetch from ${api.url}:`, error.message);
      }
    }

    // Add the proxies
    for (const proxyConfig of proxies.slice(0, count)) {
      await this.addProxy(proxyConfig);
    }

    console.log(
      `JavaScript fallback generated ${proxies.length} proxy candidates`,
    );
  }

  parseProxyListApi(data) {
    const lines = data.trim().split("\n");
    return lines
      .map((line) => {
        const [host, port] = line.trim().split(":");
        return {
          protocol: "http",
          host: host,
          port: parseInt(port),
          source: "proxy_list_api",
        };
      })
      .filter((proxy) => proxy.host && proxy.port);
  }

  parseSimpleList(data) {
    const lines = data.trim().split("\n");
    return lines
      .map((line) => {
        line = line.trim();
        if (line.includes(":")) {
          const [host, port] = line.split(":");
          return {
            protocol: "http",
            host: host.trim(),
            port: parseInt(port.trim()),
            source: "github_list",
          };
        }
        return null;
      })
      .filter((proxy) => proxy && proxy.host && proxy.port);
  }

  startAutoGeneration() {
    if (this.generationInterval) {
      clearInterval(this.generationInterval);
    }

    this.generationInterval = setInterval(async () => {
      const healthyCount = this.healthyProxies.size;

      if (healthyCount < this.options.minProxies) {
        console.log(
          `Proxy count (${healthyCount}) below minimum (${this.options.minProxies}), auto-generating...`,
        );
        await this.generateProxies(this.options.maxProxies - healthyCount);
      }
    }, this.options.generationInterval);

    console.log("Auto-generation monitoring started");
  }

  stopAutoGeneration() {
    if (this.generationInterval) {
      clearInterval(this.generationInterval);
      this.generationInterval = null;
    }
  }

  async loadProxies() {
    // Load from various sources
    if (this.options.proxyFile) {
      await this.loadFromFile(this.options.proxyFile);
    }

    if (this.options.proxyList) {
      await this.loadFromList(this.options.proxyList);
    }

    if (this.options.proxyUrls) {
      await this.loadFromUrls(this.options.proxyUrls);
    }
  }

  async loadFromFile(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        await this.addProxy(this.parseProxyString(line.trim()));
      }

      console.log(`Loaded ${lines.length} proxies from file: ${filePath}`);
    } catch (error) {
      console.error(
        `Failed to load proxies from file ${filePath}:`,
        error.message,
      );
    }
  }

  async loadFromList(proxyList) {
    for (const proxyConfig of proxyList) {
      await this.addProxy(proxyConfig);
    }

    console.log(`Loaded ${proxyList.length} proxies from list`);
  }

  async loadFromUrls(urls) {
    for (const url of urls) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        const lines = response.data.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          await this.addProxy(this.parseProxyString(line.trim()));
        }

        console.log(`Loaded ${lines.length} proxies from URL: ${url}`);
      } catch (error) {
        console.error(`Failed to load proxies from URL ${url}:`, error.message);
      }
    }
  }

  parseProxyString(proxyString) {
    // Support various formats:
    // http://host:port
    // host:port
    // user:pass@host:port
    // http://user:pass@host:port

    let protocol = "http";
    let auth = null;
    let host, port;

    // Extract protocol
    if (proxyString.includes("://")) {
      [protocol, proxyString] = proxyString.split("://");
    }

    // Extract authentication
    if (proxyString.includes("@")) {
      const [authPart, hostPart] = proxyString.split("@");
      const [username, password] = authPart.split(":");
      auth = { username, password };
      proxyString = hostPart;
    }

    // Extract host and port
    [host, port] = proxyString.split(":");
    port = parseInt(port) || (protocol === "https" ? 443 : 80);

    return {
      protocol,
      host,
      port,
      auth,
    };
  }

  async addProxy(proxyConfig) {
    const proxyId = this.generateProxyId(proxyConfig);

    const proxy = {
      id: proxyId,
      ...proxyConfig,
      healthy: false,
      lastChecked: null,
      responseTime: 0,
      successCount: 0,
      failureCount: 0,
      weight: proxyConfig.weight || 1,
    };

    this.proxies.set(proxyId, proxy);
    this.stats.set(proxyId, {
      requests: 0,
      successes: 0,
      failures: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      lastUsed: null,
    });

    // Initial health check
    if (this.options.enableHealthCheck) {
      await this.checkProxyHealth(proxyId);
    } else {
      this.healthyProxies.add(proxyId);
      proxy.healthy = true;
    }

    this.emit("proxy_added", proxy);
    return proxyId;
  }

  removeProxy(proxyId) {
    const proxy = this.proxies.get(proxyId);
    if (!proxy) return false;

    this.proxies.delete(proxyId);
    this.healthyProxies.delete(proxyId);
    this.unhealthyProxies.delete(proxyId);
    this.stats.delete(proxyId);

    this.emit("proxy_removed", proxy);
    return true;
  }

  generateProxyId(proxyConfig) {
    const identifier = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
    return crypto.createHash("md5").update(identifier).digest("hex");
  }

  async startHealthChecking() {
    // Initial health check for all proxies
    await this.checkAllProxiesHealth();

    // Start periodic health checking
    this.healthCheckInterval = setInterval(async () => {
      await this.checkAllProxiesHealth();
    }, this.options.healthCheckInterval);

    console.log("Proxy health checking started");
  }

  stopHealthChecking() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async checkAllProxiesHealth() {
    const healthCheckPromises = Array.from(this.proxies.keys()).map((proxyId) =>
      this.checkProxyHealth(proxyId),
    );

    await Promise.allSettled(healthCheckPromises);

    this.emit("health_check_completed", {
      total: this.proxies.size,
      healthy: this.healthyProxies.size,
      unhealthy: this.unhealthyProxies.size,
    });
  }

  async checkProxyHealth(proxyId) {
    const proxy = this.proxies.get(proxyId);
    if (!proxy) return false;

    const startTime = Date.now();

    try {
      const proxyConfig = this.createAxiosProxyConfig(proxy);

      const response = await axios.get(this.options.testUrl, {
        proxy: proxyConfig,
        timeout: this.options.healthCheckTimeout,
        validateStatus: () => true,
      });

      const responseTime = Date.now() - startTime;

      // Consider proxy healthy if response is received
      const isHealthy = response.status >= 200 && response.status < 500;

      proxy.lastChecked = Date.now();
      proxy.responseTime = responseTime;
      proxy.healthy = isHealthy;

      if (isHealthy) {
        proxy.successCount++;
        this.healthyProxies.add(proxyId);
        this.unhealthyProxies.delete(proxyId);
      } else {
        proxy.failureCount++;
        this.healthyProxies.delete(proxyId);
        this.unhealthyProxies.add(proxyId);
      }

      this.emit("proxy_health_checked", {
        proxyId,
        healthy: isHealthy,
        responseTime,
        status: response.status,
      });

      return isHealthy;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      proxy.lastChecked = Date.now();
      proxy.responseTime = responseTime;
      proxy.healthy = false;
      proxy.failureCount++;

      this.healthyProxies.delete(proxyId);
      this.unhealthyProxies.add(proxyId);

      this.emit("proxy_health_checked", {
        proxyId,
        healthy: false,
        responseTime,
        error: error.message,
      });

      return false;
    }
  }

  getProxy(strategy = null) {
    const rotationStrategy = strategy || this.options.rotationStrategy;
    const healthyProxyIds = Array.from(this.healthyProxies);

    if (healthyProxyIds.length === 0) {
      throw new Error("No healthy proxies available");
    }

    let selectedProxyId;

    switch (rotationStrategy) {
      case "round-robin":
        selectedProxyId =
          healthyProxyIds[this.currentIndex % healthyProxyIds.length];
        this.currentIndex++;
        break;

      case "random":
        selectedProxyId =
          healthyProxyIds[Math.floor(Math.random() * healthyProxyIds.length)];
        break;

      case "weighted":
        selectedProxyId = this.selectWeightedProxy(healthyProxyIds);
        break;

      case "least-used":
        selectedProxyId = this.selectLeastUsedProxy(healthyProxyIds);
        break;

      case "fastest":
        selectedProxyId = this.selectFastestProxy(healthyProxyIds);
        break;

      default:
        selectedProxyId = healthyProxyIds[0];
    }

    const proxy = this.proxies.get(selectedProxyId);
    const stats = this.stats.get(selectedProxyId);

    // Update usage stats
    stats.requests++;
    stats.lastUsed = Date.now();

    return {
      ...proxy,
      axiosConfig: this.createAxiosProxyConfig(proxy),
    };
  }

  selectWeightedProxy(healthyProxyIds) {
    const proxies = healthyProxyIds.map((id) => this.proxies.get(id));
    const totalWeight = proxies.reduce((sum, proxy) => sum + proxy.weight, 0);

    let random = Math.random() * totalWeight;

    for (const proxy of proxies) {
      random -= proxy.weight;
      if (random <= 0) {
        return proxy.id;
      }
    }

    return healthyProxyIds[0];
  }

  selectLeastUsedProxy(healthyProxyIds) {
    let leastUsed = null;
    let minRequests = Infinity;

    for (const proxyId of healthyProxyIds) {
      const stats = this.stats.get(proxyId);
      if (stats.requests < minRequests) {
        minRequests = stats.requests;
        leastUsed = proxyId;
      }
    }

    return leastUsed || healthyProxyIds[0];
  }

  selectFastestProxy(healthyProxyIds) {
    let fastest = null;
    let minResponseTime = Infinity;

    for (const proxyId of healthyProxyIds) {
      const proxy = this.proxies.get(proxyId);
      if (proxy.responseTime < minResponseTime) {
        minResponseTime = proxy.responseTime;
        fastest = proxyId;
      }
    }

    return fastest || healthyProxyIds[0];
  }

  createAxiosProxyConfig(proxy) {
    const config = {
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
    };

    if (proxy.auth) {
      config.auth = proxy.auth;
    }

    return config;
  }

  recordProxyResult(proxyId, success, responseTime) {
    const stats = this.stats.get(proxyId);
    if (!stats) return;

    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }

    stats.totalResponseTime += responseTime;
    stats.averageResponseTime = stats.totalResponseTime / stats.requests;

    this.emit("proxy_result_recorded", {
      proxyId,
      success,
      responseTime,
      stats,
    });
  }

  getStats() {
    const allStats = {};

    for (const [proxyId, stats] of this.stats) {
      const proxy = this.proxies.get(proxyId);
      allStats[proxyId] = {
        proxy: {
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol,
          healthy: proxy.healthy,
          lastChecked: proxy.lastChecked,
          responseTime: proxy.responseTime,
          source: proxy.source,
          country: proxy.country,
          anonymity: proxy.anonymity,
        },
        stats: {
          ...stats,
          successRate:
            stats.requests > 0 ? (stats.successes / stats.requests) * 100 : 0,
        },
      };
    }

    return {
      total: this.proxies.size,
      healthy: this.healthyProxies.size,
      unhealthy: this.unhealthyProxies.size,
      autoGeneration: {
        enabled: this.options.enableAutoGeneration,
        isGenerating: this.isGenerating,
        lastGeneration: this.lastGeneration,
        stats: this.generationStats,
      },
      proxies: allStats,
    };
  }

  async exportProxies(format = "json") {
    const healthyProxies = Array.from(this.healthyProxies).map((id) =>
      this.proxies.get(id),
    );

    switch (format) {
      case "json":
        return JSON.stringify(
          healthyProxies.map((proxy) => ({
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            auth: proxy.auth,
            source: proxy.source,
            country: proxy.country,
            anonymity: proxy.anonymity,
            responseTime: proxy.responseTime,
          })),
          null,
          2,
        );

      case "txt":
        return healthyProxies
          .map((proxy) => `${proxy.host}:${proxy.port}`)
          .join("\n");

      case "url":
        return healthyProxies
          .map((proxy) => {
            let url = `${proxy.protocol}://`;
            if (proxy.auth) {
              url += `${proxy.auth.username}:${proxy.auth.password}@`;
            }
            url += `${proxy.host}:${proxy.port}`;
            return url;
          })
          .join("\n");

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  async saveProxiesToFile(filePath, format = "json") {
    const content = await this.exportProxies(format);
    await fs.writeFile(filePath, content);
    console.log(`Exported ${this.healthyProxies.size} proxies to ${filePath}`);
  }

  getHealthyProxies() {
    return Array.from(this.healthyProxies).map((id) => this.proxies.get(id));
  }

  getUnhealthyProxies() {
    return Array.from(this.unhealthyProxies).map((id) => this.proxies.get(id));
  }

  destroy() {
    this.stopHealthChecking();
    this.stopAutoGeneration();
    this.proxies.clear();
    this.healthyProxies.clear();
    this.unhealthyProxies.clear();
    this.stats.clear();
  }
}

// Enhanced ProxyManager with additional utility methods
class EnhancedProxyManager extends ProxyManager {
  constructor(options = {}) {
    super(options);
    this.proxyPools = new Map(); // Different pools for different purposes
  }

  async createProxyPool(name, count = 20, criteria = {}) {
    console.log(`Creating proxy pool '${name}' with ${count} proxies...`);

    // Generate proxies for this specific pool
    await this.generateProxies(count);

    // Filter proxies based on criteria
    let poolProxies = Array.from(this.healthyProxies).map((id) =>
      this.proxies.get(id),
    );

    if (criteria.country) {
      poolProxies = poolProxies.filter((p) => p.country === criteria.country);
    }

    if (criteria.anonymity) {
      poolProxies = poolProxies.filter(
        (p) => p.anonymity === criteria.anonymity,
      );
    }

    if (criteria.maxResponseTime) {
      poolProxies = poolProxies.filter(
        (p) => p.responseTime <= criteria.maxResponseTime,
      );
    }

    this.proxyPools.set(name, {
      proxies: poolProxies.slice(0, count),
      criteria: criteria,
      currentIndex: 0,
      created: Date.now(),
    });

    console.log(
      `Created proxy pool '${name}' with ${this.proxyPools.get(name).proxies.length} proxies`,
    );
  }

  getProxyFromPool(poolName) {
    const pool = this.proxyPools.get(poolName);
    if (!pool || pool.proxies.length === 0) {
      return null;
    }

    const proxy = pool.proxies[pool.currentIndex];
    pool.currentIndex = (pool.currentIndex + 1) % pool.proxies.length;

    return proxy;
  }

  async refreshProxyPool(poolName) {
    const pool = this.proxyPools.get(poolName);
    if (!pool) {
      throw new Error(`Proxy pool '${poolName}' not found`);
    }

    // Re-create the pool with same criteria
    await this.createProxyPool(poolName, pool.proxies.length, pool.criteria);
  }
}

module.exports = { ProxyManager, EnhancedProxyManager };
