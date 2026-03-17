# Implementation

![Deployment Architecture](../diagrams/06_deployment_architecture.png)

*Figure 1: FFT_nano Deployment Architecture*

## Overview

This section covers the practical aspects of deploying, configuring, and operating FFT_nano in production environments. It includes installation procedures, configuration management, monitoring, and maintenance best practices.

## Installation

### Prerequisites

- **Operating System**: Linux, macOS, or Windows (WSL2)
- **Python Version**: 3.10 or higher
- **Memory**: Minimum 2GB RAM (4GB recommended)
- **Storage**: 10GB free space
- **Network**: Internet connection for LLM API access

### Quick Start

#### 1. Clone Repository

```bash
git clone https://github.com/your-org/fft-nano.git
cd fft-nano
```

#### 2. Create Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

#### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

#### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

#### 5. Run Setup Wizard

```bash
python -m hermes_cli setup
```

The setup wizard will guide you through:
- API key configuration
- Platform setup (Telegram, Discord, WhatsApp)
- Toolset selection
- Testing connections

### Docker Deployment

For containerized deployments:

#### 1. Build Docker Image

```bash
docker build -t fft-nano:latest .
```

#### 2. Run Container

```bash
docker run -d \
  --name fft-nano \
  --env-file .env \
  -v ~/.hermes:/root/.hermes \
  -p 8080:8080 \
  fft-nano:latest
```

#### 3. Docker Compose (Recommended)

```yaml
version: '3.8'

services:
  fft-nano:
    build: .
    container_name: fft-nano
    env_file:
      - .env
    volumes:
      - ~/.hermes:/root/.hermes
    ports:
      - "8080:8080"
    restart: unless-stopped
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    container_name: fft-nano-db
    environment:
      POSTGRES_DB: fft_nano
      POSTGRES_USER: fft_nano
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

```bash
docker-compose up -d
```

### Raspberry Pi Deployment

For edge deployments:

#### 1. Install Dependencies

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv
```

#### 2. Clone and Setup

```bash
cd ~
git clone https://github.com/your-org/fft-nano.git
cd fft-nano
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### 3. Configure for Low Power

```bash
# .env
HERMES_MODEL=anthropic/claude-haiku  # Smaller model
MAX_ITERATIONS=20  # Reduce iterations
TOOL_TIMEOUT=60  # Shorter timeouts
```

#### 4. Install as Service

```bash
sudo cp systemd/fft-nano.service /etc/systemd/system/
sudo systemctl enable fft-nano
sudo systemctl start fft-nano
```

## Configuration

### Environment Variables

#### Core Configuration

```bash
# LLM Configuration
HERMES_MODEL=anthropic/claude-sonnet-4
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...

# Agent Behavior
HERMES_MAX_ITERATIONS=60
HERMES_TOOL_TIMEOUT=180
HERMES_STREAM_RESPONSES=true

# Production Mode
PRODUCTION_MODE=false
```

#### Platform Configuration

```bash
# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_USERS=123456789,987654321

# Discord
DISCORD_BOT_TOKEN=MTIz...
DISCORD_ALLOWED_USERS=123456789012345678

# WhatsApp (Business API)
WHATSAPP_BUSINESS_ID=your-business-id
WHATSAPP_PHONE_ID=your-phone-id
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-verify-token
```

#### Gateway Configuration

```bash
# Gateway Settings
GATEWAY_ALLOW_ALL_USERS=false
MESSAGING_CWD=/home/user

# Tool Progress Notifications
TOOL_PROGRESS=new  # off, new, all, verbose
```

#### Integration Configuration

```bash
# Weather API
WEATHER_API_KEY=your-weather-api-key

# Home Assistant
HOMEASSISTANT_URL=http://home-assistant.local:8123
HOMEASSISTANT_TOKEN=your-long-lived-access-token

# PostgreSQL (optional)
POSTGRES_CONNECTION_STRING=postgresql://user:pass@localhost/fft_nano
```

### Config File

`~/.hermes/config.yaml` provides additional configuration:

```yaml
# Model Configuration
model: anthropic/claude-sonnet-4
max_iterations: 60
tool_timeout: 180

# Terminal Configuration
terminal:
  default_shell: /bin/bash
  default_timeout: 180
  production_mode: false

# Toolset Configuration
enabled_toolsets:
  - hermes-core
  - hermes-telegram

disabled_toolsets: []

# Display Configuration
display:
  tool_progress: new  # off, new, all, verbose
  spinner: true

# Compression Configuration
compression:
  enabled: true
  max_context: 100000
  aggressive: false

# Memory Configuration
memory:
  enabled: true
  auto_save: true
  max_entries: 1000
