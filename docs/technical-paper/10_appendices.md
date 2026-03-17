# Appendices

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Agent Core** | Central orchestrator that manages conversation, tool execution, and LLM interactions |
| **Tool** | A discrete capability exposed to the agent with a defined schema and handler |
| **Toolset** | A collection of tools grouped by purpose (e.g., `hermes-core`, `hermes-telegram`) |
| **Skill** | A self-contained feature module with documentation and optional supporting files |
| **Gateway** | Messaging platform adapter that connects the agent to Telegram, Discord, or WhatsApp |
| **Session** | Per-user conversation state maintained by the gateway |
| **Production Mode** | Safety mode that blocks dangerous commands and requires manual approval |
| **Trajectory** | Complete conversation history including messages, tool calls, and results |
| **Context Compression** | Technique to reduce token usage while preserving information |
| **Prompt Caching** | Caching system prompts to reduce API calls and costs |
| **Approval Gate** | Human-in-the-loop check before executing dangerous operations |
| **DM Pairing** | System for authorizing users via one-time codes instead of static allowlists |
| **Tool Registry** | Central system for managing tool schemas, handlers, and metadata |
| **Turn** | One iteration of the agent loop (LLM call + tool execution) |
| **Parallel Tool Execution** | Executing multiple independent tools concurrently for speed |
| **Streaming Response** | Sending LLM output to user incrementally rather than waiting for completion |

## Appendix B: API Reference

### B.1 Core Agent API

#### AIAgent Class

```python
class AIAgent:
    """Main agent class for conversation management."""
    
    def __init__(
        self,
        model: str = "anthropic/claude-sonnet-4",
        api_key: str = None,
        base_url: str = "https://openrouter.ai/api/v1",
        max_iterations: int = 60,
        enabled_toolsets: List[str] = None,
        disabled_toolsets: List[str] = None,
        verbose_logging: bool = False,
        quiet_mode: bool = False,
        tool_progress_callback: Callable = None
    )
    """
    Initialize agent instance.
    
    Args:
        model: LLM model identifier
        api_key: API key for LLM provider
        base_url: Base URL for LLM API
        max_iterations: Maximum tool-calling turns
        enabled_toolsets: List of toolsets to enable
        disabled_toolsets: List of toolsets to disable
        verbose_logging: Enable verbose logging
        quiet_mode: Suppress progress output
        tool_progress_callback: Callback for tool execution updates
    """
    
    async def chat(
        self,
        user_message: str,
        task_id: str = None
    ) -> str
    """
    Process user message and return agent response.
    
    Args:
        user_message: User's input message
        task_id: Optional task identifier for tracking
    
    Returns:
        Agent's final text response
    """
    
    async def _call_llm(
        self
    ) -> Dict
    """
    Call LLM with current conversation context.
    
    Returns:
        LLM response with text and/or tool calls
    """
    
    async def _execute_tools(
        self,
        tool_calls: List[Dict]
    ) -> List[Dict]
    """
    Execute multiple tools in parallel.
    
    Args:
        tool_calls: List of tool call specifications
    
    Returns:
        List of tool execution results
    """
```

### B.2 Tool Registry API

#### ToolRegistry Class

```python
class ToolRegistry:
    """Central tool registry for schema and handler management."""
    
    def __init__(self)
    """Initialize tool registry and discover all registered tools."""
    
    def get_tool(
        self,
        tool_name: str
    ) -> Tool
    """
    Get tool by name.
    
    Args:
        tool_name: Name of tool to retrieve
    
    Returns:
        Tool instance or None if not found
    """
    
    def list_tools(
        self,
        category: str = None
    ) -> List[str]
    """
    List all registered tools, optionally filtered by category.
    
    Args:
        category: Optional category filter
    
    Returns:
        List of tool names
    """
    
    async def execute(
        self,
        tool_name: str,
        parameters: Dict
    ) -> Any
    """
    Execute a tool with parameters.
    
    Args:
        tool_name: Name of tool to execute
        parameters: Tool parameters
    
    Returns:
        Tool execution result
    """
```

#### Tool Decorator

```python
def register_tool(
    name: str,
    description: str,
    dangerous: bool = False,
    approval_required: bool = False,
    category: str = None
)
"""
Decorator to register a tool with the registry.

Args:
    name: Unique tool name
    description: Tool description for LLM
    dangerous: Whether tool can cause harm
    approval_required: Whether tool requires approval
    category: Tool category for organization

Usage:
    @register_tool(
        name="my_tool",
        description="My custom tool",
        dangerous=False
    )
    class MyTool(Tool):
        async def execute(self, **kwargs):
            # Implementation
            pass
"""
```

