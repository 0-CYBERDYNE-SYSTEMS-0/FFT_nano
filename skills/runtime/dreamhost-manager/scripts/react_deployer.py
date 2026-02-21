#!/usr/bin/env python3
"""
DreamHost React Deployer
Deploy React applications: build, upload artifacts
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path
import paramiko
from dotenv import load_dotenv
from path_resolver import resolve_path, extract_domain, get_credentials

load_dotenv()


class ReactDeployer:
    """Deploy React applications to DreamHost"""

    def __init__(self, domain=None):
        self.domain = domain
        if domain:
            self.host, self.user, self.password, self.ssh_key_path = get_credentials(domain)
        else:
            self.host = os.getenv('DREAMHOST_HOST')
            self.user = os.getenv('DREAMHOST_USER')
            self.password = os.getenv('DREAMHOST_PASSWORD')
            self.ssh_key_path = os.getenv('DREAMHOST_SSH_KEY_PATH')

        if not all([self.host, self.user]):
            raise ValueError("DREAMHOST_HOST and DREAMHOST_USER must be set in .env file")

        self.ssh = None
        self.sftp = None

    def connect(self):
        """Establish SFTP connection"""
        try:
            self.ssh = paramiko.SSHClient()
            self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            if self.ssh_key_path and os.path.exists(self.ssh_key_path):
                self.ssh.connect(hostname=self.host, username=self.user, key_filename=self.ssh_key_path, port=22)
            else:
                self.ssh.connect(hostname=self.host, username=self.user, password=self.password, port=22)

            self.sftp = self.ssh.open_sftp()
            print(f"✓ Connected to {self.host}")
            return True
        except Exception as e:
            print(f"✗ Connection failed: {str(e)}")
            return False

    def disconnect(self):
        """Close SFTP connection"""
        if self.sftp:
            self.sftp.close()
        if self.ssh:
            self.ssh.close()

    def _detect_framework(self, project_dir):
        """Detect React framework and build output directory"""
        project_path = Path(project_dir)

        # Check for package.json
        package_json = project_path / 'package.json'
        if not package_json.exists():
            return None, None, None

        package_content = package_json.read_text()

        # Detect framework and build command
        if 'next' in package_content.lower():
            return 'next', 'npm run build', './out'
        elif 'vite' in package_content.lower():
            return 'vite', 'npm run build', './dist'
        else:  # Default to Create React App
            return 'cra', 'npm run build', './build'

    def _execute_command(self, command, cwd=None, env=None):
        """Execute shell command"""
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                env=env or os.environ.copy()
            )
            return result.returncode == 0, result.stdout, result.stderr
        except Exception as e:
            return False, '', str(e)

    def _build_app(self, project_dir, build_command):
        """Build the React application"""
        print(f"\n📦 Building React application...")
        print(f"   Command: {build_command}")
        print(f"   Directory: {project_dir}")

        success, stdout, stderr = self._execute_command(build_command, cwd=project_dir)

        if success:
            print("✓ Build successful")
            return True
        else:
            print("✗ Build failed")
            if stderr:
                print(f"Error: {stderr}")
            return False

    def _upload_build_artifacts(self, build_dir, remote_app_dir):
        """Upload build directory to remote"""
        build_path = Path(build_dir)

        if not build_path.exists():
            print(f"✗ Build directory not found: {build_dir}")
            return False

        print(f"\n📤 Uploading build artifacts to {remote_app_dir}...")

        try:
            # Create remote directory
            try:
                self.sftp.stat(remote_app_dir)
            except IOError:
                self.sftp.mkdir(remote_app_dir)
                print(f"   Created remote directory: {remote_app_dir}")

            # Clear old files (backup if needed)
            print("   Clearing old deployment...")
            try:
                old_backup = f"{remote_app_dir}.backup"
                self._remote_remove_tree(remote_app_dir)
                print(f"   Removed old files from {remote_app_dir}")
            except:
                pass

            # Upload new files
            uploaded = self._upload_tree(str(build_path), remote_app_dir)
            print(f"✓ Uploaded {uploaded} files")
            return True

        except Exception as e:
            print(f"✗ Upload failed: {str(e)}")
            return False

    def _upload_tree(self, local_dir, remote_dir):
        """Recursively upload directory tree"""
        count = 0
        local_path = Path(local_dir)

        for item in local_path.rglob('*'):
            if item.is_file():
                rel_path = item.relative_to(local_path)
                remote_path = f"{remote_dir}/{str(rel_path).replace(os.sep, '/')}"

                # Create remote directory if needed
                remote_parent = '/'.join(remote_path.split('/')[:-1])
                try:
                    self.sftp.stat(remote_parent)
                except IOError:
                    self.sftp.mkdir(remote_parent)

                self.sftp.put(str(item), remote_path)
                count += 1

        return count

    def _remote_remove_tree(self, remote_path):
        """Recursively remove remote directory"""
        try:
            items = self.sftp.listdir(remote_path)
            for item in items:
                item_path = f"{remote_path}/{item}"
                try:
                    self.sftp.remove(item_path)
                except IOError:
                    self._remote_remove_tree(item_path)
            self.sftp.rmdir(remote_path)
        except:
            pass

    def deploy(self, project_dir, remote_app_dir, build_command=None, skip_build=False):
        """Deploy React application"""
        project_path = Path(project_dir)

        if not project_path.exists():
            print(f"✗ Project directory not found: {project_dir}")
            return False

        # Detect framework if not specified
        if not build_command:
            framework, detected_build_cmd, build_output = self._detect_framework(project_dir)
            if not framework:
                print("✗ Could not detect React framework (package.json not found)")
                return False
            print(f"Detected framework: {framework}")
            build_command = detected_build_cmd
            build_output_dir = project_dir + '/' + build_output
        else:
            # User provided build command, assume standard build locations
            if 'next' in build_command.lower():
                build_output_dir = project_dir + '/out'
            elif 'vite' in build_command.lower():
                build_output_dir = project_dir + '/dist'
            else:
                build_output_dir = project_dir + '/build'

        # Build the application
        if not skip_build:
            if not self._build_app(project_dir, build_command):
                return False
        else:
            print("⏭️  Skipping build (--skip-build)")

        # Upload build artifacts
        if not self._upload_build_artifacts(build_output_dir, remote_app_dir):
            return False

        print("\n✅ React deployment complete!")
        print(f"   App deployed to: {remote_app_dir}")
        print("\nNext steps:")
        print("  1. Test your app at the deployed URL")
        print("  2. If using client-side routing, run: python routing_manager.py configure-app <remote_app_dir>")
        return True


def main():
    if len(sys.argv) < 3:
        print("""
