#!/usr/bin/env python3
"""
Advanced Load Tester - Environment Validation Script
Quick validation of setup and dependencies
"""

import sys
import importlib
import subprocess
import json
from pathlib import Path

def test_python_modules():
    """Test Python module imports"""
    print("Testing Python modules...")
    
    required_modules = [
        ("requests", "HTTP requests"),
        ("flask", "Web framework"),
        ("numpy", "Numerical computing"),
        ("pandas", "Data analysis"),
        ("psutil", "System monitoring"),
        ("faker", "Data generation")
    ]
    
    optional_modules = [
        ("sklearn", "Machine learning"),
        ("scipy", "Scientific computing"),
        ("matplotlib", "Plotting"),
        ("websockets", "WebSocket support"),
        ("aiohttp", "Async HTTP")
    ]
    
    results = {"required": {}, "optional": {}}
    
    # Test required modules
    for module, description in required_modules:
        try:
            importlib.import_module(module)
            print(f"  ✅ {module:12} - {description}")
            results["required"][module] = True
        except ImportError:
            print(f"  ❌ {module:12} - {description} (MISSING)")
            results["required"][module] = False
    
    # Test optional modules
    for module, description in optional_modules:
        try:
            importlib.import_module(module)
            print(f"  ✅ {module:12} - {description} (optional)")
            results["optional"][module] = True
        except ImportError:
            print(f"  ⚠️ {module:12} - {description} (optional, not installed)")
            results["optional"][module] = False
    
    return results

def test_node_setup():
    """Test Node.js setup"""
    print("\nTesting Node.js setup...")
    
    try:
        # Check Node.js
        result = subprocess.run(['node', '--version'], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"  ✅ Node.js version: {version}")
        else:
            print("  ❌ Node.js not working")
            return False
        
        # Check npm
        result = subprocess.run(['npm', '--version'], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"  ✅ npm version: {version}")
        else:
            print("  ❌ npm not working")
            return False
        
        # Check if node_modules exists
        if Path("node_modules").exists():
            print("  ✅ node_modules directory exists")
        else:
            print("  ⚠️ node_modules directory not found")
        
        return True
        
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  ❌ Node.js test failed: {e}")
        return False

def test_project_files():
    """Test project file structure"""
    print("\nTesting project files...")
    
    required_files = [
        ("app.js", "Main application"),
        ("package.json", "Node.js configuration"),
        ("python_bridge_new.py", "Python bridge"),
        ("requirements.txt", "Python dependencies")
    ]
    
    optional_files = [
        ("start.bat", "Windows launcher"),
        ("start.ps1", "PowerShell launcher"),
        ("dashboard/index.html", "Dashboard")
    ]
    
    for filename, description in required_files:
        if Path(filename).exists():
            print(f"  ✅ {filename:25} - {description}")
        else:
            print(f"  ❌ {filename:25} - {description} (MISSING)")
    
    for filename, description in optional_files:
        if Path(filename).exists():
            print(f"  ✅ {filename:25} - {description}")
        else:
            print(f"  ⚠️ {filename:25} - {description} (optional)")

def test_service_connectivity():
    """Test if services can be reached"""
    print("\nTesting service connectivity...")
    
    try:
        import requests
        
        # Test main server
        try:
            response = requests.get("http://localhost:3000/health", timeout=5)
            print(f"  ✅ Main server: HTTP {response.status_code}")
        except requests.RequestException:
            print("  ⚠️ Main server: Not responding (may not be started)")
        
        # Test Python bridge
        try:
            response = requests.get("http://localhost:5001/api/status", timeout=5)
            print(f"  ✅ Python bridge: HTTP {response.status_code}")
        except requests.RequestException:
            print("  ⚠️ Python bridge: Not responding (may not be started)")
            
    except ImportError:
        print("  ⚠️ requests module not available, skipping connectivity test")

def generate_report(python_results, node_ok):
    """Generate validation report"""
    print("\n" + "="*60)
    print("VALIDATION REPORT")
    print("="*60)
    
    # Python modules summary
    required_ok = all(python_results["required"].values())
    optional_count = sum(python_results["optional"].values())
    
    print(f"Python required modules: {'✅ PASS' if required_ok else '❌ FAIL'}")
    print(f"Python optional modules: {optional_count}/{len(python_results['optional'])} available")
    print(f"Node.js setup: {'✅ PASS' if node_ok else '❌ FAIL'}")
    
    # Overall status
    overall_ok = required_ok and node_ok
    print(f"\nOverall status: {'✅ READY' if overall_ok else '❌ ISSUES FOUND'}")
    
    if overall_ok:
        print("\n🎉 Environment is ready for Advanced Load Tester!")
        print("Run 'start.bat' or 'start.ps1' to launch the application.")
    else:
        print("\n⚠️ Some issues found. Please install missing dependencies.")
        if not required_ok:
            print("Install missing Python packages: pip install -r requirements.txt")
        if not node_ok:
            print("Install Node.js from https://nodejs.org/")
    
    # Save report
    report = {
        "timestamp": str(sys.version_info),
        "python_version": sys.version,
        "python_modules": python_results,
        "node_ok": node_ok,
        "overall_status": "ready" if overall_ok else "issues"
    }
    
    with open("validation_report.json", "w") as f:
        json.dump(report, f, indent=2)
    
    print(f"\nDetailed report saved to: validation_report.json")

def main():
    """Main validation function"""
    print("Advanced Load Tester - Environment Validation")
    print("="*60)
    
    # Run tests
    python_results = test_python_modules()
    node_ok = test_node_setup()
    test_project_files()
    test_service_connectivity()
    
    # Generate report
    generate_report(python_results, node_ok)

if __name__ == "__main__":
    main()
