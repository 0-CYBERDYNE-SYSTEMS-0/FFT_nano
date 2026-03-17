# Security and Compliance

![Security Architecture](../diagrams/05_security_architecture.png)

*Figure 1: FFT_nano Security Architecture Overview*

## Overview

Security is paramount when deploying autonomous AI agents in production environments. FFT_nano implements a comprehensive security model with defense-in-depth principles, ensuring safe operation while maintaining flexibility and extensibility.

## Security Principles

### 1. Principle of Least Privilege

- Tools operate with minimal required permissions
- File system access restricted to allowed directories
- Database queries follow principle of least privilege
- API tokens scoped to necessary operations

### 2. Defense in Depth

Multiple security layers protect against different attack vectors:

```
┌─────────────────────────────────────────┐
│     Platform Authentication Layer        │
│     (Telegram, Discord, WhatsApp)       │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│     Gateway Authorization Layer         │
│     (User Allowlists, DM Pairing)       │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│     Tool Registry Safety Layer          │
│     (Dangerous Command Detection)       │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│     Production Mode Enforcement          │
│     (Manual Approval Gates)             │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│     Execution Environment Isolation     │
│     (Docker, Singularity, SSH)          │
└─────────────────────────────────────────┘
```

### 3. Audit Trail

All actions logged with:
- User identification
- Timestamp
- Tool called
- Parameters (sanitized)
- Results (truncated if large)
- Success/failure status

### 4. Human-in-the-Loop

Critical operations require explicit approval:
- Configurable per-tool approval requirements
- Session-based approval tracking
- Reversible operation patterns
- Clear user prompts with action descriptions

## Authentication

### Platform Authentication

Each messaging platform requires user authentication:

#### Telegram

```python
class TelegramAuthenticator:
    """Telegram authentication and authorization."""
    
    def __init__(self):
        # Load allowed users from environment
        self.allowed_users = self._load_allowed_users()
        self.pairing_codes = self._load_pairing_data()
    
    def _load_allowed_users(self) -> Set[str]:
        """Load allowed user IDs from environment."""
        env_var = os.getenv("TELEGRAM_ALLOWED_USERS")
        if not env_var:
            return set()
        
        return set(user_id.strip() for user_id in env_var.split(","))
    
    def is_authorized(self, user_id: str) -> bool:
        """Check if user is authorized."""
        # Check allowlist
        if self.allowed_users and user_id in self.allowed_users:
            return True
        
        # Check pairing codes
        if self.is_paired(user_id):
            return True
        
        # Check if all users allowed
        if os.getenv("GATEWAY_ALLOW_ALL_USERS") == "true":
            return True
        
        return False
    
    def is_paired(self, user_id: str) -> bool:
        """Check if user is paired via DM pairing."""
        for code, data in self.pairing_codes.items():
            if data["user_id"] == user_id and data["approved"]:
                return True
        return False
```

**Configuration:**

```bash
# .env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_USERS=123456789,987654321
GATEWAY_ALLOW_ALL_USERS=false
```

#### Discord

```python
class DiscordAuthenticator:
    """Discord authentication and authorization."""
    
    def __init__(self):
        self.allowed_users = self._load_allowed_users()
    
    def is_authorized(self, user_id: str) -> bool:
        """Check if user is authorized."""
        if self.allowed_users and user_id in self.allowed_users:
            return True
        
        return os.getenv("GATEWAY_ALLOW_ALL_USERS") == "true"
```

**Configuration:**

```bash
# .env
DISCORD_BOT_TOKEN=MTIz...
DISCORD_ALLOWED_USERS=123456789012345678
```

#### WhatsApp

```python
class WhatsAppAuthenticator:
    """WhatsApp authentication and authorization."""
    
    def __init__(self):
        self.allowed_users = self._load_allowed_users()
    
    def is_authorized(self, user_id: str) -> bool:
        """Check if user is authorized."""
        if self.allowed_users and user_id in self.allowed_users:
            return True
        
        return os.getenv("GATEWAY_ALLOW_ALL_USERS") == "true"
```

