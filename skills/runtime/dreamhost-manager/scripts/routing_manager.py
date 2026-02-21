#!/usr/bin/env python3
"""
DreamHost Routing Manager
Configure .htaccess for React Router and multi-site routing
"""

import os
import sys
import paramiko
from pathlib import Path
from dotenv import load_dotenv
from path_resolver import resolve_path, extract_domain, get_credentials, initialize_env

# Initialize environment variables for this skill
skill_dir = Path(__file__).parent.parent
initialize_env(str(skill_dir / ".env"))


class RoutingManager:
    """Configure routing for React apps on DreamHost"""

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

    def _htaccess_spa_routing(self, base_path='/'):
        """Generate .htaccess for React SPA routing"""
        return f"""# Enable mod_rewrite
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase {base_path}

  # Don't rewrite files or directories
  RewriteCond %{{REQUEST_FILENAME}} !-f
  RewriteCond %{{REQUEST_FILENAME}} !-d

  # Rewrite everything else to index.html
  RewriteRule ^(.*)$ index.html [QSA,L]
</IfModule>

# Gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>

# Cache headers
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresDefault "access plus 1 month"

  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType application/json "access plus 0 seconds"
  ExpiresByType application/javascript "access plus 1 month"
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType image/jpeg "access plus 1 month"
  ExpiresByType image/png "access plus 1 month"
  ExpiresByType image/gif "access plus 1 month"
  ExpiresByType font/woff2 "access plus 1 month"
</IfModule>
"""

    def _htaccess_subdirectory_proxy(self, app_path):
        """Generate .htaccess for subdirectory app routing"""
        return f"""# Enable mod_rewrite
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase {app_path}

  # Don't rewrite files or directories
  RewriteCond %{{REQUEST_FILENAME}} !-f
  RewriteCond %{{REQUEST_FILENAME}} !-d

  # Rewrite everything else to index.html
  RewriteRule ^(.*)$ index.html [QSA,L]
</IfModule>

# Gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>
"""

    def _htaccess_subdomain_root(self):
        """Generate .htaccess for subdomain root routing"""
        return """# Enable mod_rewrite
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # Don't rewrite files or directories
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d

  # Rewrite everything else to index.html
  RewriteRule ^(.*)$ index.html [QSA,L]
</IfModule>

# Gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>
"""

    def configure_app_routing(self, app_directory):
        """Configure .htaccess for an app directory (SPA routing)"""
        htaccess_path = f"{app_directory}/.htaccess"
        content = self._htaccess_spa_routing('/')

        try:
            # Upload .htaccess
            with open('/tmp/htaccess_temp', 'w') as f:
                f.write(content)

            self.sftp.put('/tmp/htaccess_temp', htaccess_path)
            os.remove('/tmp/htaccess_temp')

            print(f"✓ Configured SPA routing in {app_directory}")
            print(f"  Created: {htaccess_path}")
            return True
        except Exception as e:
            print(f"✗ Configuration failed: {str(e)}")
            return False

    def configure_subdirectory_app(self, domain_root, app_name, app_directory):
        """Configure subdirectory app (e.g., /app1)"""
        app_path = f"/{app_name}"
        htaccess_path = f"{app_directory}/.htaccess"
        content = self._htaccess_subdirectory_proxy(app_path)

        try:
            with open('/tmp/htaccess_temp', 'w') as f:
                f.write(content)

            self.sftp.put('/tmp/htaccess_temp', htaccess_path)
            os.remove('/tmp/htaccess_temp')

            print(f"✓ Configured subdirectory app at /{app_name}")
            print(f"  Path: {app_directory}")
            print(f"  Access at: yourdomain.com/{app_name}")
            return True
        except Exception as e:
            print(f"✗ Configuration failed: {str(e)}")
            return False

    def configure_subdomain_app(self, app_directory):
        """Configure subdomain app (e.g., app1.yourdomain.com)"""
        htaccess_path = f"{app_directory}/.htaccess"
        content = self._htaccess_subdomain_root()

        try:
            with open('/tmp/htaccess_temp', 'w') as f:
                f.write(content)

            self.sftp.put('/tmp/htaccess_temp', htaccess_path)
            os.remove('/tmp/htaccess_temp')

            print(f"✓ Configured subdomain app")
            print(f"  Path: {app_directory}")
            print(f"  Note: Subdomain DNS must be configured in DreamHost panel")
            return True
        except Exception as e:
            print(f"✗ Configuration failed: {str(e)}")
            return False


def main():
    if len(sys.argv) < 3:
        print("""
DreamHost Routing Manager

Usage:
  python routing_manager.py configure-app <app_directory>
  python routing_manager.py configure-subdir <app_name> <app_directory>
  python routing_manager.py configure-subdomain <app_directory>

Examples:
  # Configure app for React Router (SPA routing)
  python routing_manager.py configure-app /home/user/yourdomain.com

  # Configure subdirectory app (e.g., yourdomain.com/app1)
  python routing_manager.py configure-subdir app1 /home/user/yourdomain.com/app1

  # Configure subdomain app (e.g., app1.yourdomain.com)
  python routing_manager.py configure-subdomain /home/user/app1.yourdomain.com

Features:
  - Automatically configures .htaccess for React Router
  - Enables gzip compression
  - Sets appropriate cache headers
  - Supports single app, subdirectory, and subdomain configurations
""")
        sys.exit(1)

    command = sys.argv[1]

    # Extract domain from path arguments
    domain = None
    if command == 'configure-app' and len(sys.argv) == 3:
        domain = extract_domain(sys.argv[2])
    elif command == 'configure-subdir' and len(sys.argv) == 4:
        domain = extract_domain(sys.argv[3])
    elif command == 'configure-subdomain' and len(sys.argv) == 3:
        domain = extract_domain(sys.argv[2])

    manager = RoutingManager(domain=domain)

    if not manager.connect():
        sys.exit(1)

    try:
        if command == 'configure-app' and len(sys.argv) == 3:
            manager.configure_app_routing(resolve_path(sys.argv[2]))

        elif command == 'configure-subdir' and len(sys.argv) == 4:
            manager.configure_subdirectory_app(None, sys.argv[2], resolve_path(sys.argv[3]))

        elif command == 'configure-subdomain' and len(sys.argv) == 3:
            manager.configure_subdomain_app(resolve_path(sys.argv[2]))

        else:
            print("✗ Invalid command or arguments")
            sys.exit(1)

    finally:
        manager.disconnect()


if __name__ == '__main__':
    main()
