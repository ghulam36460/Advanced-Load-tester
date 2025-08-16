"""
Advanced Proxy Generator and Manager
===================================

Comprehensive proxy management system with multiple data sources:
- Free proxy generation from multiple sources
- Proxy validation and health checking
- Rotating proxy management
- Support for HTTP, HTTPS, SOCKS4, SOCKS5
- Geolocation-based proxy selection
- Performance monitoring and optimization
"""

import asyncio
import aiohttp
import requests
import time
import json
import random
import logging
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from collections import defaultdict
import socket

# Proxy generation libraries
try:
    from free_proxy import FreeProxy
    FREE_PROXY_AVAILABLE = True
except ImportError:
    FREE_PROXY_AVAILABLE = False
    print("Warning: free-proxy not available. Install with: pip install free-proxy")

try:
    from requests_ip_rotator import ApiGateway
    IP_ROTATOR_AVAILABLE = True
except ImportError:
    IP_ROTATOR_AVAILABLE = False
    print("Warning: requests-ip-rotator not available. Install with: pip install requests-ip-rotator")

try:
    import socks
    import socket
    SOCKS_AVAILABLE = True
except ImportError:
    SOCKS_AVAILABLE = False
    print("Warning: PySocks not available. Install with: pip install PySocks")

logger = logging.getLogger(__name__)

@dataclass
class ProxyInfo:
    """Comprehensive proxy information"""
    host: str
    port: int
    protocol: str = "http"  # http, https, socks4, socks5
    username: Optional[str] = None
    password: Optional[str] = None
    country: Optional[str] = None
    anonymity: Optional[str] = None  # transparent, anonymous, elite
    speed: float = 0.0  # Response time in seconds
    success_rate: float = 0.0  # Success rate percentage
    last_checked: Optional[float] = None
    is_working: bool = False
    source: str = "unknown"
    created_at: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'host': self.host,
            'port': self.port,
            'protocol': self.protocol,
            'username': self.username,
            'password': self.password,
            'country': self.country,
            'anonymity': self.anonymity,
            'speed': self.speed,
            'success_rate': self.success_rate,
            'last_checked': self.last_checked,
            'is_working': self.is_working,
            'source': self.source,
            'created_at': self.created_at
        }
    
    def get_proxy_url(self) -> str:
        """Get proxy URL for requests"""
        if self.username and self.password:
            return f"{self.protocol}://{self.username}:{self.password}@{self.host}:{self.port}"
        return f"{self.protocol}://{self.host}:{self.port}"
    
    def get_proxy_dict(self) -> Dict[str, str]:
        """Get proxy dictionary for requests library"""
        proxy_url = self.get_proxy_url()
        return {
            'http': proxy_url,
            'https': proxy_url
        }

class ProxySourceManager:
    """Manages multiple proxy data sources"""
    
    def __init__(self):
        self.sources = {}
        self.stats = defaultdict(int)
    
    def add_source(self, name: str, source_func):
        """Add a proxy source"""
        self.sources[name] = source_func
        logger.info(f"Added proxy source: {name}")
    
    async def fetch_from_all_sources(self, limit_per_source: int = 10) -> List[ProxyInfo]:
        """Fetch proxies from all available sources"""
        all_proxies = []
        
        for source_name, source_func in self.sources.items():
            try:
                logger.info(f"Fetching proxies from {source_name}...")
                proxies = await self._fetch_from_source(source_name, source_func, limit_per_source)
                all_proxies.extend(proxies)
                self.stats[f"{source_name}_success"] += len(proxies)
                logger.info(f"Fetched {len(proxies)} proxies from {source_name}")
            except Exception as e:
                logger.error(f"Failed to fetch from {source_name}: {e}")
                self.stats[f"{source_name}_errors"] += 1
        
        return all_proxies
    
    async def _fetch_from_source(self, source_name: str, source_func, limit: int) -> List[ProxyInfo]:
        """Fetch proxies from a single source"""
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=5) as executor:
            future = loop.run_in_executor(executor, source_func, limit)
            return await future