### DM Pairing System

Users can pair via one-time codes instead of static allowlists:

```python
class PairingManager:
    """DM pairing code management."""
    
    def __init__(self):
        self.data_path = Path("~/.hermes/pairing/data.json").expanduser()
        self.data = self._load_pairing_data()
    
    def generate_pairing_code(
        self,
        platform: str,
        user_id: str
    ) -> str:
        """Generate one-time pairing code."""
        
        # Check rate limiting (1 code per 10 minutes per user)
        if self._rate_limit_exceeded(user_id):
            raise RateLimitExceededError()
        
        # Generate random 8-character code
        code = secrets.token_urlsafe(8)[:8]
        
        # Store with expiry (1 hour)
        self.data[code] = {
            "platform": platform,
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": (datetime.utcnow() + timedelta(hours=1)).isoformat(),
            "approved": False
        }
        
        self._save_pairing_data()
        return code
    
    def approve_pairing(
        self,
        platform: str,
        code: str
    ) -> bool:
        """Approve a pairing request."""
        
        if code not in self.data:
            return False
        
        pairing = self.data[code]
        
        # Check expiry
        if datetime.utcnow() > datetime.fromisoformat(pairing["expires_at"]):
            del self.data[code]
            self._save_pairing_data()
            return False
        
        # Verify platform
        if pairing["platform"] != platform:
            return False
        
        # Approve
        pairing["approved"] = True
        self._save_pairing_data()
        return True
    
    def is_paired(self, user_id: str) -> bool:
        """Check if user is paired."""
        for code, data in self.data.items():
            if data["user_id"] == user_id and data["approved"]:
                # Check expiry
                if datetime.utcnow() <= datetime.fromisoformat(data["expires_at"]):
                    return True
        return False
```

**Security Features:**
- 8-character random codes (36^8 ≈ 2.8 trillion combinations)
- 1-hour expiry
- Rate limiting (1 code per 10 minutes per user)
- Maximum 3 pending codes per platform
- Lockout after 5 failed attempts
- Secure file permissions (chmod 0600)

## Authorization

### Tool-Based Authorization

Tools declare their safety level:

```python
@register_tool(
    name="terminal",
    description="Execute shell commands",
    dangerous=True,  # Requires approval
    approval_required=True
)
class TerminalTool:
    # ... implementation
```

### Session-Based Authorization

```python
class SessionAuthorizer:
    """Session-based authorization tracking."""
    
    def __init__(self, config: Dict):
        self.config = config
        self.approved_tools: Set[str] = set()
        self.production_mode = config.get("production_mode", False)
    
    async def check_tool_authorization(
        self,
        tool_name: str,
        parameters: Dict
    ) -> bool:
        """Check if tool execution is authorized."""
        
        tool = self.tool_registry.get_tool(tool_name)
        
        # Production mode enforcement
        if self.production_mode and tool.dangerous:
            raise ProductionModeError(
                f"Dangerous command not allowed in production: {tool_name}"
            )
        
        # Check approval requirement
        if tool.approval_required and tool_name not in self.approved_tools:
            approval = await self._request_approval(tool, parameters)
            if approval:
                self.approved_tools.add(tool_name)
            else:
                raise ApprovalDeniedError(tool_name)
        
        return True
    
    async def _request_approval(
        self,
        tool: Tool,
        parameters: Dict
    ) -> bool:
        """Request user approval for tool execution."""
        
        # Build approval message
        message = self._build_approval_message(tool, parameters)
        
        # Send to user via appropriate channel
        await self._send_to_user(message)
        
        # Wait for response (with timeout)
        response = await self._wait_for_approval(timeout=60)
        
        return response == "yes"
```

## Production Mode

Production mode adds additional safety controls:

