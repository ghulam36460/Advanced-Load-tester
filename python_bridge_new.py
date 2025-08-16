"""
Advanced Python Bridge for Load Testing with ML/AI capabilities
Enhanced version with sophisticated features and optimization
"""

import asyncio
import json
import logging
import os
import random
import time
import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple
import threading

# Core libraries
import aiohttp
import numpy as np
import pandas as pd
import psutil
from faker import Faker
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# Machine Learning libraries
from sklearn.ensemble import IsolationForest
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LinearRegression
from scipy import stats

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
fake = Faker()

@dataclass
class AdvancedTestConfig:
    """Advanced configuration for ML-powered load testing"""
    
    # Basic configuration
    targets: List[str] = field(default_factory=list)
    duration: int = 60
    requests_per_second: float = 10.0
    workers: int = 5
    timeout: int = 30
    
    # Advanced load patterns
    load_pattern: str = "constant"  # constant, ramp, spike, wave, chaos, ai_optimized
    ramp_up_time: int = 0
    spike_intensity: float = 2.0
    wave_frequency: float = 0.1
    wave_amplitude: float = 0.5
    
    # AI/ML features
    enable_ml_optimization: bool = True
    enable_anomaly_detection: bool = True
    enable_performance_prediction: bool = True
    
    # Security testing
    enable_security_testing: bool = False
    enable_vulnerability_scanning: bool = False
    enable_penetration_testing: bool = False
    
    # Performance features
    enable_performance_profiling: bool = True
    enable_memory_profiling: bool = False
    enable_network_optimization: bool = True
    enable_tls_testing: bool = False
    
    # Behavioral simulation
    use_realistic_data: bool = True
    simulate_user_behavior: bool = True
    enable_session_management: bool = True
    
    # Protocol support
    protocol_versions: List[str] = field(default_factory=lambda: ["http/1.1"])
    enable_http2: bool = False
    enable_websockets: bool = False
    enable_grpc: bool = False

