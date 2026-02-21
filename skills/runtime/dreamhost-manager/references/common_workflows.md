# DreamHost Common Workflows

Common tasks and workflows for managing your DreamHost websites.

## Static Site Deployment

Deploy a static website (HTML/CSS/JS) to your DreamHost hosting.

### One-Time Upload

Upload an entire site directory:

```bash
python directory_sync.py upload ./my-website /home/user/yourdomain.com
```

This will:
- Upload all files recursively
- Skip unchanged files (by timestamp)
- Create missing directories
- Exclude common patterns (.git, node_modules, etc.)

### Ongoing Updates

Deploy updates to existing site:

```bash
python directory_sync.py upload ./my-website /home/user/yourdomain.com
```

Will only upload files that have changed since last upload.

## Website Backup & Restore

### Create a Full Backup

Back up your entire website:

```bash
python backup_restore.py backup /home/user/yourdomain.com ./backups
```

Creates: `./backups/backup_20240115_120000.tar.gz`

### List Available Backups

```bash
python backup_restore.py list ./backups
```

Output:
```
1. backup_20240115_120000.tar.gz     (45.23 MB)
2. backup_20240114_180000.tar.gz     (44.89 MB)
3. backup_20240113_090000.tar.gz     (43.56 MB)
```

### Restore from Backup

Restore your website from a backup:

```bash
python backup_restore.py restore ./backups/backup_20240115_120000.tar.gz /home/user/yourdomain.com
```

This will:
- Back up current version first (safety)
- Extract backup
- Upload all files
- Clean up temporary files

## File Management

### Upload Single File

```bash
python sftp_operations.py upload ./index.html /home/user/yourdomain.com/index.html
```

### Download Single File

```bash
python sftp_operations.py download /home/user/yourdomain.com/index.html ./backup/index.html
```

### List Files in Directory

```bash
python sftp_operations.py list /home/user/yourdomain.com
```

### Delete File

```bash
python sftp_operations.py delete /home/user/yourdomain.com/old-file.html
```

### Create Directory

```bash
python sftp_operations.py mkdir /home/user/yourdomain.com/new-folder
```

## Blog Content Management

### Upload New Blog Post

Post with markdown file and images:

```
posts/
├── my-new-post.md
├── images/
│   ├── header.jpg
│   └── featured.png
└── assets/
    └── styles.css
```

Upload:

```bash
python blog_manager.py upload ./posts/my-new-post.md /home/user/yourdomain.com/blog
```

This uploads:
- `my-new-post.md` → `/home/user/yourdomain.com/blog/my-new-post.md`
- Images → `/home/user/yourdomain.com/blog/assets/`

### Update Existing Post

```bash
python blog_manager.py update ./posts/my-new-post.md /home/user/yourdomain.com/blog/my-new-post.md
```

### List Blog Posts

```bash
python blog_manager.py list /home/user/yourdomain.com/blog
```

### Delete Old Post

```bash
python blog_manager.py delete /home/user/yourdomain.com/blog/old-post.md
```

## Server Management

### Check Disk Usage

```bash
python ssh_commands.py disk-usage /home/user/yourdomain.com
```

### List Files on Server

```bash
python ssh_commands.py list /home/user/yourdomain.com
```

### Find Files Matching Pattern

Find all `.html` files:

```bash
python ssh_commands.py find /home/user/yourdomain.com "*.html"
```

### Change File Permissions

Make file readable/writable:

```bash
python ssh_commands.py chmod /home/user/yourdomain.com/config.php 644
```

### Recursively Change Permissions

Set standard web directory permissions:

```bash
python ssh_commands.py chmod-recursive /home/user/yourdomain.com 644 755
```

This sets:
- Files: 644 (readable, writable by owner, readable by others)
- Directories: 755 (readable and executable by all, writable by owner)

### Create Symbolic Link

Create backup symlink:

```bash
python ssh_commands.py symlink /home/user/yourdomain.com /home/user/yourdomain-backup
```

### Remove Directory

Clean up old files:

```bash
python ssh_commands.py remove /home/user/yourdomain.com/temp
```

## Batch Operations with Scripts

Create a bash script to automate multiple operations:

```bash
#!/bin/bash

# Daily backup script
echo "Creating daily backup..."
python backup_restore.py backup /home/user/yourdomain.com ./backups

echo "Checking disk usage..."
python ssh_commands.py disk-usage /home/user/yourdomain.com

echo "Backup complete!"
```

Run with:
```bash
chmod +x backup_script.sh
./backup_script.sh
```

## Scheduled Backups (Cron)

Add to crontab to run backups automatically:

```bash
crontab -e
```

Add line for daily backup at 2 AM:

```
0 2 * * * cd /path/to/skill && python backup_restore.py backup /home/user/yourdomain.com ./backups
```

## Troubleshooting Common Issues

### "Permission denied" on file operations
Set correct permissions:
```bash
python ssh_commands.py chmod-recursive /home/user/yourdomain.com 644 755
```

### Site not updating after upload
1. Clear browser cache
2. Check file was uploaded:
   ```bash
   python sftp_operations.py list /home/user/yourdomain.com
   ```
3. Verify remote path is correct
4. Check file permissions are readable (644 or 755)

### Backup file is huge
Large backups might include unnecessary files. Update exclude patterns in `directory_sync.py` for next deployment.

### Connection timeouts
- Try uploading smaller batches
- Check internet connection
- Verify DreamHost server is responsive

See `setup_guide.md` for credential setup and `react_deployment.md` for React app deployment.