```

## Deployment Patterns

### 1. Single Machine Deployment

**Use Case:** Small farms, development, testing

**Architecture:**
- All components on single server
- Local filesystem for storage
- SQLite or no database

**Pros:**
- Simple setup
- Low cost
- Easy maintenance

**Cons:**
- Single point of failure
- Limited scalability

**Configuration:**

```bash
# .env
PRODUCTION_MODE=false
DATABASE_URL=sqlite:///~/.hermes/fft_nano.db
```

### 2. High Availability Deployment

**Use Case:** Production farms requiring high uptime

**Architecture:**
- Multiple gateway instances
- Shared PostgreSQL database
- Load balancer
- Health monitoring

**Pros:**
- High availability
- Scalable
- Fault tolerant

**Cons:**
- Higher cost
- More complex setup

**Configuration:**

```yaml
# docker-compose.yml
version: '3.8'

services:
  loadbalancer:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - gateway-1
      - gateway-2

  gateway-1:
    build: .
    environment:
      - ROLE=gateway
    depends_on:
      - postgres

  gateway-2:
    build: .
    environment:
      - ROLE=gateway
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: fft_nano
      POSTGRES_USER: fft_nano
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

### 3. Multi-Farm Deployment

**Use Case:** Agricultural companies managing multiple farms

**Architecture:**
- Central management server
- Edge agents at each farm
- Federated authentication
- Centralized logging

**Pros:**
- Centralized management
- Consistent configuration
- Scalable

**Cons:**
- Network dependency
- Higher complexity

**Configuration:**

```bash
# Central Server
CENTRAL_MODE=true
FARM_IDS=farm1,farm2,farm3

# Edge Agent
EDGE_MODE=true
FARM_ID=farm1
CENTRAL_SERVER=https://central.example.com
```

## Monitoring

### Health Checks

```python
class HealthChecker:
    """Health check monitoring."""
    
    async def check_health(self) -> Dict:
        """Check system health."""
        
        checks = {
            "llm_api": await self._check_llm_api(),
            "gateway": await self._check_gateway(),
            "database": await self._check_database(),
            "disk_space": await self._check_disk_space(),
            "memory": await self._check_memory(),
        }
        
        all_healthy = all(check["healthy"] for check in checks.values())
        
        return {
            "healthy": all_healthy,
            "checks": checks,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def _check_llm_api(self) -> Dict:
        """Check LLM API connectivity."""
        try:
            response = await self.llm_client.chat("test")
            return {"healthy": True, "latency_ms": response["latency"]}
        except Exception as e:
            return {"healthy": False, "error": str(e)}
```

### Metrics Collection

```python
class MetricsCollector:
    """Collects system metrics."""
    
    def __init__(self):
        self.metrics = {
            "tool_calls": Counter(),
            "agent_turns": Counter(),
            "errors": Counter(),
            "latency": Histogram(),
        }
    
    def record_tool_call(
        self,
        tool_name: str,
        duration: float,
        success: bool
    ) -> None:
        """Record tool execution metric."""
        
        self.metrics["tool_calls"].increment({"tool": tool_name})
        self.metrics["latency"].observe(duration, {"tool": tool_name})
        
        if not success:
            self.metrics["errors"].increment({"tool": tool_name})
    
    def get_metrics(self) -> Dict:
        """Get current metrics."""
        
        return {
            "tool_calls": self.metrics["tool_calls"].to_dict(),
            "agent_turns": self.metrics["agent_turns"].to_dict(),
            "errors": self.metrics["errors"].to_dict(),
            "latency": self.metrics["latency"].to_dict(),
        }
```

### Alerting

```python
class AlertManager:
    """Manages alerts and notifications."""
    
    def __init__(self):
        self.alert_rules = self._load_alert_rules()
    
    async def check_alerts(self) -> List[Dict]:
        """Check if any alerts should be triggered."""
        
        alerts = []
        metrics = await self.metrics_collector.get_metrics()
        
        for rule in self.alert_rules:
            if self._evaluate_rule(rule, metrics):
                alerts.append({
                    "rule": rule["name"],
                    "severity": rule["severity"],
                    "message": rule["message"].format(**metrics),
                    "timestamp": datetime.utcnow().isoformat()
                })
        
        return alerts
    
    async def send_alert(self, alert: Dict) -> None:
        """Send alert notification."""
        
        # Send to monitoring platform
        await self._send_to_monitoring(alert)
        
        # Send to Telegram/Discord if configured
        if alert["severity"] in ["critical", "high"]:
            await self._send_to_messaging(alert)
```

**Alert Rules Example:**

```yaml
# ~/.hermes/alerts.yaml
- name: high_error_rate
  condition: "errors.total > 100"
  severity: high
  message: "High error rate: {errors.total} errors in last hour"

- name: llm_api_down
  condition: "llm_api.healthy == false"
  severity: critical
  message: "LLM API is unreachable"

- name: disk_space_low
  condition: "disk_space.available_percent < 10"
  severity: warning
  message: "Disk space low: {disk_space.available_percent}% available"
```

## Maintenance

### Backup Strategy

#### 1. Configuration Backup