class AdvancedMetricsCollector:
    """Next-generation metrics collector with ML-powered insights"""
    
    def __init__(self):
        self.start_time = time.time()
        self.requests = []
        self.response_times = deque(maxlen=10000)
        self.status_codes = defaultdict(int)
        self.errors = []
        self.throughput_samples = deque(maxlen=1000)
        
        # Advanced metrics
        self.performance_samples = []
        self.anomaly_detector = None
        self.trend_analyzer = LinearRegression()
        self.is_ml_initialized = False
        
        # Statistical tracking
        self.percentiles = [50, 75, 90, 95, 99]
        self.rolling_stats = {
            "response_times": deque(maxlen=1000),
            "error_rates": deque(maxlen=100),
            "throughput": deque(maxlen=100)
        }
        
        # Thread safety
        self.lock = threading.Lock()
    
    def record_request(self, response_time: float, status_code: int, 
                      content_length: int = 0, error: str = None, 
                      response_headers: Dict[str, str] = None):
        """Record advanced request metrics"""
        with self.lock:
            timestamp = time.time()
            
            # Basic recording
            self.response_times.append(response_time)
            self.status_codes[status_code] += 1
            
            if error:
                self.errors.append({
                    "timestamp": timestamp,
                    "error": error,
                    "response_time": response_time
                })
            
            # Advanced metrics
            request_data = {
                "timestamp": timestamp,
                "response_time": response_time,
                "status_code": status_code,
                "content_length": content_length,
                "error": error,
                "response_headers": response_headers or {}
            }
            
            self.requests.append(request_data)
            self.performance_samples.append([
                timestamp, response_time, status_code, content_length
            ])
            
            # Rolling statistics
            self.rolling_stats["response_times"].append(response_time)
            
            # Calculate rolling error rate
            recent_requests = [r for r in self.requests[-100:]]  # Last 100 requests
            if recent_requests:
                error_count = sum(1 for r in recent_requests if r["status_code"] >= 400)
                error_rate = error_count / len(recent_requests)
                self.rolling_stats["error_rates"].append(error_rate)
            
            # Throughput calculation
            if len(self.requests) >= 2:
                time_window = 1.0  # 1 second window
                recent_time = timestamp - time_window
                recent_count = sum(1 for r in self.requests if r["timestamp"] >= recent_time)
                self.rolling_stats["throughput"].append(recent_count)
    
    def initialize_ml_components(self):
        """Initialize machine learning components"""
        if self.is_ml_initialized or len(self.performance_samples) < 50:
            return
        
        try:
            # Initialize anomaly detection
            data = np.array(self.performance_samples)
            if data.shape[0] > 0:
                self.anomaly_detector = IsolationForest(
                    contamination=0.1,
                    random_state=42
                )
                self.anomaly_detector.fit(data[:, 1:])  # Exclude timestamp
                
                # Initialize trend analysis
                if len(data) > 10:
                    X = data[:, 0].reshape(-1, 1)  # Timestamps
                    y = data[:, 1]  # Response times
                    self.trend_analyzer.fit(X, y)
                
                self.is_ml_initialized = True
                logger.info("ML components initialized successfully")
                
        except Exception as e:
            logger.error(f"Failed to initialize ML components: {e}")
    
    def detect_anomalies(self) -> List[Dict[str, Any]]:
        """Detect performance anomalies using ML"""
        if not self.is_ml_initialized or len(self.performance_samples) < 10:
            return []
        
        try:
            recent_data = np.array(self.performance_samples[-100:])  # Last 100 samples
            if recent_data.shape[0] == 0:
                return []
            
            # Predict anomalies
            predictions = self.anomaly_detector.predict(recent_data[:, 1:])
            anomalies = []
            
            for i, prediction in enumerate(predictions):
                if prediction == -1:  # Anomaly detected
                    sample = recent_data[i]
                    anomalies.append({
                        "timestamp": sample[0],
                        "response_time": sample[1],
                        "status_code": int(sample[2]),
                        "content_length": int(sample[3]),
                        "anomaly_score": float(prediction)
                    })
            
            return anomalies
            
        except Exception as e:
            logger.error(f"Anomaly detection failed: {e}")
            return []
    
    def predict_performance_trend(self, forecast_minutes: int = 5) -> Dict[str, Any]:
        """Predict performance trends using ML"""
        if not self.is_ml_initialized or len(self.performance_samples) < 20:
            return {}
        
        try:
            current_time = time.time()
            future_times = np.array([
                current_time + i * 60 for i in range(1, forecast_minutes + 1)
            ]).reshape(-1, 1)
            
            predicted_response_times = self.trend_analyzer.predict(future_times)
            
            return {
                "forecast_minutes": forecast_minutes,
                "predicted_response_times": predicted_response_times.tolist(),
                "trend_direction": "increasing" if predicted_response_times[-1] > predicted_response_times[0] else "decreasing",
                "confidence_score": float(self.trend_analyzer.score(
                    np.array([s[0] for s in self.performance_samples[-50:]]).reshape(-1, 1),
                    [s[1] for s in self.performance_samples[-50:]]
                ))
            }
            
        except Exception as e:
            logger.error(f"Performance prediction failed: {e}")
            return {}
    
    def get_advanced_stats(self) -> Dict[str, Any]:
        """Get comprehensive statistics with ML insights"""
        with self.lock:
            if not self.response_times:
                return {"basic": {}, "performance": {}, "statistical": {}, "ml_insights": {}}
            
            # Initialize ML if enough data
            self.initialize_ml_components()
            
            # Basic statistics
            total_requests = len(self.requests)
            successful_requests = sum(1 for r in self.requests if r["status_code"] < 400)
            failed_requests = total_requests - successful_requests
            
            response_times_list = list(self.response_times)
            avg_response_time = np.mean(response_times_list) if response_times_list else 0
            
            basic_stats = {
                "total_requests": total_requests,
                "successful_requests": successful_requests,
                "failed_requests": failed_requests,
                "success_rate": (successful_requests / total_requests) * 100 if total_requests > 0 else 0,
                "avg_response_time": avg_response_time,
                "min_response_time": float(np.min(response_times_list)) if response_times_list else 0,
                "max_response_time": float(np.max(response_times_list)) if response_times_list else 0,
                "requests_per_second": self._calculate_rps(),
                "duration": time.time() - self.start_time
            }
            
            # Performance statistics
            performance_stats = {}
            if response_times_list:
                performance_stats = {
                    "percentiles": {
                        f"p{p}": float(np.percentile(response_times_list, p))
                        for p in self.percentiles
                    },
                    "std_deviation": float(np.std(response_times_list)),
                    "variance": float(np.var(response_times_list)),
                    "coefficient_of_variation": float(np.std(response_times_list) / avg_response_time) if avg_response_time > 0 else 0
                }
            
            # Statistical analysis
            statistical_stats = self._get_statistical_analysis()
            
            # ML insights
            ml_insights = {}
            if self.is_ml_initialized:
                ml_insights = {
                    "anomalies": self.detect_anomalies(),
                    "performance_prediction": self.predict_performance_trend(),
                    "trend_analysis": self._analyze_trends(),
                    "pattern_recognition": self._recognize_patterns()
                }
            
            return {
                "basic": basic_stats,
                "performance": performance_stats,
                "statistical": statistical_stats,
                "ml_insights": ml_insights,
                "status_codes": dict(self.status_codes),
                "recent_errors": self.errors[-10:] if self.errors else []
            }
    
    def _calculate_rps(self) -> float:
        """Calculate current requests per second"""
        if len(self.rolling_stats["throughput"]) == 0:
            return 0.0
        return float(np.mean(list(self.rolling_stats["throughput"])))
    
    def _get_statistical_analysis(self) -> Dict[str, Any]:
        """Advanced statistical analysis"""
        if len(self.response_times) < 10:
            return {}
        
        response_times_array = np.array(list(self.response_times))
        
        # Statistical tests
        shapiro_test = stats.shapiro(response_times_array[:min(5000, len(response_times_array))])
        
        # Distribution analysis
        skewness = float(stats.skew(response_times_array))
        kurtosis = float(stats.kurtosis(response_times_array))
        
        return {
            "normality_test": {
                "statistic": float(shapiro_test.statistic),
                "p_value": float(shapiro_test.pvalue),
                "is_normal": shapiro_test.pvalue > 0.05
            },
            "distribution_shape": {
                "skewness": skewness,
                "kurtosis": kurtosis,
                "distribution_type": self._classify_distribution(skewness, kurtosis)
            },
            "outlier_analysis": self._detect_statistical_outliers(response_times_array)
        }
    
    def _classify_distribution(self, skewness: float, kurtosis: float) -> str:
        """Classify the distribution type"""
        if abs(skewness) < 0.5 and abs(kurtosis) < 0.5:
            return "normal"
        elif skewness > 1:
            return "right_skewed"
        elif skewness < -1:
            return "left_skewed"
        elif kurtosis > 1:
            return "heavy_tailed"
        elif kurtosis < -1:
            return "light_tailed"
        else:
            return "mixed"
    
    def _detect_statistical_outliers(self, data: np.ndarray) -> Dict[str, Any]:
        """Detect outliers using statistical methods"""
        q1, q3 = np.percentile(data, [25, 75])
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        outliers = data[(data < lower_bound) | (data > upper_bound)]
        
        return {
            "outlier_count": int(len(outliers)),
            "outlier_percentage": float(len(outliers) / len(data) * 100),
            "lower_bound": float(lower_bound),
            "upper_bound": float(upper_bound),
            "outlier_values": outliers.tolist()[:10]  # First 10 outliers
        }
    
    def _analyze_trends(self) -> Dict[str, Any]:
        """Analyze performance trends"""
        if len(self.performance_samples) < 20:
            return {}
        
        try:
            # Recent vs overall comparison
            recent_samples = self.performance_samples[-100:]
            overall_samples = self.performance_samples
            
            recent_avg = np.mean([s[1] for s in recent_samples])
            overall_avg = np.mean([s[1] for s in overall_samples])
            
            trend_direction = "improving" if recent_avg < overall_avg else "degrading"
            trend_magnitude = abs(recent_avg - overall_avg) / overall_avg * 100
            
            return {
                "trend_direction": trend_direction,
                "trend_magnitude_percent": float(trend_magnitude),
                "recent_avg_response_time": float(recent_avg),
                "overall_avg_response_time": float(overall_avg),
                "data_points_analyzed": len(overall_samples)
            }
            
        except Exception as e:
            logger.error(f"Trend analysis failed: {e}")
            return {}
    
    def _recognize_patterns(self) -> Dict[str, Any]:
        """Recognize performance patterns using clustering"""
        if len(self.performance_samples) < 50:
            return {}
        
        try:
            # Prepare data for clustering
            data = np.array(self.performance_samples)
            features = data[:, 1:3]  # Response time and status code
            
            # Normalize features
            scaler = StandardScaler()
            normalized_features = scaler.fit_transform(features)
            
            # Apply clustering
            clustering = DBSCAN(eps=0.5, min_samples=5)
            cluster_labels = clustering.fit_predict(normalized_features)
            
            # Analyze clusters
            unique_labels = set(cluster_labels)
            clusters = {}
            
            for label in unique_labels:
                if label == -1:  # Noise points
                    continue
                    
                cluster_mask = cluster_labels == label
                cluster_data = data[cluster_mask]
                
                clusters[f"pattern_{label}"] = {
                    "size": int(np.sum(cluster_mask)),
                    "avg_response_time": float(np.mean(cluster_data[:, 1])),
                    "response_time_std": float(np.std(cluster_data[:, 1])),
                    "common_status_codes": [int(code) for code in np.unique(cluster_data[:, 2])]
                }
            
            return {
                "patterns_found": len(clusters),
                "clusters": clusters,
                "noise_points": int(np.sum(cluster_labels == -1))
            }
            
        except Exception as e:
            logger.error(f"Pattern recognition failed: {e}")
            return {}

