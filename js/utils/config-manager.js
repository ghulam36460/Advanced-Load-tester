/**
 * Configuration Manager
 * ====================
 *
 * Advanced configuration management system for load testing parameters,
 * user preferences, and system settings.
 */

const fs = require("fs").promises;
const path = require("path");
const EventEmitter = require("events");

class ConfigManager extends EventEmitter {
  constructor(configPath = null) {
    super();
    this.configPath =
      configPath || path.join(__dirname, "../../config/settings.json");
    this.config = {
      // Default configuration
      system: {
        maxConcurrentTests: 10,
        defaultTimeout: 30000,
        logLevel: "info",
        enableMetrics: true,
        enableAlerts: true,
      },
      loadTesting: {
        defaultWorkers: 5,
        defaultDuration: 60,
        defaultRPS: 10,
        maxRPS: 1000,
        enableRealTimeUpdates: true,
        autoOptimization: false,
      },
      python: {
        enabled: true,
        port: 5001,
        mlOptimization: true,
        anomalyDetection: true,
        performancePrediction: true,
      },
      dashboard: {
        theme: "dark",
        autoRefresh: true,
        refreshInterval: 2000,
        showAdvancedMetrics: true,
        chartType: "line",
      },
      security: {
        enableCORS: true,
        allowedOrigins: ["*"],
        enableRateLimit: false,
        maxRequestsPerMinute: 1000,
      },
      monitoring: {
        retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
        aggregationInterval: 60000, // 1 minute
        enableSystemMetrics: true,
        enablePerformanceTracking: true,
      },
    };

    this.profiles = new Map();
    this.watchers = new Map();

    this.initialize();
  }

  async initialize() {
    try {
      await this.loadConfig();
      await this.loadProfiles();
      console.log("✓ Configuration manager initialized");
    } catch (error) {
      console.warn(
        "Configuration manager initialization warning:",
        error.message,
      );
      await this.saveConfig(); // Create default config
    }
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, "utf8");
      const loadedConfig = JSON.parse(configData);

      // Merge with defaults to handle new configuration options
      this.config = this.deepMerge(this.config, loadedConfig);

