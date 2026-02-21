#!/usr/bin/env python3
"""
DreamHost Blog Manager
Upload blog posts and manage blog content
"""

import os
import sys
from pathlib import Path
import paramiko
from dotenv import load_dotenv
from path_resolver import resolve_path, extract_domain, get_credentials

load_dotenv()


class BlogManager:
    """Manage blog content on DreamHost"""

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

    def upload_post(self, local_post_path, remote_blog_dir):
        """Upload a blog post with associated images/assets"""
        post_path = Path(local_post_path)

        if not post_path.exists():
            print(f"✗ Post file not found: {local_post_path}")
            return False

        try:
            # Create blog directory if it doesn't exist
            try:
                self.sftp.stat(remote_blog_dir)
            except IOError:
                self._create_remote_dir(remote_blog_dir)

            # Upload post file
            remote_post_path = f"{remote_blog_dir}/{post_path.name}"
            print(f"📝 Uploading post: {post_path.name}")
            self.sftp.put(str(post_path), remote_post_path)
            print(f"✓ Uploaded: {post_path.name}")

            # Upload associated assets (images in same directory)
            post_dir = post_path.parent
            assets_dir = post_dir / 'assets'
            images_dir = post_dir / 'images'

            for asset_dir in [assets_dir, images_dir]:
                if asset_dir.exists():
                    self._upload_assets(str(asset_dir), f"{remote_blog_dir}/assets")

            return True

        except Exception as e:
            print(f"✗ Upload failed: {str(e)}")
            return False

    def update_post(self, local_post_path, remote_post_path):
        """Update an existing blog post"""
        post_path = Path(local_post_path)

        if not post_path.exists():
            print(f"✗ Post file not found: {local_post_path}")
            return False

        try:
            print(f"📝 Updating post: {post_path.name}")
            self.sftp.put(str(post_path), remote_post_path)
            print(f"✓ Updated: {post_path.name}")
            return True

        except Exception as e:
            print(f"✗ Update failed: {str(e)}")
            return False

    def list_posts(self, remote_blog_dir):
        """List blog posts in directory"""
        try:
            print(f"\n📚 Blog posts in {remote_blog_dir}:")
            print("-" * 80)

            items = self.sftp.listdir_attr(remote_blog_dir)
            posts = []

            for item in sorted(items, key=lambda x: x.filename):
                if not self._is_directory(item):
                    if item.filename.endswith(('.md', '.html', '.txt')):
                        size_kb = item.st_size / 1024
                        posts.append((item.filename, size_kb))

            if not posts:
                print("No posts found")
                return True

            for name, size in posts:
                print(f"  {name:40} ({size:>8.2f} KB)")

            print("-" * 80)
            print(f"Total: {len(posts)} posts")
            return True

        except Exception as e:
            print(f"✗ List failed: {str(e)}")
            return False

    def delete_post(self, remote_post_path):
        """Delete a blog post"""
        try:
            print(f"🗑️  Deleting: {remote_post_path}")
            self.sftp.remove(remote_post_path)
            print(f"✓ Deleted")
            return True

        except Exception as e:
            print(f"✗ Delete failed: {str(e)}")
            return False

    def _upload_assets(self, local_assets_dir, remote_assets_dir):
        """Upload asset files (images, etc.)"""
        assets_path = Path(local_assets_dir)

        if not assets_path.exists():
            return

        try:
            # Create remote assets directory
            try:
                self.sftp.stat(remote_assets_dir)
            except IOError:
                self._create_remote_dir(remote_assets_dir)

            # Upload each file
            for asset_file in assets_path.iterdir():
                if asset_file.is_file():
                    remote_asset_path = f"{remote_assets_dir}/{asset_file.name}"
                    print(f"  Uploading asset: {asset_file.name}")
                    self.sftp.put(str(asset_file), remote_asset_path)

        except Exception as e:
            print(f"✗ Asset upload failed: {str(e)}")

    def _create_remote_dir(self, remote_path):
        """Create remote directory recursively"""
        parts = remote_path.split('/')
        current_path = ''

        for part in parts:
            if not part:
                continue
            current_path += '/' + part
            try:
                self.sftp.stat(current_path)
            except IOError:
                self.sftp.mkdir(current_path)

    def _is_directory(self, sftp_attr):
        """Check if SFTP item is directory"""
        import stat
        return stat.S_ISDIR(sftp_attr.st_mode)


def main():
    if len(sys.argv) < 2:
        print("""
DreamHost Blog Manager

Usage:
  python blog_manager.py upload <local_post> <remote_blog_dir>
  python blog_manager.py update <local_post> <remote_post_path>
  python blog_manager.py delete <remote_post_path>
  python blog_manager.py list <remote_blog_dir>

Examples:
  # Upload new blog post
  python blog_manager.py upload ./posts/my-post.md /home/user/yourdomain.com/blog

  # Update existing post
  python blog_manager.py update ./posts/my-post.md /home/user/yourdomain.com/blog/my-post.md

  # List all posts
  python blog_manager.py list /home/user/yourdomain.com/blog

  # Delete a post
  python blog_manager.py delete /home/user/yourdomain.com/blog/old-post.md

Features:
  - Upload posts with associated images/assets
  - Support for markdown, HTML, and text files
  - Automatic asset directory creation
  - List and manage blog content
""")
        sys.exit(1)

    command = sys.argv[1]

    # Extract domain from path arguments
    domain = None
    if command == 'upload' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[3])
    elif command == 'update' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[3])
    elif command == 'list' and len(sys.argv) == 3:
        domain = extract_domain(sys.argv[2])
    elif command == 'delete' and len(sys.argv) == 3:
        domain = extract_domain(sys.argv[2])

    blog = BlogManager(domain=domain)

    if not blog.connect():
        sys.exit(1)

    try:
        if command == 'upload' and len(sys.argv) == 4:
            blog.upload_post(sys.argv[2], resolve_path(sys.argv[3]))

        elif command == 'update' and len(sys.argv) == 4:
            blog.update_post(sys.argv[2], resolve_path(sys.argv[3]))

        elif command == 'list' and len(sys.argv) == 3:
            blog.list_posts(resolve_path(sys.argv[2]))

        elif command == 'delete' and len(sys.argv) == 3:
            blog.delete_post(resolve_path(sys.argv[2]))

        else:
            print("✗ Invalid command or arguments")
            sys.exit(1)

    finally:
        blog.disconnect()


if __name__ == '__main__':
    main()