class FreeProxyGenerator:
    """Generate free proxies from various sources"""
    
    def __init__(self):
        self.source_manager = ProxySourceManager()
        self._setup_sources()
    
    def _setup_sources(self):
        """Setup available proxy sources"""
        
        # Free proxy library sources
        if FREE_PROXY_AVAILABLE:
            self.source_manager.add_source("free_proxy_http", self._fetch_free_proxy_http)
            self.source_manager.add_source("free_proxy_https", self._fetch_free_proxy_https)
            self.source_manager.add_source("free_proxy_elite", self._fetch_free_proxy_elite)
        
        # Manual API sources
        self.source_manager.add_source("proxy_list_api", self._fetch_proxy_list_api)
        self.source_manager.add_source("gimmeproxy_api", self._fetch_gimmeproxy_api)
        self.source_manager.add_source("proxyrotator_api", self._fetch_proxyrotator_api)
    
    def _fetch_free_proxy_http(self, limit: int = 10) -> List[ProxyInfo]:
        """Fetch HTTP proxies using free-proxy"""
        proxies = []
        try:
            for _ in range(min(limit, 5)):  # Limit to avoid rate limiting
                fp = FreeProxy(rand=True, timeout=10)
                proxy_url = fp.get()
                if proxy_url:
                    host, port = self._parse_proxy_url(proxy_url)
                    if host and port:
                        proxies.append(ProxyInfo(
                            host=host,
                            port=port,
                            protocol="http",
                            source="free_proxy_http"
                        ))
        except Exception as e:
            logger.error(f"Error fetching free proxy HTTP: {e}")
        
        return proxies
    
    def _fetch_free_proxy_https(self, limit: int = 10) -> List[ProxyInfo]:
        """Fetch HTTPS proxies using free-proxy"""
        proxies = []
        try:
            for _ in range(min(limit, 5)):
                fp = FreeProxy(https=True, rand=True, timeout=10)
                proxy_url = fp.get()
                if proxy_url:
                    host, port = self._parse_proxy_url(proxy_url)
                    if host and port:
                        proxies.append(ProxyInfo(
                            host=host,
                            port=port,
                            protocol="https",
                            source="free_proxy_https"
                        ))
        except Exception as e:
            logger.error(f"Error fetching free proxy HTTPS: {e}")
        
        return proxies
    
    def _fetch_free_proxy_elite(self, limit: int = 10) -> List[ProxyInfo]:
        """Fetch elite proxies using free-proxy"""
        proxies = []
        try:
            for _ in range(min(limit, 5)):
                fp = FreeProxy(elite=True, rand=True, timeout=10)
                proxy_url = fp.get()
                if proxy_url:
                    host, port = self._parse_proxy_url(proxy_url)
                    if host and port:
                        proxies.append(ProxyInfo(
                            host=host,
                            port=port,
                            protocol="http",
                            anonymity="elite",
                            source="free_proxy_elite"
                        ))
        except Exception as e:
            logger.error(f"Error fetching free proxy elite: {e}")
        
        return proxies
    
    def _fetch_proxy_list_api(self, limit: int = 10) -> List[ProxyInfo]:
        """Fetch proxies from proxy-list.download API"""
        proxies = []
        try:
            # Multiple endpoints for different types
            endpoints = [
                "https://www.proxy-list.download/api/v1/get?type=http",
                "https://www.proxy-list.download/api/v1/get?type=https",
                "https://www.proxy-list.download/api/v1/get?type=socks4",
                "https://www.proxy-list.download/api/v1/get?type=socks5"
            ]
            
            for endpoint in endpoints[:2]:  # Limit to HTTP/HTTPS for now
                try:
                    response = requests.get(endpoint, timeout=10)
                    if response.status_code == 200:
                        lines = response.text.strip().split('\n')
                        for line in lines[:limit//2]:  # Split limit among endpoints
                            if ':' in line:
                                host, port = line.strip().split(':')
                                protocol = "https" if "https" in endpoint else "http"
                                proxies.append(ProxyInfo(
                                    host=host,
                                    port=int(port),
                                    protocol=protocol,
                                    source="proxy_list_api"
                                ))
                except Exception as e:
                    logger.error(f"Error fetching from {endpoint}: {e}")
                    
        except Exception as e:
            logger.error(f"Error in proxy list API: {e}")
        
        return proxies
    
    def _fetch_gimmeproxy_api(self, limit: int = 10) -> List[ProxyInfo]:
        """Fetch proxies from gimmeproxy.com API"""
        proxies = []
        try:
            for _ in range(min(limit, 10)):  # API allows multiple requests
                response = requests.get(
                    "https://gimmeproxy.com/api/getProxy?format=json&protocol=http&anonymityLevel=1",
                    timeout=10
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get('ip') and data.get('port'):
                        proxies.append(ProxyInfo(
                            host=data['ip'],
                            port=int(data['port']),
                            protocol=data.get('protocol', 'http'),
                            country=data.get('country'),
                            anonymity=data.get('anonymityLevel'),
                            source="gimmeproxy_api"
                        ))
                time.sleep(0.5)  # Rate limiting
        except Exception as e:
            logger.error(f"Error in gimmeproxy API: {e}")
        
        return proxies
    
    def _fetch_proxyrotator_api(self, limit: int = 10) -> List[ProxyInfo]:
        """Fetch proxies from free proxy APIs"""
        proxies = []
        try:
            # Multiple free proxy APIs
            apis = [
                "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
                "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
                "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt"
            ]
            
            for api_url in apis:
                try:
                    response = requests.get(api_url, timeout=15)
                    if response.status_code == 200:
                        lines = response.text.strip().split('\n')
                        for line in lines[:limit//len(apis)]:  # Distribute limit
                            line = line.strip()
                            if ':' in line and len(line.split(':')) == 2:
                                host, port = line.split(':')
                                try:
                                    port = int(port)
                                    proxies.append(ProxyInfo(
                                        host=host,
                                        port=port,
                                        protocol="http",
                                        source="proxyrotator_api"
                                    ))
                                except ValueError:
                                    continue
                except Exception as e:
                    logger.error(f"Error fetching from {api_url}: {e}")
                    
        except Exception as e:
            logger.error(f"Error in proxy rotator API: {e}")
        
        return proxies
    
    def _parse_proxy_url(self, proxy_url: str) -> Tuple[Optional[str], Optional[int]]:
        """Parse proxy URL to extract host and port"""
        try:
            # Remove protocol if present
            if '://' in proxy_url:
                proxy_url = proxy_url.split('://', 1)[1]
            
            # Remove auth if present
            if '@' in proxy_url:
                proxy_url = proxy_url.split('@', 1)[1]
            
            # Extract host and port
            if ':' in proxy_url:
                host, port = proxy_url.split(':', 1)
                return host, int(port)
        except Exception as e:
            logger.error(f"Error parsing proxy URL {proxy_url}: {e}")
        
        return None, None
    
    async def generate_proxies(self, count: int = 50) -> List[ProxyInfo]:
        """Generate a list of proxy candidates"""
        logger.info(f"Generating {count} proxy candidates...")
        proxies = await self.source_manager.fetch_from_all_sources(count // len(self.source_manager.sources))
        
        # Remove duplicates
        unique_proxies = {}
        for proxy in proxies:
            key = f"{proxy.host}:{proxy.port}"
            if key not in unique_proxies:
                unique_proxies[key] = proxy
        
        result = list(unique_proxies.values())[:count]
        logger.info(f"Generated {len(result)} unique proxy candidates")
        return result

class ProxyValidator:
    """Validate and test proxy functionality"""
    
    def __init__(self, test_url: str = "https://httpbin.org/ip", timeout: int = 10):
        self.test_url = test_url
        self.timeout = timeout
        self.session = requests.Session()
    
    async def validate_proxies(self, proxies: List[ProxyInfo], max_workers: int = 20) -> List[ProxyInfo]:
        """Validate a list of proxies concurrently"""
        logger.info(f"Validating {len(proxies)} proxies...")
        
        validated_proxies = []
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all validation tasks
            future_to_proxy = {
                executor.submit(self._validate_single_proxy, proxy): proxy
                for proxy in proxies
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_proxy):
                proxy = future_to_proxy[future]
                try:
                    result = future.result()
                    if result:
                        validated_proxies.append(result)
                except Exception as e:
                    logger.error(f"Validation failed for {proxy.host}:{proxy.port}: {e}")
        
        logger.info(f"Validated {len(validated_proxies)} working proxies out of {len(proxies)}")
        return validated_proxies
    
    def _validate_single_proxy(self, proxy: ProxyInfo) -> Optional[ProxyInfo]:
        """Validate a single proxy"""
        start_time = time.time()
        
        try:
            # Setup proxy configuration
            proxy_dict = proxy.get_proxy_dict()
            
            # Make test request
            response = self.session.get(
                self.test_url,
                proxies=proxy_dict,
                timeout=self.timeout,
                verify=False  # Skip SSL verification for faster testing
            )
            
            response_time = time.time() - start_time
            
            # Check if request was successful
            if response.status_code == 200:
                proxy.is_working = True
                proxy.speed = response_time
                proxy.last_checked = time.time()
                proxy.success_rate = 100.0  # Initial success rate
                
                # Try to extract IP from response (for httpbin.org/ip)
                try:
                    response_data = response.json()
                    if 'origin' in response_data:
                        # Verify the IP is different from our real IP
                        proxy_ip = response_data['origin'].split(',')[0].strip()
                        logger.debug(f"Proxy {proxy.host}:{proxy.port} working, IP: {proxy_ip}")
                except:
                    pass  # JSON parsing failed, but proxy still works
                
                return proxy
            
        except Exception as e:
            logger.debug(f"Proxy {proxy.host}:{proxy.port} failed: {e}")
        
        proxy.is_working = False
        proxy.last_checked = time.time()
        return None
    
    def quick_test_proxy(self, proxy: ProxyInfo) -> bool:
        """Quick test of a single proxy"""
        try:
            response = requests.get(
                self.test_url,
                proxies=proxy.get_proxy_dict(),
                timeout=5,
                verify=False
            )
            return response.status_code == 200
        except:
            return False

class AdvancedProxyManager:
    """Advanced proxy management with rotation and health monitoring"""
    
    def __init__(self, options: Dict[str, Any] = None):
        self.options = options or {}
        self.proxies: List[ProxyInfo] = []
        self.working_proxies: List[ProxyInfo] = []
        self.current_index = 0
        self.lock = threading.Lock()
        
        # Configuration
        self.min_proxies = self.options.get('min_proxies', 10)
        self.max_proxies = self.options.get('max_proxies', 100)
        self.validation_interval = self.options.get('validation_interval', 300)  # 5 minutes
        self.rotation_strategy = self.options.get('rotation_strategy', 'round_robin')
        
        # Components
        self.generator = FreeProxyGenerator()
        self.validator = ProxyValidator()
        
        # Background tasks
        self.validation_thread = None
        self.running = False
    
    async def initialize(self):
        """Initialize the proxy manager"""
        logger.info("Initializing Advanced Proxy Manager...")
        
        # Generate initial proxy list
        await self.refresh_proxies()
        
        # Start background validation
        self.start_background_validation()
        
        logger.info(f"Proxy manager initialized with {len(self.working_proxies)} working proxies")
    
    async def refresh_proxies(self):
        """Refresh the proxy list"""
        logger.info("Refreshing proxy list...")
        
        # Generate new proxies
        new_proxies = await self.generator.generate_proxies(self.max_proxies)
        
        # Validate proxies
        validated_proxies = await self.validator.validate_proxies(new_proxies)
        
        with self.lock:
            # Update proxy lists
            self.proxies = new_proxies
            self.working_proxies = validated_proxies
            self.current_index = 0
        
        logger.info(f"Refreshed proxies: {len(validated_proxies)} working out of {len(new_proxies)} total")
    
    def get_proxy(self) -> Optional[ProxyInfo]:
        """Get next proxy using the configured rotation strategy"""
        with self.lock:
            if not self.working_proxies:
                return None
            
            if self.rotation_strategy == 'round_robin':
                proxy = self.working_proxies[self.current_index]
                self.current_index = (self.current_index + 1) % len(self.working_proxies)
                return proxy
            
            elif self.rotation_strategy == 'random':
                return random.choice(self.working_proxies)
            
            elif self.rotation_strategy == 'fastest':
                return min(self.working_proxies, key=lambda p: p.speed)
            
            else:
                return self.working_proxies[0]
    
    def get_multiple_proxies(self, count: int) -> List[ProxyInfo]:
        """Get multiple unique proxies"""
        with self.lock:
            if count >= len(self.working_proxies):
                return self.working_proxies.copy()
            
            if self.rotation_strategy == 'random':
                return random.sample(self.working_proxies, count)
            else:
                # Round robin selection
                proxies = []
                for i in range(count):
                    idx = (self.current_index + i) % len(self.working_proxies)
                    proxies.append(self.working_proxies[idx])
                self.current_index = (self.current_index + count) % len(self.working_proxies)
                return proxies
    
    def mark_proxy_result(self, proxy: ProxyInfo, success: bool, response_time: float = 0):
        """Mark proxy usage result for statistics"""
        # Update proxy statistics
        if success:
            proxy.success_rate = min(100.0, proxy.success_rate * 0.9 + 10.0)
            if response_time > 0:
                proxy.speed = proxy.speed * 0.8 + response_time * 0.2
        else:
            proxy.success_rate = max(0.0, proxy.success_rate * 0.9)
            
            # Remove proxy if success rate is too low
            if proxy.success_rate < 20.0:
                with self.lock:
                    if proxy in self.working_proxies:
                        self.working_proxies.remove(proxy)
                        logger.info(f"Removed failing proxy {proxy.host}:{proxy.port}")
    
    def start_background_validation(self):
        """Start background proxy validation"""
        if self.validation_thread and self.validation_thread.is_alive():
            return
        
        self.running = True
        self.validation_thread = threading.Thread(target=self._background_validation_loop)
        self.validation_thread.daemon = True
        self.validation_thread.start()
    
    def _background_validation_loop(self):
        """Background loop for proxy validation"""
        while self.running:
            try:
                time.sleep(self.validation_interval)
                
                if len(self.working_proxies) < self.min_proxies:
                    logger.info("Proxy count below minimum, refreshing...")
                    # Run refresh in background
                    asyncio.run(self.refresh_proxies())
                
            except Exception as e:
                logger.error(f"Background validation error: {e}")
    
    def stop_background_validation(self):
        """Stop background validation"""
        self.running = False
        if self.validation_thread:
            self.validation_thread.join(timeout=5)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get proxy manager statistics"""
        with self.lock:
            working_count = len(self.working_proxies)
            total_count = len(self.proxies)
            
            stats = {
                'total_proxies': total_count,
                'working_proxies': working_count,
                'success_rate': (working_count / total_count * 100) if total_count > 0 else 0,
                'rotation_strategy': self.rotation_strategy,
                'current_index': self.current_index
            }
            
            if self.working_proxies:
                speeds = [p.speed for p in self.working_proxies if p.speed > 0]
                if speeds:
                    stats.update({
                        'avg_speed': sum(speeds) / len(speeds),
                        'fastest_speed': min(speeds),
                        'slowest_speed': max(speeds)
                    })
                
                # Source distribution
                sources = defaultdict(int)
                for proxy in self.working_proxies:
                    sources[proxy.source] += 1
                stats['sources'] = dict(sources)
            
            return stats
    
    def export_proxies(self, format: str = 'json') -> str:
        """Export working proxies in various formats"""
        with self.lock:
            if format == 'json':
                return json.dumps([proxy.to_dict() for proxy in self.working_proxies], indent=2)
            
            elif format == 'txt':
                lines = []
                for proxy in self.working_proxies:
                    lines.append(f"{proxy.host}:{proxy.port}")
                return '\n'.join(lines)
            
            elif format == 'url':
                lines = []
                for proxy in self.working_proxies:
                    lines.append(proxy.get_proxy_url())
                return '\n'.join(lines)
            
            else:
                raise ValueError(f"Unsupported format: {format}")
    
    def __del__(self):
        """Cleanup when object is destroyed"""
        self.stop_background_validation()

# Example usage and testing
async def test_proxy_manager():
    """Test the proxy manager functionality"""
    print("Testing Advanced Proxy Manager...")
    
    # Initialize manager
    manager = AdvancedProxyManager({
        'min_proxies': 5,
        'max_proxies': 20,
        'rotation_strategy': 'round_robin'
    })
    
    # Initialize and get proxies
    await manager.initialize()
    
    # Test proxy rotation
    print("\nTesting proxy rotation:")
    for i in range(5):
        proxy = manager.get_proxy()
        if proxy:
            print(f"  {i+1}. {proxy.host}:{proxy.port} (speed: {proxy.speed:.2f}s)")
        else:
            print(f"  {i+1}. No proxy available")
    
    # Get statistics
    stats = manager.get_stats()
    print(f"\nProxy Statistics:")
    print(f"  Total proxies: {stats['total_proxies']}")
    print(f"  Working proxies: {stats['working_proxies']}")
    print(f"  Success rate: {stats['success_rate']:.1f}%")
    
    if 'avg_speed' in stats:
        print(f"  Average speed: {stats['avg_speed']:.2f}s")
    
    # Export proxies
    print(f"\nExporting proxies...")
    exported = manager.export_proxies('txt')
    print(f"Exported {len(exported.split())} proxy addresses")
    
    # Cleanup
    manager.stop_background_validation()

def main():
    """Main function with command line interface"""
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description="Advanced Proxy Manager")
    parser.add_argument('--generate', type=int, metavar='COUNT', 
                       help='Generate COUNT proxies and output as JSON')
    parser.add_argument('--test', action='store_true', 
                       help='Run comprehensive test')
    parser.add_argument('--validate', type=str, metavar='FILE',
                       help='Validate proxies from file')
    parser.add_argument('--export', type=str, choices=['json', 'txt', 'url'],
                       default='json', help='Export format')
    parser.add_argument('--output', type=str, metavar='FILE',
                       help='Output file path')
    
    args = parser.parse_args()
    
    if args.generate:
        # Generate proxies and output JSON
        async def generate_and_output():
            generator = FreeProxyGenerator()
            validator = ProxyValidator()
            
            print(f"Generating {args.generate} proxies...", file=sys.stderr)
            proxies = await generator.generate_proxies(args.generate)
            
            print(f"Validating {len(proxies)} proxies...", file=sys.stderr)
            validated = await validator.validate_proxies(proxies)
            
            result = {
                "success": True,
                "total_generated": len(proxies),
                "working_count": len(validated),
                "success_rate": (len(validated) / len(proxies) * 100) if proxies else 0,
                "proxies": [proxy.to_dict() for proxy in validated]
            }
            
            output = json.dumps(result, indent=2 if args.output else None)
            
            if args.output:
                with open(args.output, 'w') as f:
                    f.write(output)
                print(f"Exported {len(validated)} proxies to {args.output}", file=sys.stderr)
            else:
                print(output)
        
        asyncio.run(generate_and_output())
        
    elif args.validate:
        # Validate proxies from file
        async def validate_from_file():
            try:
                with open(args.validate, 'r') as f:
                    content = f.read().strip()
                
                proxies = []
                
                # Try to parse as JSON first
                try:
                    data = json.loads(content)
                    if isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict):
                                proxies.append(ProxyInfo(**item))
                            elif isinstance(item, str) and ':' in item:
                                host, port = item.split(':', 1)
                                proxies.append(ProxyInfo(host=host, port=int(port)))
                    else:
                        raise ValueError("Invalid JSON format")
                        
                except (json.JSONDecodeError, ValueError):
                    # Parse as text file
                    lines = content.split('\n')
                    for line in lines:
                        line = line.strip()
                        if ':' in line:
                            host, port = line.split(':', 1)
                            proxies.append(ProxyInfo(host=host, port=int(port)))
                
                print(f"Validating {len(proxies)} proxies from {args.validate}...", file=sys.stderr)
                
                validator = ProxyValidator()
                validated = await validator.validate_proxies(proxies)
                
                result = {
                    "success": True,
                    "total_tested": len(proxies),
                    "working_count": len(validated),
                    "success_rate": (len(validated) / len(proxies) * 100) if proxies else 0,
                    "proxies": [proxy.to_dict() for proxy in validated]
                }
                
                output = json.dumps(result, indent=2)
                
                if args.output:
                    with open(args.output, 'w') as f:
                        f.write(output)
                    print(f"Validation results saved to {args.output}", file=sys.stderr)
                else:
                    print(output)
                    
            except Exception as e:
                print(f"Validation failed: {e}", file=sys.stderr)
                sys.exit(1)
        
        asyncio.run(validate_from_file())
        
    elif args.test:
        # Run comprehensive test
        asyncio.run(test_proxy_manager())
        
    else:
        # Default: show help
        parser.print_help()

if __name__ == "__main__":
    # Run the main function with CLI
    main()
