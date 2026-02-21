#!/usr/bin/env python3
"""
DreamHost SSH Commands
Execute shell commands on the server
"""

import os
import sys
import paramiko
from dotenv import load_dotenv
from path_resolver import resolve_path, extract_domain, get_credentials

load_dotenv()


class SSHCommands:
    """Execute SSH commands on DreamHost"""

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

    def connect(self):
        """Establish SSH connection"""
        try:
            self.ssh = paramiko.SSHClient()
            self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            if self.ssh_key_path and os.path.exists(self.ssh_key_path):
                self.ssh.connect(hostname=self.host, username=self.user, key_filename=self.ssh_key_path, port=22)
            else:
                self.ssh.connect(hostname=self.host, username=self.user, password=self.password, port=22)

            print(f"✓ Connected to {self.host}")
            return True
        except Exception as e:
            print(f"✗ Connection failed: {str(e)}")
            return False

    def disconnect(self):
        """Close SSH connection"""
        if self.ssh:
            self.ssh.close()
            print("✓ Disconnected")

    def execute_command(self, command):
        """Execute a command on the remote server"""
        try:
            stdin, stdout, stderr = self.ssh.exec_command(command)
            stdout_data = stdout.read().decode('utf-8')
            stderr_data = stderr.read().decode('utf-8')
            exit_code = stdout.channel.recv_exit_status()

            return exit_code, stdout_data, stderr_data

        except Exception as e:
            return 1, '', str(e)

    def chmod_file(self, file_path, mode):
        """Change file permissions"""
        command = f"chmod {mode} {file_path}"
        exit_code, stdout, stderr = self.execute_command(command)

        if exit_code == 0:
            print(f"✓ Changed permissions: {file_path} → {mode}")
            return True
        else:
            print(f"✗ chmod failed: {stderr}")
            return False

    def chmod_recursive(self, directory, file_mode, dir_mode):
        """Recursively change permissions"""
        # Files
        cmd_files = f"find {directory} -type f -exec chmod {file_mode} {{}} \\;"
        exit_code, _, stderr = self.execute_command(cmd_files)

        if exit_code != 0:
            print(f"✗ chmod files failed: {stderr}")
            return False

        # Directories
        cmd_dirs = f"find {directory} -type d -exec chmod {dir_mode} {{}} \\;"
        exit_code, _, stderr = self.execute_command(cmd_dirs)

        if exit_code != 0:
            print(f"✗ chmod directories failed: {stderr}")
            return False

        print(f"✓ Recursively changed permissions in {directory}")
        print(f"  Files: {file_mode}, Directories: {dir_mode}")
        return True

    def create_symlink(self, target, link_path):
        """Create a symbolic link"""
        command = f"ln -s {target} {link_path}"
        exit_code, stdout, stderr = self.execute_command(command)

        if exit_code == 0:
            print(f"✓ Created symlink: {link_path} → {target}")
            return True
        else:
            print(f"✗ Symlink creation failed: {stderr}")
            return False

    def list_files(self, directory):
        """List files in directory"""
        command = f"ls -lah {directory}"
        exit_code, stdout, stderr = self.execute_command(command)

        if exit_code == 0:
            print(f"\nDirectory: {directory}")
            print("-" * 100)
            print(stdout)
            return True
        else:
            print(f"✗ List failed: {stderr}")
            return False

    def find_files(self, directory, pattern):
        """Find files matching pattern"""
        command = f"find {directory} -name '{pattern}'"
        exit_code, stdout, stderr = self.execute_command(command)

        if exit_code == 0:
            files = stdout.strip().split('\n')
            print(f"\nFound {len(files)} files matching '{pattern}':")
            print("-" * 100)
            for f in files:
                if f:
                    print(f)
            return True
        else:
            print(f"✗ Find failed: {stderr}")
            return False

    def remove_directory(self, directory):
        """Remove a directory recursively"""
        command = f"rm -rf {directory}"
        exit_code, _, stderr = self.execute_command(command)

        if exit_code == 0:
            print(f"✓ Removed directory: {directory}")
            return True
        else:
            print(f"✗ Remove failed: {stderr}")
            return False

    def check_disk_usage(self, path='.'):
        """Check disk usage"""
        command = f"du -sh {path}"
        exit_code, stdout, stderr = self.execute_command(command)

        if exit_code == 0:
            print(f"✓ Disk usage for {path}:")
            print(stdout)
            return True
        else:
            print(f"✗ Disk usage check failed: {stderr}")
            return False


