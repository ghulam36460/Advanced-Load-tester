#!/usr/bin/env python3
"""
Advanced Load Tester Setup Script
Enhanced dependency installer and environment validator
"""

import os
import sys
import subprocess
import platform
import json
import time
from pathlib import Path

class AdvancedSetup:
    """Enhanced setup manager for Advanced Load Tester"""
    
    def __init__(self):
        self.project_root = Path(__file__).parent
        self.requirements_file = self.project_root / "requirements.txt"
        self.package_json = self.project_root / "package.json"
        self.python_version_min = (3, 8)
        self.node_version_min = (16, 0)
        
    def print_header(self):
        """Print setup header"""
        print("=" * 60)
        print("    Advanced Load Tester - Enhanced Setup Script")
        print("=" * 60)
        print()
    
    def print_step(self, step_num, total_steps, description):
        """Print step information"""
        print(f"[{step_num}/{total_steps}] {description}")
    
    def check_python_version(self):
        """Check Python version compatibility"""
        self.print_step(1, 6, "Checking Python version...")
        
        current_version = sys.version_info[:2]
        print(f"    Current Python version: {sys.version}")
        
        if current_version < self.python_version_min:
            print(f"    ❌ Python {self.python_version_min[0]}.{self.python_version_min[1]}+ required")
            print(f"    Please upgrade Python from https://python.org/")
            return False
        
        print(f"    ✅ Python version compatible")
        return True
    
    def check_node_version(self):
        """Check Node.js version compatibility"""
        self.print_step(2, 6, "Checking Node.js version...")
        
        try:
            result = subprocess.run(['node', '--version'], 
                                  capture_output=True, text=True, check=True)
            node_version = result.stdout.strip()
            print(f"    Current Node.js version: {node_version}")
            
            # Extract version numbers
            version_str = node_version.replace('v', '')
            major, minor = map(int, version_str.split('.')[:2])
            
            if (major, minor) < self.node_version_min:
                print(f"    ❌ Node.js {self.node_version_min[0]}.{self.node_version_min[1]}+ required")
                print(f"    Please upgrade Node.js from https://nodejs.org/")
                return False
            
            print(f"    ✅ Node.js version compatible")
            return True
            
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("    ❌ Node.js not found or not accessible")
            print("    Please install Node.js from https://nodejs.org/")
            return False
    
    def upgrade_pip(self):
        """Upgrade pip to latest version"""
        print("    Upgrading pip to latest version...")
        try:
            subprocess.run([sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip'],
                         check=True, capture_output=True)
            print("    ✅ pip upgraded successfully")
            return True
        except subprocess.CalledProcessError as e:
            print(f"    ⚠️ pip upgrade failed: {e}")
            return False
    
    def install_python_dependencies(self):
        """Install Python dependencies with enhanced error handling"""
        self.print_step(3, 6, "Installing Python dependencies...")
        
        if not self.requirements_file.exists():
            print("    ⚠️ requirements.txt not found, skipping Python dependencies")
            return True
        
        # Upgrade pip first
        self.upgrade_pip()
        
        try:
            print("    Installing packages from requirements.txt...")
            
            # First try normal installation
            result = subprocess.run([
                sys.executable, '-m', 'pip', 'install', 
                '-r', str(self.requirements_file)
            ], capture_output=True, text=True, timeout=300)
            
            if result.returncode == 0:
                print("    ✅ All Python dependencies installed successfully")
                return True
            else:
                print("    ⚠️ Some packages failed, trying alternative installation...")
                
                # Try with --user flag
                result = subprocess.run([
                    sys.executable, '-m', 'pip', 'install', '--user',
                    '-r', str(self.requirements_file)
                ], capture_output=True, text=True, timeout=300)
                
                if result.returncode == 0:
                    print("    ✅ Python dependencies installed with --user flag")
                    return True
                else:
                    print("    ⚠️ Trying to install essential packages only...")
                    return self.install_essential_packages()
                    
        except subprocess.TimeoutExpired:
            print("    ⚠️ Installation timeout, trying essential packages only...")
            return self.install_essential_packages()
        except Exception as e:
            print(f"    ❌ Installation failed: {e}")
            return self.install_essential_packages()
    
    def install_essential_packages(self):
        """Install only essential packages"""
        essential_packages = [
            'requests',
            'flask',
            'flask-cors',
            'numpy',
            'pandas',
            'psutil',
            'faker'
        ]
        
        print("    Installing essential packages only...")
        success_count = 0
        
        for package in essential_packages:
            try:
                subprocess.run([
                    sys.executable, '-m', 'pip', 'install', package
                ], check=True, capture_output=True, timeout=60)
                print(f"      ✅ {package}")
                success_count += 1
            except:
                print(f"      ❌ {package}")
        
        if success_count >= len(essential_packages) // 2:
            print(f"    ✅ {success_count}/{len(essential_packages)} essential packages installed")
            return True
        else:
            print(f"    ❌ Only {success_count}/{len(essential_packages)} packages installed")
            return False
    
    def install_node_dependencies(self):
        """Install Node.js dependencies"""
        self.print_step(4, 6, "Installing Node.js dependencies...")
        
        if not self.package_json.exists():
            print("    ⚠️ package.json not found, skipping Node.js dependencies")
            return True
        
        node_modules = self.project_root / "node_modules"
        
        if node_modules.exists():
            print("    Node.js dependencies already installed, checking for updates...")
            try:
                subprocess.run(['npm', 'update'], cwd=self.project_root, 
                             check=True, timeout=120)
                print("    ✅ Node.js dependencies updated")
                return True
            except:
                print("    ⚠️ Update failed, reinstalling...")
        
        try:
            print("    Installing Node.js packages...")
            subprocess.run(['npm', 'install'], cwd=self.project_root, 
                         check=True, timeout=300)
            print("    ✅ Node.js dependencies installed successfully")
            return True
            
        except subprocess.TimeoutExpired:
            print("    ⚠️ npm install timeout, trying with cache clean...")
            try:
                subprocess.run(['npm', 'cache', 'clean', '--force'], 
                             cwd=self.project_root, timeout=60)
                subprocess.run(['npm', 'install'], cwd=self.project_root, 
                             check=True, timeout=180)
                print("    ✅ Node.js dependencies installed after cache clean")
                return True
            except:
                print("    ❌ Node.js installation failed")
                return False
                
        except Exception as e:
            print(f"    ❌ Node.js installation failed: {e}")
            return False
    
    def verify_installation(self):
        """Verify that key components are working"""
        self.print_step(5, 6, "Verifying installation...")
        
        # Test Python imports
        print("    Testing Python imports...")
        essential_modules = ['requests', 'flask', 'numpy', 'pandas']
        python_ok = True
        
        for module in essential_modules:
            try:
                __import__(module)
                print(f"      ✅ {module}")
            except ImportError:
                print(f"      ❌ {module}")
                python_ok = False
        
        # Test Node.js setup
        print("    Testing Node.js setup...")
        node_ok = True
        try:
            result = subprocess.run(['node', '-e', 'console.log("Node.js OK")'], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                print("      ✅ Node.js runtime")
            else:
                print("      ❌ Node.js runtime")
                node_ok = False
        except:
            print("      ❌ Node.js runtime")
            node_ok = False
        
        return python_ok and node_ok
    
    def create_startup_summary(self):
        """Create startup summary and instructions"""
        self.print_step(6, 6, "Creating startup summary...")
        
        summary = {
            "setup_completed": True,
            "timestamp": time.time(),
            "python_version": sys.version,
            "platform": platform.platform(),
            "project_root": str(self.project_root),
            "startup_commands": {
                "windows": "start.bat",
                "unix": "./start.sh",
                "manual": {
                    "python_bridge": "python python_bridge_new.py --port 5001",
                    "main_server": "node app.js",
                    "dashboard": "http://localhost:3000"
                }
            }
        }
        
        summary_file = self.project_root / "setup_summary.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        
        print("    ✅ Setup summary created")
        return True
    
    def print_completion_message(self):
        """Print setup completion message"""
        print()
        print("=" * 60)
        print("    Setup Completed Successfully!")
        print("=" * 60)
        print()
        print("Next steps:")
        print("1. Run 'start.bat' (Windows) or './start.sh' (Linux/Mac)")
        print("2. Open http://localhost:3000 in your browser")
        print("3. Start load testing with advanced ML features!")
        print()
        print("Available features:")
        print("- ML-powered load optimization")
        print("- Real-time performance analytics")
        print("- Advanced statistical analysis")
        print("- WebSocket, GraphQL, and gRPC testing")
        print("- AI-driven insights and recommendations")
        print()
        print("For help, check the documentation or run with --help")
        print("=" * 60)
    
    def run_setup(self):
        """Run the complete setup process"""
        self.print_header()
        
        success = True
        
        # Check system requirements
        if not self.check_python_version():
            success = False
        
        if not self.check_node_version():
            success = False
        
        if not success:
            print("\n❌ System requirements not met. Please install required software.")
            return False
        
        # Install dependencies
        if not self.install_python_dependencies():
            print("\n⚠️ Python dependencies installation had issues")
        
        if not self.install_node_dependencies():
            print("\n❌ Node.js dependencies installation failed")
            return False
        
        # Verify and finalize
        if not self.verify_installation():
            print("\n⚠️ Some components may not work correctly")
        
        self.create_startup_summary()
        self.print_completion_message()
        
        return True

def main():
    """Main setup function"""
    setup = AdvancedSetup()
    
    try:
        success = setup.run_setup()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nSetup interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Setup failed with error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
