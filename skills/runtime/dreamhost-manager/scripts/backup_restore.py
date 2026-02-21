#!/usr/bin/env python3
"""
DreamHost Backup & Restore
Create timestamped backups and restore from them
"""

import os
import sys
import tarfile
import shutil
from pathlib import Path
from datetime import datetime
import paramiko
from dotenv import load_dotenv
from path_resolver import resolve_path, extract_domain, get_credentials

load_dotenv()


class BackupRestore:
    """Backup and restore DreamHost sites"""

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

    def backup_site(self, remote_path, local_backup_dir, compress=True):
        """Backup site from remote to local"""
        local_path = Path(local_backup_dir)
        local_path.mkdir(parents=True, exist_ok=True)

        # Create timestamped backup directory
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"backup_{timestamp}"
        backup_path = local_path / backup_name

        print(f"📦 Creating backup: {backup_name}")

        try:
            # Download remote directory
            backup_path.mkdir(parents=True, exist_ok=True)
            self._download_tree(remote_path, str(backup_path))

            if compress:
                print("🗜️  Compressing backup...")
                tar_path = backup_path.parent / f"{backup_name}.tar.gz"
                self._compress_backup(str(backup_path), str(tar_path))
                shutil.rmtree(backup_path)
                print(f"✓ Backup complete: {tar_path}")
                return str(tar_path)
            else:
                print(f"✓ Backup complete: {backup_path}")
                return str(backup_path)

        except Exception as e:
            print(f"✗ Backup failed: {str(e)}")
            return None

    def restore_site(self, backup_path, remote_path):
        """Restore site from local backup to remote"""
        backup = Path(backup_path)

        if not backup.exists():
            print(f"✗ Backup not found: {backup_path}")
            return False

        print(f"📥 Restoring from: {backup.name}")

        try:
            # Extract if compressed
            restore_dir = backup
            if backup.suffix == '.gz':
                print("📂 Extracting backup...")
                restore_dir = backup.parent / backup.stem.replace('.tar', '')
                self._decompress_backup(str(backup), str(restore_dir))

            # Upload to remote
            print(f"Uploading to {remote_path}...")

            # Create remote directory if needed
            try:
                self.sftp.stat(remote_path)
            except IOError:
                self.sftp.mkdir(remote_path)

            # Clear existing files first (backup old version)
            print("Backing up current version...")
            self._backup_remote_tree(remote_path)

            # Upload new files
            self._upload_tree(str(restore_dir), remote_path)

            # Cleanup temp extraction if needed
            if restore_dir != backup:
                import shutil
                shutil.rmtree(restore_dir)

            print(f"✓ Restore complete")
            return True

        except Exception as e:
            print(f"✗ Restore failed: {str(e)}")
            return False

    def list_backups(self, local_backup_dir):
        """List available backups"""
        backup_path = Path(local_backup_dir)

        if not backup_path.exists():
            print(f"No backups found in {local_backup_dir}")
            return

        print(f"\nAvailable backups in {local_backup_dir}:")
        print("-" * 80)

        backups = sorted(backup_path.glob('backup_*'), key=os.path.getctime, reverse=True)

        for i, backup in enumerate(backups, 1):
            if backup.is_dir():
                size = self._get_dir_size(backup)
                print(f"{i}. {backup.name:30} ({size})")
            elif backup.suffix == '.gz':
                size = backup.stat().st_size
                size_mb = size / (1024 * 1024)
                print(f"{i}. {backup.name:30} ({size_mb:.2f} MB)")

        print("-" * 80)

    def _download_tree(self, remote_dir, local_dir):
        """Recursively download directory"""
        local_path = Path(local_dir)
        local_path.mkdir(parents=True, exist_ok=True)

        try:
            items = self.sftp.listdir_attr(remote_dir)
        except IOError:
            print(f"✗ Cannot access: {remote_dir}")
            return

        for item in items:
            remote_item = f"{remote_dir}/{item.filename}"
            local_item = local_path / item.filename

            if self._is_directory(item):
                self._download_tree(remote_item, str(local_item))
            else:
                print(f"  Downloading: {item.filename}")
                self.sftp.get(remote_item, str(local_item))

    def _upload_tree(self, local_dir, remote_dir):
        """Recursively upload directory"""
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

                print(f"  Uploading: {rel_path}")
                self.sftp.put(str(item), remote_path)

    def _backup_remote_tree(self, remote_path):
        """Backup existing remote directory"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_path = f"{remote_path}.backup_{timestamp}"
            self.sftp.rename(remote_path, backup_path)
            print(f"  Backed up to: {backup_path}")
        except:
            # If rename fails, try to clear directory instead
            try:
                items = self.sftp.listdir(remote_path)
                for item in items:
                    self._remote_remove_file(f"{remote_path}/{item}")
            except:
                pass

    def _remote_remove_file(self, remote_path):
        """Remove remote file or directory"""
        try:
            self.sftp.remove(remote_path)
        except IOError:
            self._remote_remove_tree(remote_path)

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

    def _compress_backup(self, source_dir, tar_path):
        """Compress backup directory"""
        with tarfile.open(tar_path, 'w:gz') as tar:
            tar.add(source_dir, arcname=Path(source_dir).name)

    def _decompress_backup(self, tar_path, extract_dir):
        """Decompress backup file"""
        Path(extract_dir).mkdir(parents=True, exist_ok=True)
        with tarfile.open(tar_path, 'r:gz') as tar:
            tar.extractall(extract_dir)

    def _get_dir_size(self, path):
        """Get directory size in human readable format"""
        total = sum(f.stat().st_size for f in Path(path).rglob('*') if f.is_file())
        for unit in ['B', 'KB', 'MB', 'GB']:
            if total < 1024:
                return f"{total:.2f} {unit}"
            total /= 1024
        return f"{total:.2f} TB"

    def _is_directory(self, sftp_attr):
        """Check if SFTP item is directory"""
        import stat
        return stat.S_ISDIR(sftp_attr.st_mode)


def main():
    if len(sys.argv) < 2:
        print("""
DreamHost Backup & Restore

Usage:
  python backup_restore.py backup <remote_path> <local_backup_dir>
  python backup_restore.py restore <backup_path> <remote_path>
  python backup_restore.py list <local_backup_dir>

Examples:
  # Create backup
  python backup_restore.py backup /home/user/yourdomain.com ./backups

  # List available backups
  python backup_restore.py list ./backups

  # Restore from backup
  python backup_restore.py restore ./backups/backup_20240101_120000.tar.gz /home/user/yourdomain.com

Features:
  - Automatic timestamped backups
  - Automatic compression (tar.gz)
  - Preserves directory structure
  - Safe restore (backs up current version first)
""")
        sys.exit(1)

    command = sys.argv[1]

    # Extract domain from path arguments
    domain = None
    if command == 'backup' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[2])
    elif command == 'restore' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[3])

    backup = BackupRestore(domain=domain)

    if not backup.connect():
        sys.exit(1)

    try:
        if command == 'backup' and len(sys.argv) == 4:
            backup.backup_site(resolve_path(sys.argv[2]), sys.argv[3])

        elif command == 'restore' and len(sys.argv) == 4:
            backup.restore_site(sys.argv[2], resolve_path(sys.argv[3]))

        elif command == 'list' and len(sys.argv) == 3:
            backup.list_backups(sys.argv[2])

        else:
            print("✗ Invalid command or arguments")
            sys.exit(1)

    finally:
        backup.disconnect()


if __name__ == '__main__':
    main()