DreamHost React Deployer

Usage:
  python react_deployer.py deploy <project_directory> <remote_app_directory> [--build-command "npm run build"] [--skip-build]

Examples:
  # Deploy with auto-detection
  python react_deployer.py deploy . /home/user/yourdomain.com

  # Deploy with custom build command
  python react_deployer.py deploy . /home/user/yourdomain.com --build-command "yarn build"

  # Skip build (use existing build artifacts)
  python react_deployer.py deploy . /home/user/yourdomain.com --skip-build

Supported frameworks:
  - Create React App (npm run build → ./build)
  - Vite (npm run build → ./dist)
  - Next.js (npm run build → ./out for static export)
""")
        sys.exit(1)

    command = sys.argv[1]

    if command == 'deploy' and len(sys.argv) >= 4:
        project_dir = sys.argv[2]
        remote_app_dir_input = sys.argv[3]
        domain = extract_domain(remote_app_dir_input)
        remote_app_dir = resolve_path(remote_app_dir_input)
        build_command = None
        skip_build = False

        # Parse optional arguments
        for i in range(4, len(sys.argv)):
            if sys.argv[i] == '--build-command' and i + 1 < len(sys.argv):
                build_command = sys.argv[i + 1]
            elif sys.argv[i] == '--skip-build':
                skip_build = True

        deployer = ReactDeployer(domain=domain)
        if not deployer.connect():
            sys.exit(1)

        try:
            success = deployer.deploy(project_dir, remote_app_dir, build_command, skip_build)
            sys.exit(0 if success else 1)
        finally:
            deployer.disconnect()
    else:
        print("✗ Invalid command")
        sys.exit(1)


if __name__ == '__main__':
    main()
