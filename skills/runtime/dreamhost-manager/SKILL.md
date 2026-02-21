---
name: dreamhost-manager
description: "Complete DreamHost website management via SFTP/SSH for React JS
  deployments, multi-site routing, file operations, and content management. Use
  when users need to: (1) Deploy React applications to DreamHost hosting, (2)
  Configure routing for multiple React/static sites within a domain (subdomains
  or subdirectories), (3) Upload, edit, or delete website files, (4) Deploy
  static websites or blog content, (5) Backup or restore website directories,
  (6) Manage business website content and files, or execute server commands for
  any DreamHost website management tasks."
allowed-tools: run_command read_file write_file
metadata:
  legacy_slug: dreamhost-manager
  legacy_summary: Complete DreamHost website management via SFTP/SSH for React
    deployments and content management
  legacy_version: 1.0.0
  legacy_author: FF-Terminal
  legacy_priority: high
  legacy_triggers: '["dreamhost","deploy","sftp","ssh","upload site","website
    deploy","hosting","farm-friend.com","react deploy"]'
  legacy_tags: '["hosting","deployment","sftp","ssh","website-management"]'
  legacy_recommended_tools: '["run_command","read_file","write_file"]'
  legacy_assets: '["assets/.env.template"]'
---

# DreamHost Manager Skill

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Complete solution for managing websites on DreamHost hosting via SFTP/SSH.

## Quick Start

### 1. Setup Credentials

Copy and configure `.env` file:

```bash
cp assets/.env.template .env
# Edit .env with your DreamHost credentials
```

See `setup_guide.md` for detailed credential setup.

### 2. Configure Domain Mappings (Optional but Recommended)

Add your domains to `.env` for convenient naming:

```bash
# .env
DOMAIN_farm-friend.com=/home/dh_cqevup/farm-friend.com
DOMAIN_yourdomain.com=/home/username/yourdomain.com
```

### 3. Test Connection

Verify your setup works (using domain name or full path):

```bash
# Using domain name (if configured in .env)
python scripts/sftp_operations.py list farm-friend.com

# Using full path (always works)
python scripts/sftp_operations.py list /home/dh_cqevup/farm-friend.com
```

### 4. Deploy Your Site

**For React apps:**
```bash
# Using domain name
python scripts/react_deployer.py deploy . farm-friend.com
python scripts/routing_manager.py configure-app farm-friend.com

# Or using full path
python scripts/react_deployer.py deploy . /home/dh_cqevup/farm-friend.com
python scripts/routing_manager.py configure-app /home/dh_cqevup/farm-friend.com
```

**For static sites:**
```bash
python scripts/directory_sync.py upload ./my-website farm-friend.com
```

**For backups:**
```bash
python scripts/backup_restore.py backup farm-friend.com ./backups
```

## Core Features

### React Application Deployment

Deploy React apps built with Create React App, Vite, or Next.js:

```bash
python scripts/react_deployer.py deploy <project_dir> <remote_path>
```

Automatically:
- Detects framework type
- Runs build process
- Uploads optimized artifacts
- Cleans old deployments

### Multi-Site Routing

Configure multiple sites on same domain using:
- **Subdomains**: `app1.yourdomain.com`, `app2.yourdomain.com`
- **Subdirectories**: `yourdomain.com/app1`, `yourdomain.com/app2`

```bash
# Subdomain
python scripts/routing_manager.py configure-subdomain /home/user/app1.yourdomain.com

# Subdirectory
python scripts/routing_manager.py configure-subdir app1 /home/user/yourdomain.com/app1
```

### File Operations

Upload, download, and manage files:

```bash
# Upload single file
python scripts/sftp_operations.py upload ./index.html yourdomain.com/index.html

# Download file
python scripts/sftp_operations.py download yourdomain.com/index.html ./backup.html

# List files
python scripts/sftp_operations.py list yourdomain.com

# Create directory
python scripts/sftp_operations.py mkdir yourdomain.com/new-folder

# Delete file
python scripts/sftp_operations.py delete yourdomain.com/old.html
```

Note: Use domain names (if configured in .env) or full paths like `/home/user/yourdomain.com`

### Directory Synchronization

Sync entire directories for quick deployments:

```bash
python scripts/directory_sync.py upload ./my-website yourdomain.com
```

Features:
- Recursive upload/download
- Timestamp comparison (skips unchanged files)
- Automatic exclusion (.git, node_modules, etc.)
- Progress tracking

### Backup & Restore

Create and restore timestamped backups:

```bash
# Create backup
python scripts/backup_restore.py backup yourdomain.com ./backups

# List backups
python scripts/backup_restore.py list ./backups

# Restore backup
python scripts/backup_restore.py restore ./backups/backup_20240115_120000.tar.gz yourdomain.com
```

Features:
- Automatic timestamped backups
- Tar.gz compression
- Safe restore (backs up current version first)
- Large file support

### Blog & Content Management

Upload and manage blog posts:

