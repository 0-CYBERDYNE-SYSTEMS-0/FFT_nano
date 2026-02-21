# Deployment: Polling vs Webhooks

Two main approaches to receive updates from Telegram. Choose based on scale, infrastructure, and simplicity needs.

## Polling (Long-polling)

**How it works:** Bot repeatedly asks Telegram "any new messages?" Telegram responds when there are updates.

### Advantages
- Simple: no exposed endpoint needed
- Works behind NAT/firewall
- Good for low-traffic bots
- No SSL certificate required
- Quick to deploy (localhost development works)

### Disadvantages
- Higher latency (polling interval delay)
- More API calls = slight rate limit risk
- Less scalable at high volume
- Wastes resources on empty polls

### Setup

**Basic polling with aiogram:**
```python
import asyncio
from aiogram import Bot, Dispatcher

bot = Bot(token="YOUR_TOKEN")
dp = Dispatcher()

# Register handlers...

async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
```

**With custom polling interval:**
```python
async def main():
    await dp.start_polling(
        bot,
        polling_timeout=30,      # seconds
        allowed_updates=None,    # all updates
        relax_timeout=0.1        # avoid flooding
    )
```

**python-telegram-bot polling:**
```python
app = Application.builder().token(TOKEN).build()
# ... add handlers ...
app.run_polling()
```

### Good For
- Development/testing
- Low-traffic bots (<10 messages/sec)
- Behind firewall
- No infrastructure setup

### Polling on Cloud

Works fine on:
- Heroku free tier (if on dyno)
- DigitalOcean App Platform
- Google Cloud Run
- AWS Lambda (with persistent container)

Just ensure the bot stays running (not serverless trigger-based).

---

## Webhooks

**How it works:** Telegram sends updates directly to your server via HTTP POST when messages arrive.

### Advantages
- Minimal latency (instant delivery)
- Scalable to high volume
- Efficient (only processes real updates)
- Can use serverless (Lambda, Cloud Functions)
- Lower API call overhead

### Disadvantages
- Requires exposed HTTPS endpoint
- SSL certificate needed (free via Let's Encrypt)
- More complex setup
- Firewall/network requirements

### Setup

**Basic webhook with aiogram:**
```python
from aiogram import Bot, Dispatcher, types
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

# Webhook path (should be random/secret)
WEBHOOK_PATH = "/webhook/telegram"
WEBHOOK_URL = "https://yourdomain.com/webhook/telegram"

bot = Bot(token="YOUR_TOKEN")
dp = Dispatcher()

# Register handlers...

async def on_startup():
    """Set webhook when app starts."""
    await bot.set_webhook(
        url=WEBHOOK_URL,
        drop_pending_updates=True,  # Ignore old updates
        secret_token="your-secret-token"  # Telegram includes this in header
    )

async def on_shutdown():
    """Clean up when app stops."""
    await bot.session.close()

app = web.Application()
handler = SimpleRequestHandler(dispatcher=dp, bot=bot)
handler.register(app, path=WEBHOOK_PATH)
setup_application(app, dp, on_startup=on_startup, on_shutdown=on_shutdown)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=8080)
```

**python-telegram-bot webhook:**
```python
from telegram.ext import Application
from telegram import Update

WEBHOOK_URL = "https://yourdomain.com/webhook/telegram"
WEBHOOK_PORT = 8443

app = Application.builder().token(TOKEN).build()
# ... add handlers ...

app.run_webhook(
    listen="0.0.0.0",
    port=WEBHOOK_PORT,
    url_path="/webhook/telegram",
    webhook_url=WEBHOOK_URL,
    secret_token="your-secret-token"
)
```

### SSL Certificate

**Free certificate with Let's Encrypt + Nginx:**
```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Certificate will be at: /etc/letsencrypt/live/yourdomain.com/fullchain.pem
```

**Self-signed (development only):**
```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

### Webhook on Cloud

**Google Cloud Run (easiest):**
```bash
gcloud run deploy telegram-bot \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars TELEGRAM_BOT_TOKEN=your_token,WEBHOOK_URL=https://your-cloud-run-url.run.app/webhook
```

**AWS Lambda:**
```python
from aws_lambda_powertools import Logger, Tracer
from aiogram import Bot, types

logger = Logger()

async def handler(event, context):
    """AWS Lambda handler for webhook."""
    body = json.loads(event['body'])
    update = types.Update(**body)
    # Process update
    return {"statusCode": 200}
```

**DigitalOcean App Platform + Heroku:**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "main.py"]
```

Deploy with webhook URL pointing to your app platform domain.

---

## Recommendation Matrix

| Scenario | Polling | Webhook |
|----------|---------|---------|
| Development | ✅ Best | ⚠️ Need tunnel |
| Production, <100 users | ✅ Sufficient | ✅ Overkill |
| Production, >1000 users | ⚠️ Inefficient | ✅ Recommended |
| Serverless/Lambda | ❌ Won't work | ✅ Best |
| Behind firewall | ✅ Only option | ❌ Won't work |
| No infrastructure | ✅ Easiest | ❌ Needs hosting |

**Quick decision:** Polling for simplicity, webhooks for scale.