```bash
#!/bin/bash
# backup_config.sh

BACKUP_DIR="/backups/fft-nano/config"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR/$DATE"

# Backup configuration files
cp ~/.hermes/config.yaml "$BACKUP_DIR/$DATE/"
cp ~/.hermes/.env "$BACKUP_DIR/$DATE/"

# Backup skills
tar -czf "$BACKUP_DIR/$DATE/skills.tar.gz" ~/.hermes/skills/

# Cleanup old backups (keep 30 days)
find "$BACKUP_DIR" -type d -mtime +30 -exec rm -rf {} \;
```

#### 2. Data Backup

```bash
#!/bin/bash
# backup_data.sh

BACKUP_DIR="/backups/fft-nano/data"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR/$DATE"

# Backup database (PostgreSQL)
pg_dump -h localhost -U fft_nano fft_nano > "$BACKUP_DIR/$DATE/db.sql"

# Backup user data
tar -czf "$BACKUP_DIR/$DATE/user_data.tar.gz" ~/.hermes/data/

# Backup logs
tar -czf "$BACKUP_DIR/$DATE/logs.tar.gz" ~/.hermes/logs/

# Cleanup old backups
find "$BACKUP_DIR" -type d -mtime +7 -exec rm -rf {} \;
```

#### 3. Automated Backup

```cron
# crontab -e
# Backup config daily at 2 AM
0 2 * * * /scripts/backup_config.sh

# Backup data every 6 hours
0 */6 * * * /scripts/backup_data.sh
```

### Log Management

```bash
#!/bin/bash
# rotate_logs.sh

LOG_DIR="/var/log/fft-nano"
MAX_SIZE="100M"
MAX_AGE="30d"

# Rotate logs
find "$LOG_DIR" -name "*.log" -size "+$MAX_SIZE" -exec gzip {} \;

# Delete old logs
find "$LOG_DIR" -name "*.log.gz" -mtime +30 -delete

# Cleanup audit logs
find "$LOG_DIR" -name "audit.log" -size "+$MAX_SIZE" -exec mv {} {}.old \;
```

### Updates and Upgrades

#### 1. Update Dependencies

```bash
# Update Python dependencies
pip install --upgrade -r requirements.txt

# Update system packages
sudo apt update && sudo apt upgrade -y
```

#### 2. Version Updates

```bash
# Pull latest code
git pull origin main

# Update dependencies
pip install -r requirements.txt

# Run migrations (if any)
python -m hermes_cli migrate

# Restart service
sudo systemctl restart fft-nano
```

#### 3. Testing After Update

```bash
# Run health checks
hermes doctor

# Test LLM connectivity
hermes chat -q "test message"

# Check platform connections
hermes gateway status
```

## Troubleshooting

### Common Issues

#### 1. LLM API Connection Failed

**Symptoms:**
- Error: "Failed to connect to LLM API"
- No response from agent

**Solutions:**
```bash
# Check API key
echo $OPENAI_API_KEY

# Test connection
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models

# Check network connectivity
ping api.openai.com
```

#### 2. Gateway Not Responding

**Symptoms:**
- No response on Telegram/Discord
- Gateway process stopped

**Solutions:**
```bash
# Check gateway status
hermes gateway status

# View gateway logs
tail -f ~/.hermes/logs/gateway.log

# Restart gateway
hermes gateway restart
```

#### 3. Tool Execution Timeout

**Symptoms:**
- Tool execution takes too long
- Timeout errors

**Solutions:**
```bash
# Increase timeout in config
# ~/.hermes/config.yaml
tool_timeout: 300  # Increase from 180

# Or set per-command timeout
terminal(command="long_running_command", timeout=600)
```

#### 4. Out of Memory

**Symptoms:**
- Process killed with OOM error
- System becomes unresponsive

**Solutions:**
```bash
# Check memory usage
free -h

# Increase swap space
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Reduce model size
# .env
HERMES_MODEL=anthropic/claude-haiku
```

### Debug Mode

Enable debug logging:

```bash
# .env
DEBUG=true
LOG_LEVEL=debug

# Or via command line
hermes gateway --debug
```

View debug logs:

```bash
tail -f ~/.hermes/logs/debug.log
```

## Performance Tuning

### 1. Reduce LLM API Costs

```yaml
# ~/.hermes/config.yaml
compression:
  enabled: true
  aggressive: true  # More aggressive compression
  max_context: 50000  # Reduce context size

model: anthropic/claude-haiku  # Use smaller model
```

### 2. Improve Response Speed

```bash
# Enable streaming
HERMES_STREAM_RESPONSES=true

# Parallel tool execution
PARALLEL_TOOL_EXECUTION=true

# Reduce tool timeouts
HERMES_TOOL_TIMEOUT=60
```

### 3. Optimize for Low-Power Devices

```bash
# Use local LLM (optional)
HERMES_MODEL=local/llama-2-7b
OLLAMA_URL=http://localhost:11434

# Disable non-essential features
DISABLE_SKILLS=true
DISABLE_MEMORY=true
```

---

*Next: [Section 7: Use Cases](07_use_cases.md)*