```python
class ProductionModeEnforcer:
    """Production mode safety enforcement."""
    
    def __init__(self):
        self.production_mode = os.getenv("PRODUCTION_MODE") == "true"
    
    async def before_tool_execution(
        self,
        tool_name: str,
        parameters: Dict
    ) -> bool:
        """Check before tool execution."""
        
        if not self.production_mode:
            return True
        
        tool = self.tool_registry.get_tool(tool_name)
        
        # Block dangerous commands
        if tool.dangerous:
            raise ProductionModeError(
                f"Dangerous command blocked in production mode: {tool_name}"
            )
        
        # Validate critical parameters
        self._validate_critical_parameters(tool, parameters)
        
        # Log for audit
        self._log_execution(tool_name, parameters)
        
        return True
    
    def _validate_critical_parameters(
        self,
        tool: Tool,
        parameters: Dict
    ) -> None:
        """Validate critical parameters."""
        
        # Prevent deletion of system files
        if tool_name == "terminal":
            command = parameters.get("command", "")
            if self._contains_dangerous_pattern(command):
                raise ProductionModeError("Dangerous command pattern detected")
        
        # Prevent writing to sensitive paths
        if tool_name == "write_file":
            path = parameters.get("path", "")
            if self._is_sensitive_path(path):
                raise ProductionModeError("Writing to sensitive path blocked")
```

**Configuration:**

```bash
# .env
PRODUCTION_MODE=false  # Set to true for production
```

## Dangerous Command Detection

Automatic detection of dangerous commands:

```python
class DangerousCommandDetector:
    """Detects dangerous command patterns."""
    
    DANGEROUS_PATTERNS = [
        r"rm\s+-rf\s+[^\s]*",  # rm -rf
        r":\(\)\{\s*:\|:&\s*\}\;:",  # Fork bomb
        r"dd\s+if=/dev/zero",  # Disk destruction
        r"chmod\s+777",  # Excessive permissions
        r"mkfs\.",  # Filesystem creation
        r">\s*/dev/sd[a-z]",  # Writing to disk devices
        r"wget\s+.*\|.*sh",  # Pipe to shell
        r"curl\s+.*\|.*sh",  # Pipe to shell
    ]
    
    def is_dangerous(self, command: str) -> Tuple[bool, str]:
        """Check if command is dangerous."""
        
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern, command):
                return True, f"Dangerous pattern detected: {pattern}"
        
        return False, None
```

## Input Validation

### Parameter Validation

All tool parameters validated against JSON Schema:

```python
class ParameterValidator:
    """Validates tool parameters."""
    
    async def validate(
        self,
        tool_name: str,
        parameters: Dict
    ) -> Tuple[bool, Optional[str]]:
        """Validate parameters against schema."""
        
        tool = self.tool_registry.get_tool(tool_name)
        schema = tool.json_schema
        
        try:
            # Use Pydantic for validation
            validated = validate_json(parameters, schema)
            return True, None
        except ValidationError as e:
            return False, str(e)
```

### Path Traversal Prevention

```python
class PathValidator:
    """Validates file paths to prevent traversal."""
    
    ALLOWED_PATHS = [
        "/home/user",
        "/var/data",
        "/tmp"
    ]
    
    def is_safe_path(self, path: str) -> bool:
        """Check if path is safe (no traversal)."""
        
        # Resolve path
        resolved = Path(path).expanduser().resolve()
        
        # Check if within allowed paths
        for allowed in self.ALLOWED_PATHS:
            allowed_path = Path(allowed).resolve()
            try:
                resolved.relative_to(allowed_path)
                return True
            except ValueError:
                pass
        
        return False
```

## Audit Logging

Comprehensive logging of all actions:

