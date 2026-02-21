#!/usr/bin/env python3
"""
DreamHost Directory Sync
Recursive directory upload/download with timestamp comparison
"""

import os
import sys
from pathlib import Path
from datetime import datetime
import paramiko
from dotenv import load_dotenv
from path_resolver import resolve_path, extract_domain, get_credentials

# Load from skill directory
script_dir = Path(__file__).parent.parent
load_dotenv(dotenv_path=script_dir / '.env')


class DirectorySync:
    """Sync directories with DreamHost"""

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
        self.exclude_patterns = {'.git', '.DS_Store', 'node_modules', '.env', '__pycache__', '.pytest_cache', '.next', '.vercel'}

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

    def _should_exclude(self, path_name):
        """Check if path should be excluded"""
        return any(pattern in path_name for pattern in self.exclude_patterns)

    def _is_directory(self, sftp_attr):
        """Check if SFTP item is directory"""
        import stat
        return stat.S_ISDIR(sftp_attr.st_mode)

    def sync_upload(self, local_dir, remote_dir):
        """Upload directory recursively"""
        local_path = Path(local_dir)

        if not local_path.exists():
            print(f"✗ Local directory not found: {local_dir}")
            return False

        try:
            # Ensure remote directory exists
            try:
                self.sftp.stat(remote_dir)
            except IOError:
                print(f"Creating remote directory: {remote_dir}")
                self.sftp.mkdir(remote_dir)

            total_files = 0
            uploaded_files = 0

            # Walk local directory
            for local_item in local_path.rglob('*'):
                if self._should_exclude(str(local_item)):
                    continue

                rel_path = local_item.relative_to(local_path)
                remote_path = f"{remote_dir}/{str(rel_path).replace(os.sep, '/')}"

                if local_item.is_dir():
                    try:
                        self.sftp.stat(remote_path)
                    except IOError:
                        self.sftp.mkdir(remote_path)
                        print(f"  Created directory: {remote_path}")

                else:
                    total_files += 1
                    # Check if file needs update
                    try:
                        remote_stat = self.sftp.stat(remote_path)
                        if local_item.stat().st_mtime <= remote_stat.st_mtime:
                            print(f"  Skipped (unchanged): {rel_path}")
                            continue
                    except IOError:
                        pass  # File doesn't exist, upload it

                    print(f"  Uploading: {rel_path}")
                    self.sftp.put(str(local_item), remote_path)
                    uploaded_files += 1

            print(f"\n✓ Sync complete: {uploaded_files}/{total_files} files uploaded")
            return True

        except Exception as e:
            print(f"✗ Sync failed: {str(e)}")
            return False

    def sync_download(self, remote_dir, local_dir):
        """Download directory recursively"""
        local_path = Path(local_dir)
        local_path.mkdir(parents=True, exist_ok=True)

        try:
            total_files = 0
            downloaded_files = 0

            def _recursive_download(remote_path, local_subdir):
                nonlocal total_files, downloaded_files

                try:
                    items = self.sftp.listdir_attr(remote_path)
                except IOError:
                    print(f"✗ Cannot access: {remote_path}")
                    return

                for item in items:
                    if self._should_exclude(item.filename):
                        continue

                    remote_item_path = f"{remote_path}/{item.filename}"
                    local_item_path = local_subdir / item.filename

                    if self._is_directory(item):
                        local_item_path.mkdir(parents=True, exist_ok=True)
                        _recursive_download(remote_item_path, local_item_path)
                    else:
                        total_files += 1
                        # Check if file needs update
                        if local_item_path.exists():
                            if local_item_path.stat().st_mtime >= item.st_mtime:
                                print(f"  Skipped (unchanged): {item.filename}")
                                continue

                        print(f"  Downloading: {item.filename}")
                        self.sftp.get(remote_item_path, str(local_item_path))
                        downloaded_files += 1

            _recursive_download(remote_dir, local_path)
            print(f"\n✓ Sync complete: {downloaded_files}/{total_files} files downloaded")
            return True

        except Exception as e:
            print(f"✗ Sync failed: {str(e)}")
            return False


def main():
    if len(sys.argv) < 4:
        print("""
DreamHost Directory Sync

Usage:
  python directory_sync.py upload <local_directory> <remote_directory>
  python directory_sync.py download <remote_directory> <local_directory>

Examples:
  python directory_sync.py upload ./my-website /home/user/yourdomain.com
  python directory_sync.py download /home/user/yourdomain.com ./backup

Features:
  - Recursive directory sync
  - Timestamp-based comparison (skips unchanged files)
  - Automatic exclusion of: .git, .DS_Store, node_modules, .env, __pycache__, etc.
  - Creates missing directories automatically
""")
        sys.exit(1)

    command = sys.argv[1]

    # Extract domain from path arguments
    domain = None
    if command == 'upload' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[3])
    elif command == 'download' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[2])

    sync = DirectorySync(domain=domain)

    if not sync.connect():
        sys.exit(1)

    try:
        if command == 'upload' and len(sys.argv) == 4:
            sync.sync_upload(sys.argv[2], resolve_path(sys.argv[3]))
        elif command == 'download' and len(sys.argv) == 4:
            sync.sync_download(resolve_path(sys.argv[2]), sys.argv[3])
        else:
            print("✗ Invalid command or arguments")
            sys.exit(1)
    finally:
        sync.disconnect()


if __name__ == '__main__':
    main()