def main():
    if len(sys.argv) < 2:
        print("""
DreamHost SSH Commands

Usage:
  python ssh_commands.py exec "<command>"
  python ssh_commands.py chmod <file> <mode>
  python ssh_commands.py chmod-recursive <directory> <file_mode> <dir_mode>
  python ssh_commands.py symlink <target> <link_path>
  python ssh_commands.py list <directory>
  python ssh_commands.py find <directory> <pattern>
  python ssh_commands.py remove <directory>
  python ssh_commands.py disk-usage [path]

Examples:
  # Execute custom command
  python ssh_commands.py exec "cd /home/user/yourdomain.com && ls -la"

  # Change file permissions
  python ssh_commands.py chmod /home/user/yourdomain.com/index.html 644

  # Recursively change permissions
  python ssh_commands.py chmod-recursive /home/user/yourdomain.com 644 755

  # Create symlink
  python ssh_commands.py symlink /home/user/yourdomain.com /home/user/yourdomain-backup

  # List files
  python ssh_commands.py list /home/user/yourdomain.com

  # Find files
  python ssh_commands.py find /home/user/yourdomain.com "*.html"

  # Check disk usage
  python ssh_commands.py disk-usage /home/user/yourdomain.com
""")
        sys.exit(1)

    command = sys.argv[1]

    # Extract domain from path arguments
    domain = None
    if command in ['chmod', 'list', 'find', 'remove'] and len(sys.argv) >= 3:
        domain = extract_domain(sys.argv[2])
    elif command == 'chmod-recursive' and len(sys.argv) == 5:
        domain = extract_domain(sys.argv[2])
    elif command == 'symlink' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[2]) or extract_domain(sys.argv[3])
    elif command == 'disk-usage' and len(sys.argv) == 3:
        domain = extract_domain(sys.argv[2])

    ssh_cmd = SSHCommands(domain=domain)

    if not ssh_cmd.connect():
        sys.exit(1)

    try:
        if command == 'exec' and len(sys.argv) == 3:
            exit_code, stdout, stderr = ssh_cmd.execute_command(sys.argv[2])
            print(stdout)
            if stderr:
                print(f"STDERR: {stderr}")
            sys.exit(exit_code)

        elif command == 'chmod' and len(sys.argv) == 4:
            ssh_cmd.chmod_file(resolve_path(sys.argv[2]), sys.argv[3])

        elif command == 'chmod-recursive' and len(sys.argv) == 5:
            ssh_cmd.chmod_recursive(resolve_path(sys.argv[2]), sys.argv[3], sys.argv[4])

        elif command == 'symlink' and len(sys.argv) == 4:
            ssh_cmd.create_symlink(resolve_path(sys.argv[2]), resolve_path(sys.argv[3]))

        elif command == 'list' and len(sys.argv) == 3:
            ssh_cmd.list_files(resolve_path(sys.argv[2]))

        elif command == 'find' and len(sys.argv) == 4:
            ssh_cmd.find_files(resolve_path(sys.argv[2]), sys.argv[3])

        elif command == 'remove' and len(sys.argv) == 3:
            ssh_cmd.remove_directory(resolve_path(sys.argv[2]))

        elif command == 'disk-usage':
            path = resolve_path(sys.argv[2]) if len(sys.argv) == 3 else '.'
            ssh_cmd.check_disk_usage(path)

        else:
            print("✗ Invalid command or arguments")
            sys.exit(1)

    finally:
        ssh_cmd.disconnect()


if __name__ == '__main__':
    main()