```python
class AuditLogger:
    """Logs all actions for compliance and debugging."""
    
    def __init__(self):
        self.log_file = Path("~/.hermes/audit.log").expanduser()
        self.log_file.parent.mkdir(parents=True, exist_ok=True)
    
    def log_tool_execution(
        self,
        user_id: str,
        tool_name: str,
        parameters: Dict,
        result: Any,
        success: bool,
        duration: float
    ) -> None:
        """Log tool execution."""
        
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "tool": tool_name,
            "parameters": self._sanitize_parameters(parameters),
            "success": success,
            "duration": duration,
            "result_size": len(str(result)) if result else 0
        }
        
        # Write to log file
        with open(self.log_file, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
    
    def _sanitize_parameters(self, params: Dict) -> Dict:
        """Sanitize parameters for logging (remove secrets)."""
        
        sanitized = {}
        sensitive_keys = ["password", "token", "api_key", "secret"]
        
        for key, value in params.items():
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                sanitized[key] = "***REDACTED***"
            else:
                sanitized[key] = value
        
        return sanitized
```

## Secure Communication

### TLS/SSL

All external communication uses TLS:

```python
class SecureHTTPClient:
    """HTTP client with TLS verification."""
    
    def __init__(self):
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(
                ssl=True,
                verify_ssl=True
            ),
            timeout=aiohttp.ClientTimeout(total=30)
        )
    
    async def get(self, url: str) -> Dict:
        """Make secure GET request."""
        async with self.session.get(url) as response:
            return await response.json()
```

### API Key Management

```python
class APIKeyManager:
    """Manages API keys securely."""
    
    def __init__(self):
        self.keys = self._load_keys()
    
    def _load_keys(self) -> Dict[str, str]:
        """Load API keys from environment."""
        
        return {
            "telegram": os.getenv("TELEGRAM_BOT_TOKEN"),
            "discord": os.getenv("DISCORD_BOT_TOKEN"),
            "openai": os.getenv("OPENAI_API_KEY"),
            "weather": os.getenv("WEATHER_API_KEY"),
            # ... other keys
        }
    
    def get_key(self, service: str) -> str:
        """Get API key for service."""
        
        key = self.keys.get(service)
        if not key:
            raise KeyError(f"API key not found for service: {service}")
        
        return key
```

## Compliance Features

### GDPR Compliance

```python
class GDPRCompliance:
    """GDPR compliance features."""
    
    async def export_user_data(self, user_id: str) -> Dict:
        """Export all user data for GDPR requests."""
        
        data = {
            "user_id": user_id,
            "messages": await self._export_messages(user_id),
            "audit_logs": await self._export_audit_logs(user_id),
            "preferences": await self._export_preferences(user_id)
        }
        
        return data
    
    async def delete_user_data(self, user_id: str) -> bool:
        """Delete all user data for GDPR requests."""
        
        await self._delete_messages(user_id)
        await self._delete_audit_logs(user_id)
        await self._delete_preferences(user_id)
        
        return True
```

### SOC 2 Considerations

```python
class SOC2Controls:
    """SOC 2 compliance controls."""
    
    def log_access(self, user_id: str, action: str) -> None:
        """Log access for SOC 2."""
        
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "action": action,
            "ip_address": self._get_client_ip()
        }
        
        # Write to access log
        self._write_access_log(log_entry)
    
    def enforce_role_based_access(self, user_id: str, action: str) -> bool:
        """Enforce role-based access control."""
        
        user_role = self._get_user_role(user_id)
        required_role = self._get_required_role(action)
        
        return self._check_role_hierarchy(user_role, required_role)
```

## Security Checklist

### Deployment Checklist

- [ ] Set strong bot passwords/tokens
- [ ] Configure user allowlists
- [ ] Enable production mode in production
- [ ] Set up TLS/SSL for all external connections
- [ ] Configure audit logging
- [ ] Set up log rotation
- [ ] Implement rate limiting
- [ ] Configure backup strategy
- [ ] Test disaster recovery procedures
- [ ] Regularly update dependencies

### Operational Checklist

- [ ] Review audit logs regularly
- [ ] Monitor for suspicious activity
- [ ] Rotate API keys periodically
- [ ] Update security patches promptly
- [ ] Conduct security audits
- [ ] Test backup restoration
- [ ] Train operators on security procedures

---

*Next: [Section 6: Implementation](06_implementation.md)*
