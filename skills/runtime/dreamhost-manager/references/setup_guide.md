# DreamHost Setup Guide

## Getting Started

This guide walks you through obtaining credentials and configuring the DreamHost manager skill.

## Step 1: Obtain SFTP Credentials

1. Log in to your DreamHost panel at https://panel.dreamhost.com
2. Go to **Users** → **Manage Users**
3. Find your user and click **Edit**
4. Note the following:
   - **Username**: Your FTP/SFTP username
   - **Server**: Your host (e.g., `server.dreamhost.com`)
5. If you don't have a password, set one or use password authentication

## Step 2: Enable SSH Access (Optional but Recommended)

SSH access is optional but allows you to execute commands directly on the server.

1. In the **Users** → **Manage Users** section
2. Find your user and click **Edit**
3. Check the box for **Shell (SSH) access**
4. Save changes
5. SSH will be available after a few minutes

## Step 3: Set Up SSH Key (Optional but More Secure)

Instead of using password authentication, you can use SSH keys:

1. Generate SSH key locally (if you don't have one):
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/dreamhost
   ```

2. Copy the public key:
   ```bash
   cat ~/.ssh/dreamhost.pub
   ```

3. In DreamHost panel, add your public key to authorized keys (some hosts have an SSH Key management section)

4. Update `.env` file to use the key (see below)

## Step 4: Create .env File

1. Copy the `.env.template` to `.env`:
   ```bash
   cp .env.template .env
   ```

2. Edit `.env` and fill in your credentials:
   ```
   DREAMHOST_HOST=your_host.dreamhost.com
   DREAMHOST_USER=your_username
   DREAMHOST_PASSWORD=your_password
   ```

3. Or use SSH key instead of password:
   ```
   DREAMHOST_HOST=your_host.dreamhost.com
   DREAMHOST_USER=your_username
   DREAMHOST_SSH_KEY_PATH=/path/to/your/.ssh/dreamhost
   ```

## Step 5: Test the Connection

Run a simple test:

```bash
# Test SFTP connection
python sftp_operations.py list /home/username/yourdomain.com
```

If this works, you're all set!

## Step 6: Configure Per-Domain Credentials

If you have multiple domains on different DreamHost accounts, configure each domain's credentials in your `.env` file:

```bash
# .env
# ========== DOMAIN 1: farm-friend.com ==========
DOMAIN_farm-friend.com=/home/dh_cqevup/farm-friend.com
DREAMHOST_HOST_farm-friend.com=your_host_for_domain1.dreamhost.com
DREAMHOST_USER_farm-friend.com=dh_user1
DREAMHOST_PASSWORD_farm-friend.com=password1

# ========== DOMAIN 2: yourdomain.com ==========
DOMAIN_yourdomain.com=/home/dh_xxxx/yourdomain.com
DREAMHOST_HOST_yourdomain.com=your_host_for_domain2.dreamhost.com
DREAMHOST_USER_yourdomain.com=dh_user2
DREAMHOST_PASSWORD_yourdomain.com=password2
```

**How it works:**
- When you run a command with a domain name, the agent automatically:
  1. Recognizes the domain (e.g., `farm-friend.com`)
  2. Looks up its credentials in `.env` (DREAMHOST_HOST_farm-friend.com, etc.)
  3. Connects using those credentials
  4. Performs the operation

Once configured:

```bash
# Uses farm-friend.com's credentials automatically
python sftp_operations.py list farm-friend.com

# Uses yourdomain.com's credentials automatically
python react_deployer.py deploy . yourdomain.com

# Works with full paths too (extracts domain from path)
python sftp_operations.py list /home/dh_cqevup/farm-friend.com
```

**If all domains use the same credentials**, you can skip this and use the global credentials from Step 4.

## Finding Your Remote Paths

Your files are typically located at:
```
/home/username/yourdomain.com
```

Where:
- `username` = your SFTP username
- `yourdomain.com` = your website domain

To find your exact path, you can:

1. Connect via FTP client and see the path
2. Ask DreamHost support
3. Check your DreamHost panel under **Domains**

## Security Best Practices

1. **Use SSH keys instead of passwords** when possible
2. **Keep .env file private** - add to `.gitignore`:
   ```
   .env
   ```
3. **Use strong passwords** or SSH key passphrases
4. **Limit SSH key permissions**:
   ```bash
   chmod 600 ~/.ssh/dreamhost
   chmod 644 ~/.ssh/dreamhost.pub
   ```
5. **Test connections before automation** - make sure everything works manually first

## Troubleshooting

### Connection Refused
- Check host and port (should be 22 for SFTP/SSH)
- Verify username is correct
- Confirm SSH access is enabled in DreamHost panel

### Permission Denied
- Check password/SSH key
- Verify SSH key has correct permissions (600)
- Confirm SSH access is enabled for your user

### File Not Found
- Double-check the remote path
- Verify files exist using:
  ```bash
  python sftp_operations.py list /home/username/yourdomain.com
  ```

### "DreamHost API" Errors (Old Documentation)
- The DreamHost API has been deprecated for most operations
- This skill uses SFTP/SSH instead, which is more reliable

## Next Steps

- See `common_workflows.md` for deployment examples
- See `react_deployment.md` for React app deployment
- Check individual script help for detailed usage:
  ```bash
  python sftp_operations.py
  python directory_sync.py
  python react_deployer.py
  ```
