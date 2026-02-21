#!/usr/bin/env python3
"""
DreamHost SFTP Operations
Core file operations: upload, download, list, create directories, delete, rename
"""

import os
import sys
import paramiko
from dotenv import load_dotenv
from pathlib import Path
from path_resolver import resolve_path, extract_domain, get_credentials, initialize_env

# Initialize environment variables for this skill
skill_dir = Path(__file__).parent.parent
initialize_env(str(skill_dir / ".env"))


class DreamHostSFTP:
    """SFTP client for DreamHost operations"""

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

        if not self.password and not self.ssh_key_path:
            raise ValueError("Either DREAMHOST_PASSWORD or DREAMHOST_SSH_KEY_PATH must be set in .env file")

        self.ssh = None
        self.sftp = None

    def connect(self):
        """Establish SFTP connection"""
        try:
            self.ssh = paramiko.SSHClient()
            self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            # Connect with SSH key or password
            if self.ssh_key_path and os.path.exists(self.ssh_key_path):
                print(f"Connecting to {self.host} with SSH key...")
                self.ssh.connect(
                    hostname=self.host,
                    username=self.user,
                    key_filename=self.ssh_key_path,
                    port=22
                )
            else:
                print(f"Connecting to {self.host} with password...")
                self.ssh.connect(
                    hostname=self.host,
                    username=self.user,
                    password=self.password,
                    port=22
                )

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
        print("✓ Disconnected")

    def upload_file(self, local_path, remote_path):
        """Upload a file to DreamHost"""
        try:
            local_path = Path(local_path)
            if not local_path.exists():
                print(f"✗ Local file not found: {local_path}")
                return False

            # Get file size for progress tracking
            file_size = local_path.stat().st_size
            print(f"Uploading {local_path.name} ({file_size} bytes)...")

            self.sftp.put(str(local_path), remote_path)
            print(f"✓ Uploaded: {local_path} → {remote_path}")
            return True

        except Exception as e:
            print(f"✗ Upload failed: {str(e)}")
            return False

    def download_file(self, remote_path, local_path):
        """Download a file from DreamHost"""
        try:
            local_path = Path(local_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)

            print(f"Downloading {remote_path}...")
            self.sftp.get(remote_path, str(local_path))
            print(f"✓ Downloaded: {remote_path} → {local_path}")
            return True

        except Exception as e:
            print(f"✗ Download failed: {str(e)}")
            return False

    def list_directory(self, remote_path='.'):
        """List files in a remote directory"""
        try:
            print(f"\nListing directory: {remote_path}")
            print("-" * 80)

            items = self.sftp.listdir_attr(remote_path)

            for item in sorted(items, key=lambda x: x.filename):
                file_type = 'd' if self._is_directory(item) else '-'
                size = item.st_size if hasattr(item, 'st_size') else 0
                print(f"{file_type}  {size:>10}  {item.filename}")

            print("-" * 80)
            print(f"Total: {len(items)} items")
            return True

        except Exception as e:
            print(f"✗ List failed: {str(e)}")
            return False

    def create_directory(self, remote_path):
        """Create a directory on DreamHost"""
        try:
            self.sftp.mkdir(remote_path)
            print(f"✓ Created directory: {remote_path}")
            return True

        except Exception as e:
            print(f"✗ Directory creation failed: {str(e)}")
            return False

    def delete_file(self, remote_path):
        """Delete a file from DreamHost"""
        try:
            self.sftp.remove(remote_path)
            print(f"✓ Deleted file: {remote_path}")
            return True

        except Exception as e:
            print(f"✗ Delete failed: {str(e)}")
            return False

    def rename_file(self, old_path, new_path):
        """Rename a file on DreamHost"""
        try:
            self.sftp.rename(old_path, new_path)
            print(f"✓ Renamed: {old_path} → {new_path}")
            return True

        except Exception as e:
            print(f"✗ Rename failed: {str(e)}")
            return False

    def _is_directory(self, item):
        """Check if an item is a directory"""
        import stat
        return stat.S_ISDIR(item.st_mode)


def main():
    """Example usage"""
    if len(sys.argv) < 2:
        print("""
DreamHost SFTP Operations

Usage:
  python sftp_operations.py upload <local_file> <remote_path>
  python sftp_operations.py download <remote_file> <local_path>
  python sftp_operations.py list <remote_directory>
  python sftp_operations.py mkdir <remote_directory>
  python sftp_operations.py delete <remote_file>
  python sftp_operations.py rename <old_path> <new_path>

Examples:
  python sftp_operations.py upload ./index.html /home/user/yourdomain.com/index.html
  python sftp_operations.py download /home/user/yourdomain.com/index.html ./backup/index.html
  python sftp_operations.py list /home/user/yourdomain.com
  python sftp_operations.py mkdir /home/user/yourdomain.com/new_folder
  python sftp_operations.py delete /home/user/yourdomain.com/old_file.txt
  python sftp_operations.py rename /home/user/yourdomain.com/old.html /home/user/yourdomain.com/new.html
""")
        sys.exit(1)

    command = sys.argv[1]

    # Extract domain from path arguments to use domain-specific credentials
    domain = None
    if command == 'upload' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[3])
    elif command == 'download' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[2])
    elif command in ['list', 'mkdir', 'delete'] and len(sys.argv) == 3:
        domain = extract_domain(sys.argv[2])
    elif command == 'rename' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[2]) or extract_domain(sys.argv[3])

    sftp = DreamHostSFTP(domain=domain)
    if not sftp.connect():
        sys.exit(1)

    try:
        if command == 'upload' and len(sys.argv) == 4:
            sftp.upload_file(sys.argv[2], resolve_path(sys.argv[3]))

        elif command == 'download' and len(sys.argv) == 4:
            sftp.download_file(resolve_path(sys.argv[2]), sys.argv[3])

        elif command == 'list' and len(sys.argv) == 3:
            sftp.list_directory(resolve_path(sys.argv[2]))

        elif command == 'mkdir' and len(sys.argv) == 3:
            sftp.create_directory(resolve_path(sys.argv[2]))

        elif command == 'delete' and len(sys.argv) == 3:
            sftp.delete_file(resolve_path(sys.argv[2]))

        elif command == 'rename' and len(sys.argv) == 4:
            sftp.rename_file(resolve_path(sys.argv[2]), resolve_path(sys.argv[3]))

        else:
            print("✗ Invalid command or arguments")
            sys.exit(1)

    finally:
        sftp.disconnect()


if __name__ == '__main__':
    main()