```bash
# Upload post with images
python scripts/blog_manager.py upload ./posts/my-post.md yourdomain.com/blog

# List posts
python scripts/blog_manager.py list yourdomain.com/blog

# Update post
python scripts/blog_manager.py update ./posts/my-post.md yourdomain.com/blog/my-post.md

# Delete post
python scripts/blog_manager.py delete yourdomain.com/blog/old.md
```

### Server Commands

Execute shell commands on the server:

```bash
# Check disk usage
python scripts/ssh_commands.py disk-usage yourdomain.com

# Change file permissions
python scripts/ssh_commands.py chmod yourdomain.com/config.php 644

# Recursively change permissions (standard web setup)
python scripts/ssh_commands.py chmod-recursive yourdomain.com 644 755

# Create symlink
python scripts/ssh_commands.py symlink yourdomain.com /backup

# Find files
python scripts/ssh_commands.py find yourdomain.com "*.html"

# Execute custom command
python scripts/ssh_commands.py exec "cd /home/user/yourdomain.com && ls -la"
```

## Scripts Reference

| Script | Purpose | Key Functions |
|--------|---------|---------------|
| `sftp_operations.py` | Core file operations | upload, download, list, mkdir, delete, rename |
| `directory_sync.py` | Sync directories | Recursive upload/download with timestamp checking |
| `react_deployer.py` | Deploy React apps | Auto-detect framework, build, deploy artifacts |
| `routing_manager.py` | Configure routing | .htaccess for React Router, multi-site setup |
| `backup_restore.py` | Backup management | Create, restore, list timestamped backups |
| `ssh_commands.py` | Server commands | chmod, symlinks, find, disk usage |
| `blog_manager.py` | Blog content | Upload posts, manage assets, organize content |

## Documentation

- **setup_guide.md** - Credential setup and first-time configuration
- **common_workflows.md** - Practical examples for deployment, backups, content management
- **react_deployment.md** - React-specific deployment and multi-site routing

## Configuration

### .env File Format

```bash
DREAMHOST_HOST=your_host.dreamhost.com
DREAMHOST_USER=your_username
DREAMHOST_PASSWORD=your_password
# OR for SSH key (more secure):
# DREAMHOST_SSH_KEY_PATH=/path/to/.ssh/id_rsa
```

See `assets/.env.template` for complete template with security notes.

### Domain Name Mapping & Per-Domain Credentials

Each domain can have its own DreamHost credentials (host, user, password). Configure them in your `.env` file:

```bash
# .env
# ========== DOMAIN 1: farm-friend.com ==========
DOMAIN_farm-friend.com=/home/dh_cqevup/farm-friend.com
DREAMHOST_HOST_farm-friend.com=server1.dreamhost.com
DREAMHOST_USER_farm-friend.com=user1
DREAMHOST_PASSWORD_farm-friend.com=password1

# ========== DOMAIN 2: yourdomain.com ==========
DOMAIN_yourdomain.com=/home/dh_xxxx/yourdomain.com
DREAMHOST_HOST_yourdomain.com=server2.dreamhost.com
DREAMHOST_USER_yourdomain.com=user2
DREAMHOST_PASSWORD_yourdomain.com=password2
```

The agent automatically extracts the domain from your command and uses the matching credentials:

```bash
# Agent automatically uses farm-friend.com credentials
python scripts/sftp_operations.py list farm-friend.com

# Agent automatically uses yourdomain.com credentials
python scripts/react_deployer.py deploy . yourdomain.com

# Also works with full paths (uses credentials from the domain in the path)
python scripts/sftp_operations.py list /home/dh_cqevup/farm-friend.com
```

**How it works:**
1. Agent extracts domain from the command: `farm-friend.com`
2. Looks up credentials in .env: `DREAMHOST_HOST_farm-friend.com`, `DREAMHOST_USER_farm-friend.com`, etc.
3. Connects to that domain's DreamHost account
4. Performs the requested operation

This allows seamless management of multiple domains with different DreamHost accounts.

## Common Workflows

### Deploy Static Website

```bash
python scripts/directory_sync.py upload ./website yourdomain.com
```

### Deploy React App with Routing

```bash
python scripts/react_deployer.py deploy . yourdomain.com
python scripts/routing_manager.py configure-app yourdomain.com
```

### Daily Backup

```bash
python scripts/backup_restore.py backup yourdomain.com ./backups
```

### Update Blog Post

```bash
python scripts/blog_manager.py update ./posts/post.md yourdomain.com/blog/post.md
```

See `references/common_workflows.md` for more examples.

## Dependencies

Install required packages:

```bash
pip install -r requirements.txt
```

Required:
- **paramiko** - SFTP/SSH library
- **python-dotenv** - Environment variable loading
- **scp** - Enhanced file transfer

## Troubleshooting

### Connection Issues

1. Verify credentials in `.env`
2. Check host is accessible
3. Confirm SFTP port 22 is open
4. Test with: `python scripts/sftp_operations.py list /home/username`

See `references/setup_guide.md` for detailed troubleshooting.

## Next Steps

1. Follow setup in `references/setup_guide.md`
2. Test with examples in `references/common_workflows.md`
3. Deploy your site!
