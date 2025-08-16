#!/usr/bin/env python3
"""
Enhanced Python Performance Tracker
==================================

Real-time performance tracking and visualization using Python with:
- Real-time metrics collection
- matplotlib visualizations (post-test)
- Statistical analysis
- Performance predictions
- Data export capabilities
"""

import json
import time
import threading
import statistics
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd
import seaborn as sns
from datetime import datetime, timedelta
from collections import defaultdict, deque
from typing import Dict, List, Any, Optional
import requests
import sqlite3
import os
import warnings
import logging
import queue
import csv
import io
import zipfile
from flask import Flask, request, jsonify, send_file
from flask_socketio import SocketIO, emit
import psutil

# Suppress matplotlib warnings
warnings.filterwarnings('ignore', category=UserWarning)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class EnhancedPythonPerformanceTracker:
    def __init__(self, js_server_url='http://localhost:3000', 
                 db_path='./logs/performance.db',
                 reports_dir='./reports'):
        self.js_server_url = js_server_url
        self.db_path = db_path
        self.reports_dir = reports_dir
        self.is_tracking = False
        self.tracking_thread = None
        
        # Real-time data storage
        self.metrics_history = defaultdict(deque)
        self.test_sessions = {}
        self.current_tests = {}
        self.active_tests = {}
        self.performance_data = defaultdict(list)
        self.system_metrics = {}
        self.request_queue = queue.Queue()
        
        # Statistical data
        self.response_times = deque(maxlen=10000)
        self.request_rates = deque(maxlen=1000)
        self.error_rates = deque(maxlen=1000)
        
        # Ensure directories exist
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        os.makedirs(self.reports_dir, exist_ok=True)
        os.makedirs('./logs', exist_ok=True)
        
        # Initialize database
        self.init_database()
        
        # Set matplotlib style
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
        logger.info("Enhanced Python Performance Tracker initialized")

    def init_database(self):
        """Initialize SQLite database for persistent storage"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Create tables
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS test_sessions (
                    id TEXT PRIMARY KEY,
                    start_time TIMESTAMP,
                    end_time TIMESTAMP,
                    config TEXT,
                    status TEXT,
                    total_requests INTEGER,
                    total_errors INTEGER,
                    avg_response_time REAL,
                    max_response_time REAL,
                    min_response_time REAL,
                    throughput REAL
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    test_id TEXT,
                    timestamp TIMESTAMP,
                    metric_type TEXT,
                    metric_value REAL,
                    FOREIGN KEY (test_id) REFERENCES test_sessions (id)
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    test_id TEXT,
                    timestamp TIMESTAMP,
                    url TEXT,
                    method TEXT,
                    status_code INTEGER,
                    response_time REAL,
                    success BOOLEAN,
                    FOREIGN KEY (test_id) REFERENCES test_sessions (id)
                )
            ''')
            
            conn.commit()
            conn.close()
            logger.info("Database initialized successfully")
            
        except Exception as e:
            logger.error(f"Database initialization failed: {e}")

    def start_tracking(self):
        """Start real-time performance tracking"""
        if self.is_tracking:
            logger.warning("Tracking is already running")
            return
            
        self.is_tracking = True
        self.tracking_thread = threading.Thread(target=self._tracking_loop, daemon=True)
        self.tracking_thread.start()
        logger.info("Started real-time performance tracking")

    def stop_tracking(self):
        """Stop real-time performance tracking"""
        self.is_tracking = False
        if self.tracking_thread:
            self.tracking_thread.join(timeout=5)
        logger.info("Stopped performance tracking")

    def _tracking_loop(self):
        """Main tracking loop that runs in a separate thread"""
        while self.is_tracking:
            try:
                # Fetch metrics from JavaScript server
                self._fetch_metrics()
                
                # Update system metrics
                self._update_system_metrics()
                
                # Process pending requests
                self._process_pending_requests()
                
                # Update statistics
                self._update_statistics()
                
                # Check for completed tests
                self._check_completed_tests()
                
                time.sleep(1)  # Update every second
                
            except Exception as e:
                logger.error(f"Error in tracking loop: {e}")
                time.sleep(2)  # Wait longer on error

    def _fetch_metrics(self):
        """Fetch current metrics from JavaScript server"""
        try:
            # Get system metrics
            response = requests.get(f"{self.js_server_url}/api/v1/system/metrics", timeout=2)
            if response.status_code == 200:
                data = response.json()
                timestamp = datetime.now()
                
                # Store system metrics
                if 'system' in data:
                    self._store_metric('cpu_usage', data['system'].get('cpu', 0), timestamp)
                    self._store_metric('memory_usage', data['system'].get('memory', 0), timestamp)
                
                if 'performance' in data:
                    perf = data['performance']
                    self._store_metric('total_requests', perf.get('totalRequests', 0), timestamp)
                    self._store_metric('avg_response_time', perf.get('averageResponseTime', 0), timestamp)
                    self._store_metric('requests_per_second', perf.get('requestsPerSecond', 0), timestamp)
                    self._store_metric('error_rate', perf.get('errorRate', 0), timestamp)
            
            # Get active tests
            response = requests.get(f"{self.js_server_url}/api/v1/tests/active", timeout=2)
            if response.status_code == 200:
                data = response.json()
                self._update_active_tests(data.get('activeTests', []))
                
        except requests.RequestException as e:
            logger.debug(f"Failed to fetch metrics: {e}")
        except Exception as e:
            logger.error(f"Error processing metrics: {e}")

    def _store_metric(self, metric_type: str, value: float, timestamp: datetime):
        """Store a metric value with timestamp"""
        self.metrics_history[metric_type].append((timestamp, value))
        
        # Keep only last 1000 points for memory efficiency
        if len(self.metrics_history[metric_type]) > 1000:
            self.metrics_history[metric_type].popleft()

    def _update_active_tests(self, active_tests: List[Dict]):
        """Update information about active tests"""
        current_test_ids = set()
        
        for test in active_tests:
            test_id = test.get('id')
            if test_id:
                current_test_ids.add(test_id)
                
                if test_id not in self.current_tests:
                    # New test started
                    self.current_tests[test_id] = {
                        'start_time': datetime.now(),
                        'config': test.get('config', {}),
                        'metrics': defaultdict(list)
                    }
                    logger.info(f"New test detected: {test_id}")
                
                # Update test metrics
                if 'metrics' in test:
                    test_metrics = test['metrics']
                    timestamp = datetime.now()
                    
                    for key, value in test_metrics.items():
                        if isinstance(value, (int, float)):
                            self.current_tests[test_id]['metrics'][key].append((timestamp, value))
        
        # Remove completed tests
        completed_tests = set(self.current_tests.keys()) - current_test_ids
        for test_id in completed_tests:
            self._process_completed_test(test_id)

    def _update_system_metrics(self):
        """Update system performance metrics"""
        try:
            self.system_metrics = {
                'timestamp': time.time() * 1000,
                'cpu_percent': psutil.cpu_percent(interval=None),
                'memory_percent': psutil.virtual_memory().percent,
                'disk_usage': psutil.disk_usage('/').percent if os.name != 'nt' else psutil.disk_usage('C:').percent,
                'network_io': dict(psutil.net_io_counters()._asdict()) if hasattr(psutil.net_io_counters(), '_asdict') else {},
                'process_count': len(psutil.pids())
            }
        except Exception as e:
            logger.error(f"Error updating system metrics: {e}")

    def _process_pending_requests(self):
        """Process pending request data"""
        processed = 0
        while not self.request_queue.empty() and processed < 100:  # Process max 100 per cycle
            try:
                request_data = self.request_queue.get_nowait()
                self._record_request_metrics(request_data)
                processed += 1
            except queue.Empty:
                break
            except Exception as e:
                logger.error(f"Error processing request data: {e}")

    def _update_statistics(self):
        """Update running statistics"""
        if 'avg_response_time' in self.metrics_history:
            response_times = [v for _, v in self.metrics_history['avg_response_time']]
            if response_times:
                self.response_times.extend(response_times[-10:])  # Add last 10 values
        
        if 'requests_per_second' in self.metrics_history:
            rps_values = [v for _, v in self.metrics_history['requests_per_second']]
            if rps_values:
                self.request_rates.extend(rps_values[-10:])
        
        if 'error_rate' in self.metrics_history:
            error_values = [v for _, v in self.metrics_history['error_rate']]
            if error_values:
                self.error_rates.extend(error_values[-10:])

    def _check_completed_tests(self):
        """Check for tests that have completed"""
        # This will be called when tests are removed from active tests
        pass

    def _process_completed_test(self, test_id: str):
        """Process a completed test and generate reports"""
        if test_id not in self.current_tests:
            return
        
        test_data = self.current_tests[test_id]
        test_data['end_time'] = datetime.now()
        
        # Move to completed tests
        self.test_sessions[test_id] = test_data
        del self.current_tests[test_id]
        
        logger.info(f"Test completed: {test_id}")
        
        # Save to database
        self._save_test_to_db(test_id, test_data)
        
        # Generate visualization
        threading.Thread(target=self._generate_test_report, args=(test_id, test_data), daemon=True).start()

    def _save_test_to_db(self, test_id: str, test_data: Dict):
        """Save test data to database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Calculate summary statistics
            metrics = test_data['metrics']
            total_requests = max([v for _, v in metrics.get('requests', [(None, 0)])], default=0)
            total_errors = max([v for _, v in metrics.get('errors', [(None, 0)])], default=0)
            
            response_times = [v for _, v in metrics.get('averageResponseTime', [])]
            avg_response_time = statistics.mean(response_times) if response_times else 0
            max_response_time = max(response_times) if response_times else 0
            min_response_time = min(response_times) if response_times else 0
            
            rps_values = [v for _, v in metrics.get('currentRPS', [])]
            throughput = statistics.mean(rps_values) if rps_values else 0
            
            # Insert test session
            cursor.execute('''
                INSERT OR REPLACE INTO test_sessions 
                (id, start_time, end_time, config, status, total_requests, total_errors, 
                 avg_response_time, max_response_time, min_response_time, throughput)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                test_id,
                test_data['start_time'],
                test_data['end_time'],
                json.dumps(test_data['config']),
                'completed',
                total_requests,
                total_errors,
                avg_response_time,
                max_response_time,
                min_response_time,
                throughput
            ))
            
            # Insert individual metrics
            for metric_type, values in metrics.items():
                for timestamp, value in values:
                    cursor.execute('''
                        INSERT INTO metrics (test_id, timestamp, metric_type, metric_value)
                        VALUES (?, ?, ?, ?)
                    ''', (test_id, timestamp, metric_type, value))
            
            conn.commit()
            conn.close()
            logger.info(f"Test {test_id} saved to database")
            
        except Exception as e:
            logger.error(f"Error saving test to database: {e}")

    def _generate_test_report(self, test_id: str, test_data: Dict):
        """Generate comprehensive test report with visualizations"""
        try:
            logger.info(f"Generating report for test {test_id}")
            
            # Create figure with subplots
            fig, axes = plt.subplots(2, 3, figsize=(20, 12))
            fig.suptitle(f'Load Test Report - {test_id[:8]}', fontsize=16, fontweight='bold')
            
            metrics = test_data['metrics']
            
            # 1. Response Time Over Time
            if 'averageResponseTime' in metrics:
                timestamps, values = zip(*metrics['averageResponseTime'])
                axes[0, 0].plot(timestamps, values, color='blue', linewidth=2)
                axes[0, 0].set_title('Response Time Over Time')
                axes[0, 0].set_ylabel('Response Time (ms)')
                axes[0, 0].grid(True, alpha=0.3)
                axes[0, 0].xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
                plt.setp(axes[0, 0].xaxis.get_majorticklabels(), rotation=45)
            
            # 2. Requests Per Second
            if 'currentRPS' in metrics:
                timestamps, values = zip(*metrics['currentRPS'])
                axes[0, 1].plot(timestamps, values, color='green', linewidth=2)
                axes[0, 1].set_title('Requests Per Second')
                axes[0, 1].set_ylabel('RPS')
                axes[0, 1].grid(True, alpha=0.3)
                axes[0, 1].xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
                plt.setp(axes[0, 1].xaxis.get_majorticklabels(), rotation=45)
            
            # 3. Error Rate
            if 'errorRate' in metrics:
                timestamps, values = zip(*metrics['errorRate'])
                axes[0, 2].plot(timestamps, values, color='red', linewidth=2)
                axes[0, 2].set_title('Error Rate Over Time')
                axes[0, 2].set_ylabel('Error Rate (%)')
                axes[0, 2].grid(True, alpha=0.3)
                axes[0, 2].xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
                plt.setp(axes[0, 2].xaxis.get_majorticklabels(), rotation=45)
            
            # 4. Response Time Distribution
            if 'averageResponseTime' in metrics:
                _, values = zip(*metrics['averageResponseTime'])
                axes[1, 0].hist(values, bins=30, alpha=0.7, color='purple', edgecolor='black')
                axes[1, 0].set_title('Response Time Distribution')
                axes[1, 0].set_xlabel('Response Time (ms)')
                axes[1, 0].set_ylabel('Frequency')
                axes[1, 0].grid(True, alpha=0.3)
            
            # 5. Throughput vs Response Time
            if 'currentRPS' in metrics and 'averageResponseTime' in metrics:
                rps_data = dict(metrics['currentRPS'])
                rt_data = dict(metrics['averageResponseTime'])
                
                # Align timestamps
                common_times = set(rps_data.keys()) & set(rt_data.keys())
                if common_times:
                    rps_values = [rps_data[t] for t in common_times]
                    rt_values = [rt_data[t] for t in common_times]
                    
                    axes[1, 1].scatter(rps_values, rt_values, alpha=0.6, color='orange')
                    axes[1, 1].set_title('Throughput vs Response Time')
                    axes[1, 1].set_xlabel('Requests Per Second')
                    axes[1, 1].set_ylabel('Response Time (ms)')
                    axes[1, 1].grid(True, alpha=0.3)
            
            # 6. Test Summary
            axes[1, 2].axis('off')
            
            # Calculate summary statistics
            duration = (test_data['end_time'] - test_data['start_time']).total_seconds()
            total_requests = max([v for _, v in metrics.get('requests', [(None, 0)])], default=0)
            total_errors = max([v for _, v in metrics.get('errors', [(None, 0)])], default=0)
            
            response_times = [v for _, v in metrics.get('averageResponseTime', [])]
            avg_rt = statistics.mean(response_times) if response_times else 0
            p95_rt = np.percentile(response_times, 95) if response_times else 0
            p99_rt = np.percentile(response_times, 99) if response_times else 0
            
            rps_values = [v for _, v in metrics.get('currentRPS', [])]
            avg_rps = statistics.mean(rps_values) if rps_values else 0
            
            summary_text = f'''Test Summary
Duration: {duration:.1f}s
Total Requests: {total_requests:,}
Total Errors: {total_errors:,}
Error Rate: {(total_errors/total_requests*100) if total_requests > 0 else 0:.2f}%

Response Time:
  Average: {avg_rt:.1f}ms
  95th percentile: {p95_rt:.1f}ms
  99th percentile: {p99_rt:.1f}ms

Throughput:
  Average RPS: {avg_rps:.1f}
  Peak RPS: {max(rps_values) if rps_values else 0:.1f}

Configuration:
  Workers: {test_data['config'].get('workers', 'N/A')}
  Duration: {test_data['config'].get('duration', 'N/A')}s
  Target RPS: {test_data['config'].get('requestsPerSecond', 'N/A')}
'''
            
            axes[1, 2].text(0.05, 0.95, summary_text, transform=axes[1, 2].transAxes,
                           fontsize=10, verticalalignment='top', fontfamily='monospace',
                           bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
            
            # Adjust layout
            plt.tight_layout()
            
            # Save the plot
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{self.reports_dir}/test_report_{test_id[:8]}_{timestamp}.png"
            plt.savefig(filename, dpi=300, bbox_inches='tight')
            plt.close()
            
            logger.info(f"Test report saved: {filename}")
            
            # Generate CSV data export
            self._export_test_data(test_id, test_data)
            
        except Exception as e:
            logger.error(f"Error generating test report: {e}")

    def _export_test_data(self, test_id: str, test_data: Dict):
        """Export test data to CSV"""
        try:
            # Prepare data for export
            metrics = test_data['metrics']
            
            # Create DataFrame
            data_rows = []
            for metric_type, values in metrics.items():
                for timestamp, value in values:
                    data_rows.append({
                        'test_id': test_id,
                        'timestamp': timestamp,
                        'metric_type': metric_type,
                        'value': value
                    })
            
            if data_rows:
                df = pd.DataFrame(data_rows)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = f"{self.reports_dir}/test_data_{test_id[:8]}_{timestamp}.csv"
                df.to_csv(filename, index=False)
                logger.info(f"Test data exported: {filename}")
            
        except Exception as e:
            logger.error(f"Error exporting test data: {e}")

    def generate_overall_report(self):
        """Generate an overall performance report for all tests"""
        try:
            logger.info("Generating overall performance report")
            
            # Get all test data from database
            conn = sqlite3.connect(self.db_path)
            df = pd.read_sql_query('''
                SELECT * FROM test_sessions 
                WHERE status = 'completed' 
                ORDER BY start_time DESC 
                LIMIT 20
            ''', conn)
            conn.close()
            
            if df.empty:
                logger.warning("No completed tests found for overall report")
                return
            
            # Create comprehensive report
            fig, axes = plt.subplots(2, 2, figsize=(16, 12))
            fig.suptitle('Overall Performance Report', fontsize=16, fontweight='bold')
            
            # 1. Average Response Time Trends
            df['start_time'] = pd.to_datetime(df['start_time'])
            axes[0, 0].plot(df['start_time'], df['avg_response_time'], marker='o', linewidth=2)
            axes[0, 0].set_title('Average Response Time Trends')
            axes[0, 0].set_ylabel('Response Time (ms)')
            axes[0, 0].grid(True, alpha=0.3)
            axes[0, 0].tick_params(axis='x', rotation=45)
            
            # 2. Throughput Comparison
            axes[0, 1].bar(range(len(df)), df['throughput'], color='green', alpha=0.7)
            axes[0, 1].set_title('Throughput Comparison')
            axes[0, 1].set_ylabel('Requests/Second')
            axes[0, 1].set_xlabel('Test Session')
            axes[0, 1].grid(True, alpha=0.3)
            
            # 3. Error Rate Distribution
            error_rates = (df['total_errors'] / df['total_requests'] * 100).fillna(0)
            axes[1, 0].hist(error_rates, bins=15, alpha=0.7, color='red', edgecolor='black')
            axes[1, 0].set_title('Error Rate Distribution')
            axes[1, 0].set_xlabel('Error Rate (%)')
            axes[1, 0].set_ylabel('Frequency')
            axes[1, 0].grid(True, alpha=0.3)
            
            # 4. Performance Summary Table
            axes[1, 1].axis('off')
            
            summary_stats = f'''Performance Summary (Last 20 Tests)

Total Tests: {len(df)}
Average Response Time: {df['avg_response_time'].mean():.1f}ms
Median Response Time: {df['avg_response_time'].median():.1f}ms
Average Throughput: {df['throughput'].mean():.1f} RPS
Total Requests: {df['total_requests'].sum():,}
Total Errors: {df['total_errors'].sum():,}
Overall Error Rate: {(df['total_errors'].sum() / df['total_requests'].sum() * 100):.2f}%

Best Performance:
  Lowest Response Time: {df['avg_response_time'].min():.1f}ms
  Highest Throughput: {df['throughput'].max():.1f} RPS
  Lowest Error Rate: {error_rates.min():.2f}%

Performance Stability:
  Response Time StdDev: {df['avg_response_time'].std():.1f}ms
  Throughput StdDev: {df['throughput'].std():.1f} RPS
'''
            
            axes[1, 1].text(0.05, 0.95, summary_stats, transform=axes[1, 1].transAxes,
                           fontsize=10, verticalalignment='top', fontfamily='monospace',
                           bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.8))
            
            plt.tight_layout()
            
            # Save overall report
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{self.reports_dir}/overall_report_{timestamp}.png"
            plt.savefig(filename, dpi=300, bbox_inches='tight')
            plt.close()
            
            logger.info(f"Overall report saved: {filename}")
            
        except Exception as e:
            logger.error(f"Error generating overall report: {e}")

    def get_current_statistics(self) -> Dict[str, Any]:
        """Get current performance statistics"""
        stats = {}
        
        if self.response_times:
            stats['response_time'] = {
                'mean': statistics.mean(self.response_times),
                'median': statistics.median(self.response_times),
                'stdev': statistics.stdev(self.response_times) if len(self.response_times) > 1 else 0,
                'min': min(self.response_times),
                'max': max(self.response_times),
                'p95': np.percentile(self.response_times, 95),
                'p99': np.percentile(self.response_times, 99)
            }
        
        if self.request_rates:
            stats['request_rate'] = {
                'current': self.request_rates[-1] if self.request_rates else 0,
                'average': statistics.mean(self.request_rates),
                'peak': max(self.request_rates)
            }
        
        if self.error_rates:
            stats['error_rate'] = {
                'current': self.error_rates[-1] if self.error_rates else 0,
                'average': statistics.mean(self.error_rates),
                'max': max(self.error_rates)
            }
        
        stats['active_tests'] = len(self.current_tests)
        stats['total_sessions'] = len(self.test_sessions)
        
        return stats

    def cleanup(self):
        """Cleanup resources"""
        self.stop_tracking()
        
        # Generate final overall report
        if self.test_sessions:
            self.generate_overall_report()
        
        logger.info("Performance tracker cleanup completed")

    # Legacy API methods for compatibility
    def register_test(self, test_id, config):
        """Register a new load test"""
        test_data = {
            'id': test_id,
            'config': config,
            'start_time': time.time() * 1000,
            'end_time': None,
            'status': 'running',
            'metrics': {
                'total_requests': 0,
                'completed_requests': 0,
                'failed_requests': 0,
                'average_response_time': 0,
                'min_response_time': float('inf'),
                'max_response_time': 0,
                'current_rps': 0,
                'error_rate': 0,
                'status_codes': defaultdict(int),
                'response_times': deque(maxlen=1000),
                'throughput': 0
            },
            'progress': {
                'percentage': 0,
                'requests_sent': 0,
                'requests_completed': 0,
                'requests_total': config.get('total_requests', 1000),
                'time_elapsed': 0,
                'time_total': config.get('duration', 60) * 1000
            },
            'real_time_data': deque(maxlen=300),
            'logs': []
        }
        
        self.active_tests[test_id] = test_data
        self.performance_data[test_id] = []
        
        self._log_event(test_id, "Test registered", config)
        return test_data

    def update_test_metrics(self, test_id, metrics_update):
        """Update test metrics with new data"""
        if test_id not in self.active_tests:
            return False
            
        test = self.active_tests[test_id]
        timestamp = time.time() * 1000
        
        # Update basic metrics
        for key, value in metrics_update.items():
            if key in test['metrics']:
                test['metrics'][key] = value

        # Update derived metrics
        if test['metrics']['total_requests'] > 0:
            test['metrics']['error_rate'] = (test['metrics']['failed_requests'] / test['metrics']['total_requests']) * 100

        # Update progress
        time_elapsed = timestamp - test['start_time']
        test['progress']['time_elapsed'] = time_elapsed
        
        if test['progress']['time_total'] > 0:
            time_percentage = min((time_elapsed / test['progress']['time_total']) * 100, 100)
        else:
            time_percentage = 0
            
        if test['progress']['requests_total'] > 0:
            request_percentage = (test['progress']['requests_completed'] / test['progress']['requests_total']) * 100
        else:
            request_percentage = 0
            
        test['progress']['percentage'] = max(time_percentage, request_percentage)

        # Add real-time data point
        data_point = {
            'timestamp': timestamp,
            'rps': test['metrics']['current_rps'],
            'response_time': test['metrics']['average_response_time'],
            'error_rate': test['metrics']['error_rate'],
            'active_requests': metrics_update.get('active_requests', 0)
        }
        
        test['real_time_data'].append(data_point)
        
        # Check if test is complete
        if test['progress']['percentage'] >= 100:
            test['status'] = 'completed'
            test['end_time'] = timestamp
            self._log_event(test_id, "Test completed")

        return True

    def record_request(self, test_id, request_data):
        """Record individual request data"""
        request_data['test_id'] = test_id
        request_data['timestamp'] = time.time() * 1000
        
        try:
            self.request_queue.put_nowait(request_data)
        except queue.Full:
            logger.warning("Request queue full, dropping request data")

    def _record_request_metrics(self, request_data):
        """Process and record request metrics"""
        test_id = request_data['test_id']
        if test_id not in self.active_tests:
            return
            
        test = self.active_tests[test_id]
        
        # Update request counts
        test['metrics']['total_requests'] += 1
        
        if request_data.get('success', True):
            test['metrics']['completed_requests'] += 1
        else:
            test['metrics']['failed_requests'] += 1

        # Update response time metrics
        response_time = request_data.get('response_time', 0)
        if response_time > 0:
            test['metrics']['response_times'].append(response_time)
            test['metrics']['min_response_time'] = min(test['metrics']['min_response_time'], response_time)
            test['metrics']['max_response_time'] = max(test['metrics']['max_response_time'], response_time)
            
            # Calculate average response time
            if test['metrics']['response_times']:
                test['metrics']['average_response_time'] = sum(test['metrics']['response_times']) / len(test['metrics']['response_times'])

        # Update status codes
        status_code = request_data.get('status_code', 0)
        if status_code:
            test['metrics']['status_codes'][str(status_code)] += 1

        # Calculate current RPS
        now = time.time() * 1000
        recent_requests = [t for t in test['metrics']['response_times'] 
                          if now - request_data['timestamp'] < 1000]
        test['metrics']['current_rps'] = len(recent_requests)

        # Update progress
        test['progress']['requests_completed'] = test['metrics']['completed_requests']

    def get_test_data(self, test_id):
        """Get complete test data"""
        if test_id not in self.active_tests:
            return None
            
        test = self.active_tests[test_id]
        return {
            **test,
            'real_time_data': list(test['real_time_data']),
            'response_times': list(test['metrics']['response_times']),
            'status_codes': dict(test['metrics']['status_codes'])
        }

    def get_all_tests_summary(self):
        """Get summary of all active tests"""
        summary = {
            'tests': {},
            'overall': {
                'active_tests': 0,
                'total_tests': len(self.active_tests),
                'total_rps': 0,
                'total_requests': 0,
                'total_errors': 0,
                'average_response_time': 0
            },
            'system': self.system_metrics
        }
        
        total_response_time = 0
        active_tests = 0
        
        for test_id, test in self.active_tests.items():
            if test['status'] == 'running':
                active_tests += 1
                summary['overall']['total_rps'] += test['metrics']['current_rps']
            
            summary['overall']['total_requests'] += test['metrics']['total_requests']
            summary['overall']['total_errors'] += test['metrics']['failed_requests']
            total_response_time += test['metrics']['average_response_time']
            
            # Add test summary
            summary['tests'][test_id] = {
                'id': test_id,
                'status': test['status'],
                'progress': test['progress'],
                'metrics': test['metrics'],
                'recent_data': list(test['real_time_data'])[-30:] if test['real_time_data'] else []
            }
        
        summary['overall']['active_tests'] = active_tests
        if len(self.active_tests) > 0:
            summary['overall']['average_response_time'] = total_response_time / len(self.active_tests)
        
        if summary['overall']['total_requests'] > 0:
            summary['overall']['error_rate'] = (summary['overall']['total_errors'] / summary['overall']['total_requests']) * 100
        else:
            summary['overall']['error_rate'] = 0
            
        return summary

    def generate_report(self, test_id):
        """Generate comprehensive test report"""
        test_data = self.get_test_data(test_id)
        if not test_data:
            return None, None
            
        report = {
            'test_id': test_id,
            'config': test_data['config'],
            'start_time': test_data['start_time'],
            'end_time': test_data['end_time'] or time.time() * 1000,
            'duration': (test_data['end_time'] or time.time() * 1000) - test_data['start_time'],
            'status': test_data['status'],
            'summary': {
                'total_requests': test_data['metrics']['total_requests'],
                'completed_requests': test_data['metrics']['completed_requests'],
                'failed_requests': test_data['metrics']['failed_requests'],
                'average_response_time': test_data['metrics']['average_response_time'],
                'min_response_time': test_data['metrics']['min_response_time'] if test_data['metrics']['min_response_time'] != float('inf') else 0,
                'max_response_time': test_data['metrics']['max_response_time'],
                'error_rate': test_data['metrics']['error_rate'],
                'peak_rps': max([d['rps'] for d in test_data['real_time_data']], default=0),
                'status_codes': test_data['status_codes']
            },
            'performance_data': test_data['real_time_data'],
            'response_times': test_data['response_times'],
            'logs': test_data['logs'],
            'generated_at': time.time() * 1000
        }
        
        # Save report
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"report_{test_id}_{timestamp}.json"
        filepath = os.path.join(self.reports_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2)
        
        self._log_event(test_id, f"Report generated: {filepath}")
        return report, filepath

    def export_csv(self, test_id):
        """Export test data to CSV"""
        test_data = self.get_test_data(test_id)
        if not test_data:
            return None
            
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"data_{test_id}_{timestamp}.csv"
        filepath = os.path.join(self.reports_dir, filename)
        
        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)
            
            # Write performance data
            writer.writerow(['timestamp', 'rps', 'response_time', 'error_rate', 'active_requests'])
            for data_point in test_data['real_time_data']:
                writer.writerow([
                    data_point['timestamp'],
                    data_point['rps'],
                    data_point['response_time'],
                    data_point['error_rate'],
                    data_point['active_requests']
                ])
        
        return filepath

    def export_logs(self, test_id):
        """Export test logs"""
        if test_id not in self.active_tests:
            return None
            
        test = self.active_tests[test_id]
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"logs_{test_id}_{timestamp}.json"
        filepath = os.path.join(self.reports_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(test['logs'], f, indent=2)
        
        return filepath

    def create_download_package(self, test_id):
        """Create a ZIP package with all test data"""
        test_data = self.get_test_data(test_id)
        if not test_data:
            return None
            
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        package_name = f"test_package_{test_id}_{timestamp}.zip"
        package_path = os.path.join(self.reports_dir, package_name)
        
        with zipfile.ZipFile(package_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add JSON report
            report, _ = self.generate_report(test_id)
            if report:
                report_json = json.dumps(report, indent=2)
                zipf.writestr(f"report_{test_id}.json", report_json)
            
            # Add CSV data
            csv_data = io.StringIO()
            writer = csv.writer(csv_data)
            writer.writerow(['timestamp', 'rps', 'response_time', 'error_rate', 'active_requests'])
            for data_point in test_data['real_time_data']:
                writer.writerow([
                    data_point['timestamp'],
                    data_point['rps'],
                    data_point['response_time'],
                    data_point['error_rate'],
                    data_point['active_requests']
                ])
            zipf.writestr(f"data_{test_id}.csv", csv_data.getvalue())
            
            # Add logs
            logs_json = json.dumps(test_data['logs'], indent=2)
            zipf.writestr(f"logs_{test_id}.json", logs_json)
        
        return package_path

    def _log_event(self, test_id, message, data=None):
        """Log an event for a test"""
        log_entry = {
            'timestamp': time.time() * 1000,
            'test_id': test_id,
            'message': message,
            'data': data
        }
        
        if test_id in self.active_tests:
            self.active_tests[test_id]['logs'].append(log_entry)
        
        logger.info(f"{test_id}: {message}")

    def cleanup_test(self, test_id):
        """Clean up test data"""
        if test_id in self.active_tests:
            del self.active_tests[test_id]
        if test_id in self.performance_data:
            del self.performance_data[test_id]
        logger.info(f"Cleaned up test: {test_id}")

    def get_system_info(self):
        """Get system information"""
        import sys
        import platform
        return {
            'cpu_count': psutil.cpu_count(),
            'memory_total': psutil.virtual_memory().total,
            'python_version': f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            'platform': platform.system(),
            'current_metrics': self.system_metrics
        }

    def register_test(self, test_id, config):
        """Register a new load test"""
        test_data = {
            'id': test_id,
            'config': config,
            'start_time': time.time() * 1000,
            'end_time': None,
            'status': 'running',
            'metrics': {
                'total_requests': 0,
                'completed_requests': 0,
                'failed_requests': 0,
                'average_response_time': 0,
                'min_response_time': float('inf'),
                'max_response_time': 0,
                'current_rps': 0,
                'error_rate': 0,
                'status_codes': defaultdict(int),
                'response_times': deque(maxlen=1000),  # Keep last 1000 response times
                'throughput': 0
            },
            'progress': {
                'percentage': 0,
                'requests_sent': 0,
                'requests_completed': 0,
                'requests_total': config.get('total_requests', 1000),
                'time_elapsed': 0,
                'time_total': config.get('duration', 60) * 1000
            },
            'real_time_data': deque(maxlen=300),  # Keep 5 minutes of data (300 seconds)
            'logs': []
        }
        
        self.active_tests[test_id] = test_data
        self.performance_data[test_id] = []
        
        self._log_event(test_id, "Test registered", config)
        return test_data

    def update_test_metrics(self, test_id, metrics_update):
        """Update test metrics with new data"""
        if test_id not in self.active_tests:
            return False
            
        test = self.active_tests[test_id]
        timestamp = time.time() * 1000
        
        # Update basic metrics
        for key, value in metrics_update.items():
            if key in test['metrics']:
                test['metrics'][key] = value

        # Update derived metrics
        if test['metrics']['total_requests'] > 0:
            test['metrics']['error_rate'] = (test['metrics']['failed_requests'] / test['metrics']['total_requests']) * 100

        # Update progress
        time_elapsed = timestamp - test['start_time']
        test['progress']['time_elapsed'] = time_elapsed
        
        if test['progress']['time_total'] > 0:
            time_percentage = min((time_elapsed / test['progress']['time_total']) * 100, 100)
        else:
            time_percentage = 0
            
        if test['progress']['requests_total'] > 0:
            request_percentage = (test['progress']['requests_completed'] / test['progress']['requests_total']) * 100
        else:
            request_percentage = 0
            
        test['progress']['percentage'] = max(time_percentage, request_percentage)

        # Add real-time data point
        data_point = {
            'timestamp': timestamp,
            'rps': test['metrics']['current_rps'],
            'response_time': test['metrics']['average_response_time'],
            'error_rate': test['metrics']['error_rate'],
            'active_requests': metrics_update.get('active_requests', 0)
        }
        
        test['real_time_data'].append(data_point)
        
        # Check if test is complete
        if test['progress']['percentage'] >= 100:
            test['status'] = 'completed'
            test['end_time'] = timestamp
            self._log_event(test_id, "Test completed")

        return True

    def record_request(self, test_id, request_data):
        """Record individual request data"""
        # Add to queue for async processing
        request_data['test_id'] = test_id
        request_data['timestamp'] = time.time() * 1000
        
        try:
            self.request_queue.put_nowait(request_data)
        except queue.Full:
            print("Request queue full, dropping request data")

    def _record_request_metrics(self, request_data):
        """Process and record request metrics"""
        test_id = request_data['test_id']
        if test_id not in self.active_tests:
            return
            
        test = self.active_tests[test_id]
        
        # Update request counts
        test['metrics']['total_requests'] += 1
        
        if request_data.get('success', True):
            test['metrics']['completed_requests'] += 1
        else:
            test['metrics']['failed_requests'] += 1

        # Update response time metrics
        response_time = request_data.get('response_time', 0)
        if response_time > 0:
            test['metrics']['response_times'].append(response_time)
            test['metrics']['min_response_time'] = min(test['metrics']['min_response_time'], response_time)
            test['metrics']['max_response_time'] = max(test['metrics']['max_response_time'], response_time)
            
            # Calculate average response time
            if test['metrics']['response_times']:
                test['metrics']['average_response_time'] = sum(test['metrics']['response_times']) / len(test['metrics']['response_times'])

        # Update status codes
        status_code = request_data.get('status_code', 0)
        if status_code:
            test['metrics']['status_codes'][str(status_code)] += 1

        # Calculate current RPS
        now = time.time() * 1000
        recent_requests = [t for t in test['metrics']['response_times'] 
                          if now - request_data['timestamp'] < 1000]  # Last second
        test['metrics']['current_rps'] = len(recent_requests)

        # Update progress
        test['progress']['requests_completed'] = test['metrics']['completed_requests']

    def get_test_data(self, test_id):
        """Get complete test data"""
        if test_id not in self.active_tests:
            return None
            
        test = self.active_tests[test_id]
        return {
            **test,
            'real_time_data': list(test['real_time_data']),
            'response_times': list(test['metrics']['response_times']),
            'status_codes': dict(test['metrics']['status_codes'])
        }

    def get_all_tests_summary(self):
        """Get summary of all active tests"""
        summary = {
            'tests': {},
            'overall': {
                'active_tests': 0,
                'total_tests': len(self.active_tests),
                'total_rps': 0,
                'total_requests': 0,
                'total_errors': 0,
                'average_response_time': 0
            },
            'system': self.system_metrics
        }
        
        total_response_time = 0
        active_tests = 0
        
        for test_id, test in self.active_tests.items():
            if test['status'] == 'running':
                active_tests += 1
                summary['overall']['total_rps'] += test['metrics']['current_rps']
            
            summary['overall']['total_requests'] += test['metrics']['total_requests']
            summary['overall']['total_errors'] += test['metrics']['failed_requests']
            total_response_time += test['metrics']['average_response_time']
            
            # Add test summary
            summary['tests'][test_id] = {
                'id': test_id,
                'status': test['status'],
                'progress': test['progress'],
                'metrics': test['metrics'],
                'recent_data': list(test['real_time_data'])[-30:] if test['real_time_data'] else []
            }
        
        summary['overall']['active_tests'] = active_tests
        if len(self.active_tests) > 0:
            summary['overall']['average_response_time'] = total_response_time / len(self.active_tests)
        
        if summary['overall']['total_requests'] > 0:
            summary['overall']['error_rate'] = (summary['overall']['total_errors'] / summary['overall']['total_requests']) * 100
        else:
            summary['overall']['error_rate'] = 0
            
        return summary

    def generate_report(self, test_id):
        """Generate comprehensive test report"""
        test_data = self.get_test_data(test_id)
        if not test_data:
            return None
            
        report = {
            'test_id': test_id,
            'config': test_data['config'],
            'start_time': test_data['start_time'],
            'end_time': test_data['end_time'] or time.time() * 1000,
            'duration': (test_data['end_time'] or time.time() * 1000) - test_data['start_time'],
            'status': test_data['status'],
            'summary': {
                'total_requests': test_data['metrics']['total_requests'],
                'completed_requests': test_data['metrics']['completed_requests'],
                'failed_requests': test_data['metrics']['failed_requests'],
                'average_response_time': test_data['metrics']['average_response_time'],
                'min_response_time': test_data['metrics']['min_response_time'] if test_data['metrics']['min_response_time'] != float('inf') else 0,
                'max_response_time': test_data['metrics']['max_response_time'],
                'error_rate': test_data['metrics']['error_rate'],
                'peak_rps': max([d['rps'] for d in test_data['real_time_data']], default=0),
                'status_codes': test_data['status_codes']
            },
            'performance_data': test_data['real_time_data'],
            'response_times': test_data['response_times'],
            'logs': test_data['logs'],
            'generated_at': time.time() * 1000
        }
        
        # Save report
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"report_{test_id}_{timestamp}.json"
        filepath = os.path.join(self.reports_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2)
        
        self._log_event(test_id, f"Report generated: {filepath}")
        return report, filepath

    def export_csv(self, test_id):
        """Export test data to CSV"""
        test_data = self.get_test_data(test_id)
        if not test_data:
            return None
            
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"data_{test_id}_{timestamp}.csv"
        filepath = os.path.join(self.reports_dir, filename)
        
        with open(filepath, 'w', newline='') as f:
            writer = csv.writer(f)
            
            # Write performance data
            writer.writerow(['timestamp', 'rps', 'response_time', 'error_rate', 'active_requests'])
            for data_point in test_data['real_time_data']:
                writer.writerow([
                    data_point['timestamp'],
                    data_point['rps'],
                    data_point['response_time'],
                    data_point['error_rate'],
                    data_point['active_requests']
                ])
        
        return filepath

    def export_logs(self, test_id):
        """Export test logs"""
        if test_id not in self.active_tests:
            return None
            
        test = self.active_tests[test_id]
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"logs_{test_id}_{timestamp}.json"
        filepath = os.path.join(self.logs_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(test['logs'], f, indent=2)
        
        return filepath

    def create_download_package(self, test_id):
        """Create a ZIP package with all test data"""
        test_data = self.get_test_data(test_id)
        if not test_data:
            return None
            
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        package_name = f"test_package_{test_id}_{timestamp}.zip"
        package_path = os.path.join(self.reports_dir, package_name)
        
        with zipfile.ZipFile(package_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add JSON report
            report, _ = self.generate_report(test_id)
            report_json = json.dumps(report, indent=2)
            zipf.writestr(f"report_{test_id}.json", report_json)
            
            # Add CSV data
            csv_data = io.StringIO()
            writer = csv.writer(csv_data)
            writer.writerow(['timestamp', 'rps', 'response_time', 'error_rate', 'active_requests'])
            for data_point in test_data['real_time_data']:
                writer.writerow([
                    data_point['timestamp'],
                    data_point['rps'],
                    data_point['response_time'],
                    data_point['error_rate'],
                    data_point['active_requests']
                ])
            zipf.writestr(f"data_{test_id}.csv", csv_data.getvalue())
            
            # Add logs
            logs_json = json.dumps(test_data['logs'], indent=2)
            zipf.writestr(f"logs_{test_id}.json", logs_json)
        
        return package_path

    def _log_event(self, test_id, message, data=None):
        """Log an event for a test"""
        log_entry = {
            'timestamp': time.time() * 1000,
            'test_id': test_id,
            'message': message,
            'data': data
        }
        
        if test_id in self.active_tests:
            self.active_tests[test_id]['logs'].append(log_entry)
        
        print(f"[{datetime.now().isoformat()}] {test_id}: {message}")

    def cleanup_test(self, test_id):
        """Clean up test data"""
        if test_id in self.active_tests:
            del self.active_tests[test_id]
        if test_id in self.performance_data:
            del self.performance_data[test_id]
        print(f"🧹 Cleaned up test: {test_id}")

    def get_system_info(self):
        """Get system information"""
        return {
            'cpu_count': psutil.cpu_count(),
            'memory_total': psutil.virtual_memory().total,
            'python_version': f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
            'platform': os.uname().sysname if hasattr(os, 'uname') else 'Windows',
            'current_metrics': self.system_metrics
        }


# Global tracker instance
tracker = EnhancedPythonPerformanceTracker()

# Flask app for API endpoints
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'

try:
    from flask_socketio import SocketIO, emit
    socketio = SocketIO(app, cors_allowed_origins="*")
    SOCKETIO_AVAILABLE = True
except ImportError:
    logger.warning("Flask-SocketIO not available, real-time updates disabled")
    SOCKETIO_AVAILABLE = False
    socketio = None

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time() * 1000,
        'tracking': tracker.is_tracking
    })

@app.route('/api/tracker/start', methods=['POST'])
def start_tracking():
    tracker.start_tracking()
    return jsonify({'status': 'started', 'timestamp': time.time() * 1000})

@app.route('/api/tracker/stop', methods=['POST'])
def stop_tracking():
    tracker.stop_tracking()
    return jsonify({'status': 'stopped', 'timestamp': time.time() * 1000})

@app.route('/api/test/register', methods=['POST'])
def register_test():
    data = request.get_json()
    test_id = data.get('test_id')
    config = data.get('config', {})
    
    if not test_id:
        return jsonify({'error': 'test_id required'}), 400
    
    test_data = tracker.register_test(test_id, config)
    return jsonify(test_data)

@app.route('/api/test/<test_id>/metrics', methods=['POST'])
def update_metrics(test_id):
    data = request.get_json()
    success = tracker.update_test_metrics(test_id, data)
    
    if success:
        return jsonify({'status': 'updated', 'timestamp': time.time() * 1000})
    else:
        return jsonify({'error': 'Test not found'}), 404

@app.route('/api/test/<test_id>/request', methods=['POST'])
def record_request(test_id):
    data = request.get_json()
    tracker.record_request(test_id, data)
    return jsonify({'status': 'recorded', 'timestamp': time.time() * 1000})

@app.route('/api/test/<test_id>', methods=['GET'])
def get_test(test_id):
    test_data = tracker.get_test_data(test_id)
    if test_data:
        return jsonify(test_data)
    else:
        return jsonify({'error': 'Test not found'}), 404

@app.route('/api/tests/summary', methods=['GET'])
def get_tests_summary():
    summary = tracker.get_all_tests_summary()
    return jsonify(summary)

@app.route('/api/test/<test_id>/report', methods=['GET'])
def get_report(test_id):
    report, filepath = tracker.generate_report(test_id)
    if report:
        return jsonify(report)
    else:
        return jsonify({'error': 'Test not found'}), 404

@app.route('/api/test/<test_id>/download/report', methods=['GET'])
def download_report(test_id):
    report, filepath = tracker.generate_report(test_id)
    if filepath and os.path.exists(filepath):
        return send_file(filepath, as_attachment=True)
    else:
        return jsonify({'error': 'Report not found'}), 404

@app.route('/api/test/<test_id>/download/csv', methods=['GET'])
def download_csv(test_id):
    filepath = tracker.export_csv(test_id)
    if filepath and os.path.exists(filepath):
        return send_file(filepath, as_attachment=True)
    else:
        return jsonify({'error': 'Data not found'}), 404

@app.route('/api/test/<test_id>/download/package', methods=['GET'])
def download_package(test_id):
    package_path = tracker.create_download_package(test_id)
    if package_path and os.path.exists(package_path):
        return send_file(package_path, as_attachment=True)
    else:
        return jsonify({'error': 'Package creation failed'}), 404

@app.route('/api/system/info', methods=['GET'])
def get_system_info():
    return jsonify(tracker.get_system_info())

@app.route('/api/performance/stats', methods=['GET'])
def get_performance_stats():
    """Get current performance statistics"""
    stats = tracker.get_current_statistics()
    return jsonify(stats)

@app.route('/api/performance/overall-report', methods=['GET'])
def generate_overall_report():
    """Generate and return overall performance report"""
    try:
        tracker.generate_overall_report()
        return jsonify({'status': 'success', 'message': 'Overall report generated'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if SOCKETIO_AVAILABLE:
    @socketio.on('connect')
    def handle_connect():
        logger.info("Client connected")
        emit('connected', {'status': 'connected', 'timestamp': time.time() * 1000})

    @socketio.on('disconnect')
    def handle_disconnect():
        logger.info("Client disconnected")

    def broadcast_updates():
        """Background task to broadcast real-time updates"""
        while True:
            try:
                if tracker.is_tracking:
                    summary = tracker.get_all_tests_summary()
                    socketio.emit('realtime_update', summary)
                time.sleep(1)
            except Exception as e:
                logger.error(f"Error broadcasting updates: {e}")
                time.sleep(5)

def main():
    """Main function for standalone execution"""
    logger.info("Starting Enhanced Python Performance Tracker...")
    tracker.start_tracking()
    
    try:
        # Start background broadcasting if SocketIO is available
        if SOCKETIO_AVAILABLE:
            import threading
            broadcast_thread = threading.Thread(target=broadcast_updates, daemon=True)
            broadcast_thread.start()
            
            logger.info("Python tracker server starting on port 5001...")
            socketio.run(app, host='0.0.0.0', port=5001, debug=False)
        else:
            logger.info("Python tracker API server starting on port 5001...")
            app.run(host='0.0.0.0', port=5001, debug=False)
    
    except KeyboardInterrupt:
        logger.info("Stopping performance tracker...")
    
    finally:
        tracker.cleanup()

if __name__ == "__main__":
    main()