### B.3 Gateway API

#### Gateway Class

```python
class Gateway:
    """Messaging gateway for multi-platform support."""
    
    def __init__(
        self,
        config: Dict
    )
    """
    Initialize gateway with configuration.
    
    Args:
        config: Gateway configuration dictionary
    """
    
    async def start(self) -> None
    """Start gateway and all platform adapters."""
    
    async def stop(self) -> None
    """Stop gateway and all platform adapters."""
    
    async def process_message(
        self,
        platform: str,
        user_id: str,
        message: str,
        context: Dict = None
    ) -> str
    """
    Process incoming message from platform.
    
    Args:
        platform: Platform identifier (telegram, discord, whatsapp)
        user_id: User identifier
        message: Message content
        context: Additional context (media, etc.)
    
    Returns:
        Agent response
    """
```

### B.4 Skills API

#### SkillsTool Class

```python
class SkillsTool:
    """Tool for managing skills."""
    
    async def discover_skills(
        self,
        category: str = None
    ) -> List[SkillInfo]
    """
    Discover available skills.
    
    Args:
        category: Optional category filter
    
    Returns:
        List of skill information
    """
    
    async def view_skill(
        self,
        skill_name: str,
        file_path: str = None
    ) -> str
    """
    View skill content.
    
    Args:
        skill_name: Name of skill
        file_path: Optional supporting file path
    
    Returns:
        Skill content
    """
    
    async def install_skill(
        self,
        skill_url: str,
        source: str = "github"
    ) -> None
    """
    Install skill from online repository.
    
    Args:
        skill_url: URL to skill repository
        source: Repository source (github, clawhub)
    """
```

## Appendix C: Configuration Guide

### C.1 Environment Variables

#### Required Variables

```bash
# LLM API Configuration
HERMES_MODEL=anthropic/claude-sonnet-4
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
```

#### Optional Variables

```bash
# Agent Behavior
HERMES_MAX_ITERATIONS=60
HERMES_TOOL_TIMEOUT=180
HERMES_STREAM_RESPONSES=true

# Terminal Configuration
DEFAULT_SHELL=/bin/bash
DEFAULT_TIMEOUT=180
PRODUCTION_MODE=false

# Gateway Configuration
GATEWAY_ALLOW_ALL_USERS=false
MESSAGING_CWD=/home/user

# Platform-Specific
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_USERS=123456789,987654321

DISCORD_BOT_TOKEN=MTIz...
DISCORD_ALLOWED_USERS=123456789012345678

WHATSAPP_BUSINESS_ID=your-business-id
WHATSAPP_PHONE_ID=your-phone-id
WHATSAPP_ACCESS_TOKEN=your-access-token

# Integration-Specific
WEATHER_API_KEY=your-weather-api-key
HOMEASSISTANT_URL=http://home-assistant.local:8123
HOMEASSISTANT_TOKEN=your-long-lived-access-token

POSTGRES_CONNECTION_STRING=postgresql://user:pass@localhost/fft_nano
```

### C.2 Config File

`~/.hermes/config.yaml`

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

# Logging Configuration
logging:
  level: info  # debug, info, warning, error
  file: ~/.hermes/fft_nano.log
  rotation: daily
  retention: 30d

# Skills Configuration
skills:
  auto_discover: true
  auto_update: false
  install_path: ~/.hermes/skills
```

### C.3 Docker Configuration

`docker-compose.yml`

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
      - ./config:/app/config
    ports:
      - "8080:8080"
    restart: unless-stopped
    depends_on:
      - postgres
      - redis

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

  redis:
    image: redis:alpine
    container_name: fft-nano-redis
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  postgres_data:
```

## Appendix D: Troubleshooting Guide

### D.1 Common Issues

#### Issue: LLM API Connection Failed

**Symptoms:**
```
Error: Failed to connect to LLM API
```

**Solutions:**
1. Check API key: `echo $OPENAI_API_KEY`
2. Test connection:
   ```bash
   curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     https://api.openai.com/v1/models
   ```
3. Check network connectivity: `ping api.openai.com`
4. Verify model name in config

#### Issue: Gateway Not Responding

**Symptoms:**
- No response on Telegram/Discord
- Gateway process stopped

