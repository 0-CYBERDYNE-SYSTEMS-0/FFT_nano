# Discord Bot Setup Guide

This guide provides exact click-by-click instructions to create a Discord bot application and obtain your bot token.

## Prerequisites

- A Discord account
- Administrative access to a Discord server (or ability to create one)

## Part 1: Create Discord Application and Obtain Bot Token

### Step 1: Access Discord Developer Portal

1. Open your web browser
2. Navigate to: https://discord.com/developers/applications
3. Click **Log In** if not already logged in
4. Log in with your Discord credentials

### Step 2: Create New Application

1. Click the blue **New Application** button (top right)
2. In the popup dialog:
   - Enter a name for your application (e.g., "My Photo Bot")
   - Check the box to agree to Discord's Developer Terms of Service
   - Click **Create**

### Step 3: Configure Application (Optional)

1. You're now on the application's "General Information" page
2. Optional configurations:
   - Add an app icon by clicking the icon placeholder
   - Add a description
   - Add tags
3. Click **Save Changes** if you made any changes

### Step 4: Create Bot User

1. In the left sidebar, click **Bot**
2. Click the blue **Add Bot** button
3. In the confirmation popup, click **Yes, do it!**
4. Your bot is now created

### Step 5: Configure Bot Settings

1. On the Bot page, configure these settings:
   - **Public Bot**: Toggle OFF if you only want to add it to your own servers (recommended for personal use)
   - **Requires OAuth2 Code Grant**: Leave OFF (default)
   - **Presence Intent**: Toggle ON
   - **Server Members Intent**: Toggle ON
   - **Message Content Intent**: Toggle ON (REQUIRED for reading message content)

2. Click **Save Changes** at the bottom

### Step 6: Obtain Bot Token

1. On the Bot page, find the **TOKEN** section
2. Click **Reset Token**
3. In the confirmation popup, click **Yes, do it!**
4. Your token is now visible
5. **IMPORTANT**: Click **Copy** to copy the token to your clipboard
6. **CRITICAL**: Save this token immediately in a secure location
   - You can only view it once
   - If you lose it, you'll need to regenerate it
   - Never share this token publicly or commit it to version control

### Step 7: Get Your Bot Token Again (If Lost)

If you already created a bot but lost the token:

1. Go to https://discord.com/developers/applications
2. Click on your application
3. Click **Bot** in the left sidebar
4. Click **Reset Token**
5. Confirm by clicking **Yes, do it!**
6. Copy the new token immediately

## Part 2: Invite Bot to Your Server

### Step 1: Generate Invite URL

1. In the left sidebar, click **OAuth2**
2. Click **URL Generator**
3. In the **SCOPES** section, check:
   - `bot`
4. In the **BOT PERMISSIONS** section, check these permissions:
   - **General Permissions**:
     - View Channels
   - **Text Permissions**:
     - Send Messages
     - Send Messages in Threads
     - Manage Messages (if you need to delete messages)
     - Embed Links
     - Attach Files
     - Read Message History
     - Mention Everyone (optional)
     - Add Reactions (optional)
   - Or simply check **Administrator** for full permissions (easier but less secure)

5. Scroll down and copy the **GENERATED URL**

### Step 2: Invite Bot to Server

1. Paste the generated URL into your browser
2. Select the server you want to add the bot to from the dropdown
3. Click **Continue**
4. Review the permissions and click **Authorize**
5. Complete the CAPTCHA if prompted
6. Your bot is now in your server!

## Part 3: Configure Environment

### Step 1: Create .env File

1. In your project directory, create a file named `.env`
2. Add the following line:
   ```
   DISCORD_BOT_TOKEN=your_token_here
   ```
3. Replace `your_token_here` with your actual bot token
4. **IMPORTANT**: Add `.env` to your `.gitignore` file to prevent committing secrets

Example `.env` file:
```
DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
```

### Step 2: Verify .env is Ignored by Git

1. Open or create `.gitignore` in your project root
2. Add this line:
   ```
   .env
   ```
3. Save the file

### Step 3: Install Dependencies

Install required Python packages:

```bash
pip install discord.py python-dotenv aiohttp
```

Or with a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install discord.py python-dotenv aiohttp
```

## Part 4: Test Your Bot

### Test Bot Connection

Run the discord_client.py script to verify your bot can connect:

```bash
python scripts/discord_client.py
```

Expected output:
```
Testing Discord bot connection...
✅ Bot connected as YourBotName (ID: 123456789)
✅ Successfully connected!
Bot name: YourBotName
Bot ID: 123456789
Guilds: 1
  - Your Server Name (ID: 987654321)
```

### Get Channel IDs

To use the scripts, you need channel IDs. Here's how to get them:

1. In Discord, enable Developer Mode:
   - Click User Settings (gear icon)
   - Go to **App Settings** > **Advanced**
   - Toggle ON **Developer Mode**
   - Click X to close settings

2. Get a channel ID:
   - Right-click on any channel
   - Click **Copy Channel ID**
   - The ID is now in your clipboard

Or use the list_channels.py script:

```bash
python scripts/list_channels.py
```

## Troubleshooting

### "Invalid Token" Error

- Your token may be incorrect or expired
- Go to the Discord Developer Portal and reset your token
- Update your `.env` file with the new token

### "Missing Access" Error

- Your bot may not have permission to access the channel
- Right-click the channel > Edit Channel > Permissions
- Add your bot role and grant appropriate permissions

### "Privileged Intent" Error

- You need to enable Message Content Intent
- Go to Discord Developer Portal > Your App > Bot
- Toggle ON "Message Content Intent"
- Click Save Changes
- Restart your bot

### Bot Not Responding

- Verify the bot is online in your server (green status)
- Check that you're using the correct channel ID
- Verify the bot has Send Messages permission in that channel

## Security Best Practices

1. **Never commit your bot token to version control**
2. **Never share your bot token publicly**
3. **Use environment variables for sensitive data**
4. **Add `.env` to `.gitignore`**
5. **Regenerate your token if it's ever exposed**
6. **Use minimal permissions** (don't use Administrator unless necessary)
7. **Keep your bot code private** if it contains server-specific logic

## Additional Resources

- Discord.py Documentation: https://discordpy.readthedocs.io/
- Discord Developer Portal: https://discord.com/developers/docs/
- Discord.py GitHub: https://github.com/Rapptz/discord.py