      this.emit("config-loaded", this.config);
      console.log("Configuration loaded from:", this.configPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log("No configuration file found, using defaults");
      } else {
        throw error;
      }
    }
  }

  async saveConfig() {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      this.emit("config-saved", this.config);
      console.log("Configuration saved to:", this.configPath);
    } catch (error) {
      console.error("Failed to save configuration:", error);
      throw error;
    }
  }

  async loadProfiles() {
    const profilesPath = path.join(
      path.dirname(this.configPath),
      "profiles.json",
    );
    try {
      const profilesData = await fs.readFile(profilesPath, "utf8");
      const profiles = JSON.parse(profilesData);

      for (const [name, profile] of Object.entries(profiles)) {
        this.profiles.set(name, profile);
      }

      console.log(`Loaded ${this.profiles.size} configuration profiles`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to load profiles:", error.message);
      }
    }
  }

  async saveProfiles() {
    const profilesPath = path.join(
      path.dirname(this.configPath),
      "profiles.json",
    );
    try {
      const profilesObj = Object.fromEntries(this.profiles);
      await fs.writeFile(profilesPath, JSON.stringify(profilesObj, null, 2));
      console.log("Profiles saved");
    } catch (error) {
      console.error("Failed to save profiles:", error);
    }
  }

  getConfig(path = null) {
    if (!path) {
      return { ...this.config };
    }

    return this.getNestedValue(this.config, path);
  }

  setConfig(path, value) {
    const oldValue = this.getNestedValue(this.config, path);
    this.setNestedValue(this.config, path, value);

    this.emit("config-changed", { path, oldValue, newValue: value });

    // Auto-save if enabled
    if (this.config.system.autoSave !== false) {
      this.saveConfig().catch((error) => {
        console.error("Auto-save failed:", error);
      });
    }

    return true;
  }

  updateConfig(updates) {
    const changes = [];

    for (const [path, value] of Object.entries(updates)) {
      const oldValue = this.getNestedValue(this.config, path);
      if (oldValue !== value) {
        this.setNestedValue(this.config, path, value);
        changes.push({ path, oldValue, newValue: value });
      }
    }

    if (changes.length > 0) {
      this.emit("config-bulk-changed", changes);

      // Auto-save if enabled
      if (this.config.system.autoSave !== false) {
        this.saveConfig().catch((error) => {
          console.error("Auto-save failed:", error);
        });
      }
    }

    return changes;
  }

  resetConfig(section = null) {
    const defaultConfig = new ConfigManager().config;

    if (section) {
      this.config[section] = { ...defaultConfig[section] };
      this.emit("config-section-reset", section);
    } else {
      this.config = { ...defaultConfig };
      this.emit("config-reset");
    }

    return this.saveConfig();
  }

  createProfile(name, config = null) {
    const profileConfig = config || { ...this.config };
    profileConfig.metadata = {
      name,
      created: new Date().toISOString(),
      version: "1.0.0",
    };

    this.profiles.set(name, profileConfig);
    this.emit("profile-created", { name, profile: profileConfig });

    return this.saveProfiles();
  }

  loadProfile(name) {
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new Error(`Profile '${name}' not found`);
    }

    const oldConfig = { ...this.config };
    this.config = { ...profile };

    this.emit("profile-loaded", { name, oldConfig, newConfig: this.config });

    return this.saveConfig();
  }

  deleteProfile(name) {
    if (!this.profiles.has(name)) {
      throw new Error(`Profile '${name}' not found`);
    }

    this.profiles.delete(name);
    this.emit("profile-deleted", name);

    return this.saveProfiles();
  }

  getProfiles() {
    return Array.from(this.profiles.entries()).map(([name, profile]) => ({
      name,
      metadata: profile.metadata || {},
      preview: {
        workers: profile.loadTesting?.defaultWorkers,
        duration: profile.loadTesting?.defaultDuration,
        rps: profile.loadTesting?.defaultRPS,
        pythonEnabled: profile.python?.enabled,
      },
    }));
  }

  validateConfig(config = null) {
    const configToValidate = config || this.config;
    const errors = [];
    const warnings = [];

    // Validate system settings
    if (configToValidate.system) {
      const { maxConcurrentTests, defaultTimeout } = configToValidate.system;

      if (maxConcurrentTests < 1 || maxConcurrentTests > 100) {
        errors.push("maxConcurrentTests must be between 1 and 100");
      }

      if (defaultTimeout < 1000 || defaultTimeout > 300000) {
        warnings.push("defaultTimeout should be between 1s and 5m");
      }
    }

    // Validate load testing settings
    if (configToValidate.loadTesting) {
      const { defaultWorkers, maxRPS, defaultRPS } =
        configToValidate.loadTesting;

      if (defaultWorkers < 1 || defaultWorkers > 1000) {
        errors.push("defaultWorkers must be between 1 and 1000");
      }

      if (maxRPS < 1) {
        errors.push("maxRPS must be greater than 0");
      }

      if (defaultRPS > maxRPS) {
        warnings.push("defaultRPS exceeds maxRPS");
      }
    }

    // Validate Python settings
    if (configToValidate.python) {
      const { port } = configToValidate.python;

      if (port < 1024 || port > 65535) {
        warnings.push("Python port should be between 1024 and 65535");
      }
    }

    return { errors, warnings, valid: errors.length === 0 };
  }

  watchConfig(path, callback) {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, new Set());
    }

    this.watchers.get(path).add(callback);

    // Return unwatch function
    return () => {
      const callbacks = this.watchers.get(path);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.watchers.delete(path);
        }
      }
    };
  }

  exportConfig(includeProfiles = false) {
    const exportData = {
      config: this.config,
      metadata: {
        exported: new Date().toISOString(),
        version: "2.0.0",
      },
    };

    if (includeProfiles) {
      exportData.profiles = Object.fromEntries(this.profiles);
    }

    return JSON.stringify(exportData, null, 2);
  }

  async importConfig(data, options = {}) {
    try {
      const importData = typeof data === "string" ? JSON.parse(data) : data;

      if (options.mergeMode) {
        this.config = this.deepMerge(this.config, importData.config);
      } else {
        this.config = { ...importData.config };
      }

      if (importData.profiles && options.includeProfiles) {
        for (const [name, profile] of Object.entries(importData.profiles)) {
          this.profiles.set(name, profile);
        }
        await this.saveProfiles();
      }

      await this.saveConfig();
      this.emit("config-imported", { mergeMode: options.mergeMode });

      return true;
    } catch (error) {
      console.error("Failed to import configuration:", error);
      throw error;
    }
  }

  // Utility methods
  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  getNestedValue(obj, path) {
    return path.split(".").reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  setNestedValue(obj, path, value) {
    const keys = path.split(".");
    const lastKey = keys.pop();

    const target = keys.reduce((current, key) => {
      if (!current[key] || typeof current[key] !== "object") {
        current[key] = {};
      }
      return current[key];
    }, obj);

    target[lastKey] = value;
  }

  destroy() {
    this.watchers.clear();
    this.removeAllListeners();
    console.log("Configuration manager destroyed");
  }
}

module.exports = ConfigManager;