**Solutions:**
1. Check gateway status: `hermes gateway status`
2. View gateway logs: `tail -f ~/.hermes/logs/gateway.log`
3. Restart gateway: `hermes gateway restart`
4. Check bot token is correct

#### Issue: Tool Execution Timeout

**Symptoms:**
```
Error: Tool execution timed out after 180s
```

**Solutions:**
1. Increase timeout in config:
   ```yaml
   tool_timeout: 300
   ```
2. Check if command is actually hanging
3. Set per-command timeout:
   ```python
   terminal(command="long_command", timeout=600)
   ```

#### Issue: Out of Memory

**Symptoms:**
```
Killed
```

**Solutions:**
1. Check memory usage: `free -h`
2. Increase swap space:
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```
3. Reduce context size in config
4. Use smaller model: `HERMES_MODEL=anthropic/claude-haiku`

### D.2 Debug Mode

Enable debug logging:

```bash
# .env
DEBUG=true
LOG_LEVEL=debug
```

View debug logs:

```bash
tail -f ~/.hermes/logs/debug.log
```

### D.3 Health Check

Run system diagnostics:

```bash
hermes doctor
```

Output:
```
✓ Python version: 3.10.12
✓ Virtual environment: active
✓ Dependencies: installed
✓ Configuration: valid
✓ LLM API: connected
✓ Gateway: running
✓ Database: connected
✓ Disk space: 45.2 GB free
✓ Memory: 3.2 GB / 4.0 GB
```

## Appendix E: Contributing Guidelines

### E.1 Code Style

Follow these style guidelines:

- **Python**: PEP 8, formatted with Black
- **Type Hints**: Required for all public functions
- **Docstrings**: Google style docstrings
- **Testing**: Unit tests for all new features

Example:

```python
async def execute_tool(
    self,
    tool_name: str,
    parameters: Dict
) -> Any:
    """
    Execute a tool with parameters.
    
    Args:
        tool_name: Name of tool to execute
        parameters: Tool parameters
    
    Returns:
        Tool execution result
    
    Raises:
        ToolNotFoundError: If tool not found
        ValidationError: If parameters invalid
    """
    tool = self.tool_registry.get_tool(tool_name)
    if not tool:
        raise ToolNotFoundError(tool_name)
    
    # ... implementation
```

### E.2 Testing

Write unit tests:

```python
import pytest
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_tool_execution():
    """Test tool execution with valid parameters."""
    registry = ToolRegistry()
    
    result = await registry.execute("terminal", {
        "command": "echo test"
    })
    
    assert "test" in result["output"]
    assert result["exit_code"] == 0
```

Run tests:

```bash
pytest tests/
```

### E.3 Submitting Changes

1. Fork repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m "Add my feature"`
4. Push to fork: `git push origin feature/my-feature`
5. Create pull request

## Appendix F: License and Attribution

### F.1 License

FFT_nano is released under the MIT License:

```
MIT License

Copyright (c) 2024 FFT_nano Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### F.2 Third-Party Licenses

FFT_nano uses the following third-party software:

| Library | License | Purpose |
|---------|---------|---------|
| OpenAI | MIT | LLM API client |
| python-telegram-bot | LGPL-3.0 | Telegram integration |
| discord.py | MIT | Discord integration |
| aiohttp | Apache 2.0 | Async HTTP client |
| Pydantic | MIT | Data validation |
| PostgreSQL | PostgreSQL | Database |

## Appendix G: References

### G.1 Academic Papers

1. Wei, J., et al. (2022). "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." arXiv:2201.11903
2. Brown, T., et al. (2020). "Language Models are Few-Shot Learners." NeurIPS 2020
3. Ouyang, L., et al. (2022). "Training language models to follow instructions with human feedback." NeurIPS 2022

### G.2 Documentation

1. Anthropic Claude API Documentation: https://docs.anthropic.com
2. OpenAI API Documentation: https://platform.openai.com/docs
3. Telegram Bot API: https://core.telegram.org/bots/api
4. Discord API Documentation: https://discord.com/developers/docs

### G.3 Standards

1. JSON Schema: https://json-schema.org/
2. OpenAPI Specification: https://swagger.io/specification/
3. OAuth 2.0: https://oauth.net/2/

---

**Document Version: 1.0.0**  
**Last Updated: March 4, 2026**  
**Document Maintainer:** FFT_nano Development Team

For questions or feedback, please contact: docs@fft-nano.org