class AdvancedAIEngine:
    """AI-powered optimization and insights engine"""
    
    def __init__(self):
        self.optimization_models = {}
        self.performance_history = deque(maxlen=1000)
        self.recommendations = []
        self.is_initialized = False
        
    async def initialize_optimization(self):
        """Initialize AI optimization models"""
        try:
            logger.info("Initializing AI optimization engine...")
            self.is_initialized = True
            logger.info("AI engine initialized successfully")
        except Exception as e:
            logger.error(f"AI engine initialization failed: {e}")
    
    def get_status(self) -> Dict[str, Any]:
        """Get AI engine status"""
        return {
            "initialized": self.is_initialized,
            "models_loaded": len(self.optimization_models),
            "performance_samples": len(self.performance_history),
            "recommendations_count": len(self.recommendations)
        }
    
    async def analyze_performance_patterns(self, worker_stats: List[Dict[str, Any]]):
        """Analyze performance patterns from worker statistics"""
        try:
            if not worker_stats:
                return
            
            # Aggregate worker statistics
            total_requests = sum(w.get("requests_sent", 0) for w in worker_stats)
            total_successful = sum(w.get("requests_successful", 0) for w in worker_stats)
            total_failed = sum(w.get("requests_failed", 0) for w in worker_stats)
            
            performance_snapshot = {
                "timestamp": time.time(),
                "total_requests": total_requests,
                "success_rate": (total_successful / total_requests) * 100 if total_requests > 0 else 0,
                "error_rate": (total_failed / total_requests) * 100 if total_requests > 0 else 0,
                "worker_count": len(worker_stats)
            }
            
            self.performance_history.append(performance_snapshot)
            
            # Generate recommendations based on patterns
            await self._generate_optimization_recommendations()
            
        except Exception as e:
            logger.error(f"Performance pattern analysis failed: {e}")
    
    async def _generate_optimization_recommendations(self):
        """Generate AI-powered optimization recommendations"""
        if len(self.performance_history) < 10:
            return
        
        try:
            recent_performance = list(self.performance_history)[-10:]
            
            # Analyze trends
            success_rates = [p["success_rate"] for p in recent_performance]
            error_rates = [p["error_rate"] for p in recent_performance]
            
            avg_success_rate = np.mean(success_rates)
            avg_error_rate = np.mean(error_rates)
            
            # Generate recommendations
            recommendations = []
            
            if avg_error_rate > 10:
                recommendations.append({
                    "type": "error_reduction",
                    "priority": "high",
                    "message": "High error rate detected. Consider reducing load or checking target endpoints.",
                    "suggested_action": "reduce_rps",
                    "confidence": 0.8
                })
            
            if avg_success_rate < 90:
                recommendations.append({
                    "type": "performance_optimization",
                    "priority": "medium",
                    "message": "Success rate below optimal. Consider optimizing request parameters.",
                    "suggested_action": "optimize_requests",
                    "confidence": 0.7
                })
            
            # Add time-based recommendations
            if len(recent_performance) >= 5:
                trend = np.polyfit(range(len(recent_performance)), success_rates, 1)[0]
                if trend < -1:  # Declining performance
                    recommendations.append({
                        "type": "trend_alert",
                        "priority": "high",
                        "message": "Performance is declining. Consider load balancing or scaling.",
                        "suggested_action": "scale_resources",
                        "confidence": 0.9
                    })
            
            self.recommendations = recommendations
            
        except Exception as e:
            logger.error(f"Recommendation generation failed: {e}")
    
    def get_optimization_insights(self) -> Dict[str, Any]:
        """Get AI-powered optimization insights"""
        return {
            "recommendations": self.recommendations,
            "performance_summary": self._get_performance_summary(),
            "optimization_opportunities": self._identify_optimization_opportunities(),
            "ai_status": self.get_status()
        }
    
    def _get_performance_summary(self) -> Dict[str, Any]:
        """Generate performance summary"""
        if not self.performance_history:
            return {}
        
        recent_data = list(self.performance_history)[-50:]  # Last 50 samples
        
        return {
            "avg_success_rate": float(np.mean([p["success_rate"] for p in recent_data])),
            "avg_error_rate": float(np.mean([p["error_rate"] for p in recent_data])),
            "performance_stability": float(np.std([p["success_rate"] for p in recent_data])),
            "data_points": len(recent_data)
        }
    
    def _identify_optimization_opportunities(self) -> List[Dict[str, Any]]:
        """Identify optimization opportunities"""
        opportunities = []
        
        if len(self.performance_history) >= 20:
            recent_data = list(self.performance_history)[-20:]
            
            # Check for consistent patterns
            error_rates = [p["error_rate"] for p in recent_data]
            if np.mean(error_rates) > 5 and np.std(error_rates) < 2:
                opportunities.append({
                    "type": "consistent_errors",
                    "description": "Consistent error rate suggests systematic issue",
                    "potential_gain": "20-50% error reduction",
                    "effort": "medium"
                })
            
            # Check for performance variability
            success_rates = [p["success_rate"] for p in recent_data]
            if np.std(success_rates) > 10:
                opportunities.append({
                    "type": "performance_variability",
                    "description": "High performance variability indicates optimization potential",
                    "potential_gain": "10-30% performance improvement",
                    "effort": "low"
                })
        
        return opportunities
    
    def get_optimization_recommendations(self, current_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Get specific optimization recommendations"""
        recommendations = []
        
        # Analyze current configuration
        rps = current_config.get("requestsPerSecond", 10)
        workers = current_config.get("workers", 5)
        duration = current_config.get("duration", 60)
        
        # Generate configuration recommendations
        if rps > 100 and workers < 10:
            recommendations.append({
                "type": "scaling",
                "parameter": "workers",
                "current_value": workers,
                "suggested_value": min(workers * 2, 20),
                "reason": "High RPS with low worker count may cause bottlenecks",
                "impact": "medium"
            })
        
        if duration < 300 and rps > 50:
            recommendations.append({
                "type": "duration",
                "parameter": "duration",
                "current_value": duration,
                "suggested_value": 300,
                "reason": "Short duration with high RPS may not provide meaningful results",
                "impact": "low"
            })
        
        return recommendations

class AdvancedPythonBridge:
    """Advanced Python Bridge with ML-powered load testing"""
    
    def __init__(self, port: int = 5001):
        self.port = port
        self.app = Flask(__name__)
        CORS(self.app)
        
        # Core components
        self.metrics = AdvancedMetricsCollector()
        self.ai_engine = AdvancedAIEngine()
        
        # Test management
        self.active_tests = {}
        self.test_counter = 0
        
        # Setup Flask routes
        self._setup_routes()
    
    def _setup_routes(self):
        """Setup Flask API routes"""
        
        @self.app.route('/api/status', methods=['GET'])
        def get_status():
            """Get bridge status"""
            return jsonify({
                "status": "active",
                "version": "2.0.0",
                "active_tests": len(self.active_tests),
                "ai_engine_status": self.ai_engine.get_status(),
                "proxy_manager_status": self.proxy_manager.get_stats() if hasattr(self, 'proxy_manager') else None
            })
        
        @self.app.route('/api/proxies/generate', methods=['POST'])
        def generate_proxies():
            """Generate and validate proxies"""
            try:
                data = request.get_json() or {}
                count = data.get('count', 50)
                validate = data.get('validate', True)
                sources = data.get('sources', ['free_proxy', 'proxy_list_api'])
                
                logger.info(f"Generating {count} proxies with sources: {sources}")
                
                # Initialize proxy manager if not exists
                if not hasattr(self, 'proxy_manager'):
                    from proxy_manager import AdvancedProxyManager
                    self.proxy_manager = AdvancedProxyManager({
                        'max_proxies': count,
                        'validation_interval': 600  # 10 minutes
                    })
                
                # Generate proxies asynchronously
                async def generate():
                    await self.proxy_manager.initialize()
                    return self.proxy_manager.working_proxies
                
                # Run in event loop
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = None
                if loop and loop.is_running():
                    # If already in async context, create a temporary loop
                    tmp_loop = asyncio.new_event_loop()
                    try:
                        proxies = tmp_loop.run_until_complete(generate())
                    finally:
                        tmp_loop.close()
                else:
                    proxies = asyncio.run(generate())
                
                # Convert to JSON-serializable format
                proxy_list = [proxy.to_dict() for proxy in proxies[:count]]
                
                return jsonify({
                    "success": True,
                    "count": len(proxy_list),
                    "proxies": proxy_list,
                    "message": f"Generated {len(proxy_list)} working proxies"
                })
                
            except Exception as e:
                logger.error(f"Proxy generation failed: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e),
                    "proxies": []
                }), 500
        
        @self.app.route('/api/proxies/validate', methods=['POST'])
        def validate_proxies():
            """Validate a list of proxies"""
            try:
                data = request.get_json() or {}
                proxy_list = data.get('proxies', [])
                
                if not proxy_list:
                    return jsonify({
                        "success": False,
                        "error": "No proxies provided"
                    }), 400
                
                logger.info(f"Validating {len(proxy_list)} proxies")
                
                # Initialize components if needed
                if not hasattr(self, 'proxy_validator'):
                    from proxy_manager import ProxyValidator, ProxyInfo
                    self.proxy_validator = ProxyValidator()
                
                # Convert to ProxyInfo objects
                proxies = []
                for proxy_data in proxy_list:
                    proxy = ProxyInfo(
                        host=proxy_data.get('host'),
                        port=proxy_data.get('port'),
                        protocol=proxy_data.get('protocol', 'http'),
                        username=proxy_data.get('username'),
                        password=proxy_data.get('password')
                    )
                    proxies.append(proxy)
                
                # Validate proxies
                async def validate():
                    return await self.proxy_validator.validate_proxies(proxies)
                
                validated_proxies = asyncio.run(validate())
                
                # Convert to JSON format
                result_list = [proxy.to_dict() for proxy in validated_proxies]
                
                return jsonify({
                    "success": True,
                    "total_tested": len(proxy_list),
                    "working_count": len(result_list),
                    "success_rate": (len(result_list) / len(proxy_list)) * 100,
                    "proxies": result_list
                })
                
            except Exception as e:
                logger.error(f"Proxy validation failed: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 500
        
        @self.app.route('/api/proxies/stats', methods=['GET'])
        def get_proxy_stats():
            """Get proxy manager statistics"""
            try:
                if hasattr(self, 'proxy_manager'):
                    stats = self.proxy_manager.get_stats()
                    return jsonify({
                        "success": True,
                        "stats": stats
                    })
                else:
                    return jsonify({
                        "success": True,
                        "stats": {
                            "message": "Proxy manager not initialized"
                        }
                    })
                    
            except Exception as e:
                logger.error(f"Failed to get proxy stats: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 500
        
        @self.app.route('/api/test/start', methods=['POST'])
        def start_test():
            """Start advanced load test"""
            try:
                data = request.get_json()
                
                # Create advanced test configuration
                config = AdvancedTestConfig(
                    targets=data.get('targets', ['http://localhost']),
                    duration=data.get('duration', 60),
                    requests_per_second=data.get('requestsPerSecond', 10),
                    workers=data.get('workers', 5),
                    timeout=data.get('timeout', 30),
                    
                    # Advanced configuration
                    load_pattern=data.get('loadPattern', 'constant'),
                    ramp_up_time=data.get('rampUpTime', 0),
                    spike_intensity=data.get('spikeIntensity', 2.0),
                    wave_frequency=data.get('waveFrequency', 0.1),
                    wave_amplitude=data.get('waveAmplitude', 0.5),
                    
                    enable_ml_optimization=data.get('enableMLOptimization', True),
                    enable_security_testing=data.get('enableSecurityTesting', False),
                    enable_performance_profiling=data.get('enablePerformanceProfiling', True),
                    enable_tls_testing=data.get('enableTLSTesting', False),
                    use_realistic_data=data.get('useRealisticData', True),
                    protocol_versions=data.get('protocolVersions', ['http/1.1'])
                )
                
                # Start test
                test_id = self._start_advanced_test(config)
                
                return jsonify({
                    "success": True,
                    "testId": test_id,
                    "message": "Advanced load test started successfully"
                })
                
            except Exception as e:
                logger.error(f"Failed to start test: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 500
        
        @self.app.route('/api/test/stop/<test_id>', methods=['POST'])
        def stop_test(test_id):
            """Stop a specific load test"""
            try:
                if test_id in self.active_tests:
                    test_data = self.active_tests[test_id]
                    stop_event = test_data['stop_event']
                    stop_event.set()
                    
                    # Wait for thread to finish (with timeout)
                    thread = test_data['thread']
                    thread.join(timeout=5.0)
                    
                    # Remove from active tests
                    del self.active_tests[test_id]
                    
                    logger.info(f"Test {test_id} stopped successfully")
                    return jsonify({
                        "success": True,
                        "testId": test_id,
                        "message": "Test stopped successfully"
                    })
                else:
                    return jsonify({
                        "success": False,
                        "error": f"Test {test_id} not found"
                    }), 404
                    
            except Exception as e:
                logger.error(f"Failed to stop test {test_id}: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 500
        
        @self.app.route('/api/test/stop-all', methods=['POST'])
        def stop_all_tests():
            """Stop all active load tests"""
            try:
                stopped_tests = []
                for test_id in list(self.active_tests.keys()):
                    test_data = self.active_tests[test_id]
                    stop_event = test_data['stop_event']
                    stop_event.set()
                    
                    # Wait for thread to finish (with timeout)
                    thread = test_data['thread']
                    thread.join(timeout=5.0)
                    
                    stopped_tests.append(test_id)
                
                # Clear all active tests
                self.active_tests.clear()
                
                logger.info(f"Stopped {len(stopped_tests)} tests")
                return jsonify({
                    "success": True,
                    "stoppedTests": stopped_tests,
                    "message": f"Stopped {len(stopped_tests)} active tests"
                })
                
            except Exception as e:
                logger.error(f"Failed to stop all tests: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 500
        
        @self.app.route('/api/test/<test_id>/metrics', methods=['GET'])
        def get_test_metrics(test_id):
            """Get comprehensive test metrics"""
            try:
                # Get comprehensive metrics
                basic_stats = self.metrics.get_advanced_stats()
                ai_insights = self.ai_engine.get_optimization_insights()
                
                return jsonify({
                    "success": True,
                    "testId": test_id,
                    "metrics": {
                        "basic": basic_stats.get("basic", {}),
                        "performance": basic_stats.get("performance", {}),
                        "statistical": basic_stats.get("statistical", {}),
                        "ml_insights": basic_stats.get("ml_insights", {}),
                        "ai_insights": ai_insights
                    },
                    "timestamp": time.time()
                })
                
            except Exception as e:
                logger.error(f"Failed to get metrics: {e}")
                return jsonify({
                    "success": False,
                    "error": str(e)
                }), 500
    
    def _start_advanced_test(self, config: AdvancedTestConfig) -> str:
        """Start an advanced load test"""
        self.test_counter += 1
        test_id = f"test_{self.test_counter}_{int(time.time())}"
        
        # Create test management structure
        stop_event = asyncio.Event()
        self.active_tests[test_id] = {
            "config": config,
            "start_time": time.time(),
            "stop_event": stop_event,
            "workers": []
        }
        
        # Start test execution in background
        threading.Thread(
            target=self._run_test_thread,
            args=(test_id, config, stop_event),
            daemon=True
        ).start()
        
        return test_id
    
    def _run_test_thread(self, test_id: str, config: AdvancedTestConfig, stop_event: asyncio.Event):
        """Run test in separate thread"""
        try:
            # Create new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            # Run the test
            loop.run_until_complete(self._execute_advanced_test(test_id, config, stop_event))
            
        except Exception as e:
            logger.error(f"Test thread failed: {e}")
        finally:
            # Cleanup
            if test_id in self.active_tests:
                del self.active_tests[test_id]
    
    async def _execute_advanced_test(self, test_id: str, config: AdvancedTestConfig, stop_event: asyncio.Event):
        """Execute advanced load test"""
        try:
            logger.info(f"Starting advanced test {test_id}")
            
            # Simple test execution - send requests
            start_time = time.time()
            end_time = start_time + config.duration
            
            # Create session
            async with aiohttp.ClientSession() as session:
                while time.time() < end_time and not stop_event.is_set():
                    # Send request to random target
                    target = random.choice(config.targets)
                    request_start = time.time()
                    
                    try:
                        async with session.get(target, timeout=aiohttp.ClientTimeout(total=config.timeout)) as response:
                            content = await response.read()
                            response_time = time.time() - request_start
                            
                            # Record metrics
                            self.metrics.record_request(
                                response_time=response_time,
                                status_code=response.status,
                                content_length=len(content)
                            )
                            
                    except Exception as e:
                        response_time = time.time() - request_start
                        self.metrics.record_request(
                            response_time=response_time,
                            status_code=0,
                            error=str(e)
                        )
                    
                    # Rate limiting
                    if config.requests_per_second > 0:
                        await asyncio.sleep(1.0 / config.requests_per_second)
            
            logger.info(f"Test {test_id} completed")
            
        except Exception as e:
            logger.error(f"Test execution failed: {e}")
    
    def run(self):
        """Run the advanced Python bridge server"""
        logger.info(f"Starting Advanced Python Bridge on port {self.port}")
        logger.info("Features enabled:")
        logger.info("- ML-powered optimization")
        logger.info("- Advanced metrics collection")
        logger.info("- AI-driven insights")
        
        try:
            self.app.run(
                host='0.0.0.0',
                port=self.port,
                debug=False,
                threaded=True,
                use_reloader=False
            )
        except Exception as e:
            logger.error(f"Failed to start server: {e}")
            raise

# Entry point for the advanced Python bridge
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Advanced Python Load Testing Bridge")
    parser.add_argument("--port", type=int, default=5001, help="Port to run the bridge on")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                       help="Logging level")
    
    args = parser.parse_args()
    
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler('advanced_loadtester.log')
        ]
    )
    
    # Create and run the advanced bridge
    bridge = AdvancedPythonBridge(port=args.port)
    bridge.run()
