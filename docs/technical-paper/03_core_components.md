# Core Components

![Agent Core Structure](../diagrams/03_agent_core_structure.png)

*Figure 1: Agent Core Internal Structure*

## Overview

This section provides an in-depth analysis of FFT_nano's core subsystems: the **Agent Core**, **Tool Registry**, **Messaging Gateway**, and **Skills System**. Each component is examined with implementation details, design decisions, and code examples.

## 1. Agent Core

The agent core is implemented in the `AIAgent` class (in `run_agent.py`). It serves as the central orchestrator for all AI-powered operations.

### 1.1 Conversation Loop

The core agent follows an iterative loop pattern:

```python
async def _run_agent_loop(
    self,
    user_message: str,
    task_id: str = None
) -> str:
    """Main agent loop with tool calling support."""
    
    # Add user message to conversation
    self._add_message("user", user_message)
    
    # Iterative reasoning and tool execution
    for turn in range(self.max_iterations):
        # 1. Call LLM with tools
        response = await self._call_llm()
        
        # 2. Process response
        if response.tool_calls:
            # 3. Execute tools in parallel
            results = await self._execute_tools(response.tool_calls)
            
            # 4. Add tool results to conversation
            self._add_tool_results(results)
        else:
            # 5. Return final response
            return response.content
    
    raise MaxIterationsExceededError(
        f"Agent exceeded max iterations ({self.max_iterations})"
    )
```

**Key Design Decisions:**

- **Parallel Tool Execution**: Independent tools execute concurrently via `asyncio.gather()`
- **Streaming Support**: Enabled for real-time feedback during long operations
- **Early Termination**: Returns immediately when LLM provides final text response
- **Iteration Limits**: Prevents infinite loops in malformed reasoning

### 1.2 Message Management

Messages are stored in OpenAI format for LLM compatibility:

```python
messages = [
    {
        "role": "system",
        "content": "You are a helpful assistant..."
    },
    {
        "role": "user",
        "content": "What's the weather like?"
    },
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call_123",
                "type": "function",
                "function": {
                    "name": "web_search",
                    "arguments": '{"query": "weather today"}'
                }
            }
        ]
    },
    {
        "role": "tool",
        "tool_call_id": "call_123",
        "content": "Sunny, 75°F"
    }
]
```

**Message Types:**

| Role | Purpose | Example |
|------|---------|---------|
| `system` | Identity, skills, context | Agent instructions |
| `user` | User input or injected messages | Queries, commands |
| `assistant` | LLM responses (text or tool calls) | Reasoning, decisions |
| `tool` | Tool execution results | Data, file contents |

### 1.3 Tool Orchestration

Tool selection and execution involves multiple stages:

#### Stage 1: Tool Discovery
```python
def _build_tool_schemas(self) -> List[Dict]:
    """Build tool schemas for the LLM."""
    schemas = []
    
    for tool_name in self.enabled_tools:
        tool = self.tool_registry.get_tool(tool_name)
        
        schema = {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool.description,
                "parameters": tool.json_schema
            }
        }
        schemas.append(schema)
    
    return schemas
```

#### Stage 2: Parameter Validation
```python
def _validate_tool_call(
    self,
    tool_name: str,
    parameters: Dict
) -> Tuple[bool, Optional[str]]:
    """Validate tool parameters against schema."""
    tool = self.tool_registry.get_tool(tool_name)
    
    try:
        # Validate with Pydantic
        tool.validate_params(parameters)
        return True, None
    except ValidationError as e:
        return False, str(e)
```

#### Stage 3: Execution with Timeout
```python
async def _execute_tool(
    self,
    tool_call: Dict
) -> Dict:
    """Execute a single tool with timeout protection."""
    tool_name = tool_call["function"]["name"]
    parameters = json.loads(tool_call["function"]["arguments"])
    
    try:
        # Execute with timeout
        result = await asyncio.wait_for(
            self.tool_registry.execute(tool_name, parameters),
            timeout=self.tool_timeout
        )
        
        return {
            "role": "tool",
            "tool_call_id": tool_call["id"],
            "content": str(result)
        }
    except asyncio.TimeoutError:
        return {
            "role": "tool",
            "tool_call_id": tool_call["id"],
            "content": f"Tool execution timed out after {self.tool_timeout}s"
        }
```

### 1.4 Context Management

Context files provide persistent knowledge and configuration:

```python
async def _load_context_files(self) -> List[Dict]:
    """Load context files into conversation."""
    context_messages = []
    
    # Load skills context
    if self.config.get("skills_context"):
        skills_content = await self._load_skills_index()
        context_messages.append({
            "role": "system",
            "content": f"Available Skills:\n{skills_content}"
        })
    
    # Load project files
    if self.config.get("project_context"):
        for file_path in self.config["project_context"]:
            content = await read_file(file_path)
            context_messages.append({
                "role": "system",
                "content": f"Context from {file_path}:\n{content}"
            })
    
    return context_messages
```

**Context File Types:**

| File Type | Purpose | Location |
|-----------|---------|----------|
| `SKILLS.md` | Skills index and categories | `skills/SKILLS.md` |
| `AGENTS.md` | Development guide | `AGENTS.md` |
| `SOUL.md` | Agent persona (optional) | `SOUL.md` |
| `.env` | Environment configuration | `.env` |
| Custom | Project-specific context | Configured in config |

### 1.5 Trajectory Logging

Trajectories capture complete conversations for analysis and training:

```python
async def _save_trajectory(
    self,
    task_id: str,
    messages: List[Dict],
    result: str
) -> None:
    """Save conversation trajectory in ShareGPT format."""
    
    if not self.config.get("save_trajectories"):
        return
    
    trajectory = {
        "task_id": task_id,
        "timestamp": datetime.utcnow().isoformat(),
        "model": self.model,
        "toolsets": self.enabled_toolsets,
        "conversation": self._format_for_sharegpt(messages),
        "result": result,
        "iterations": len([
            m for m in messages 
            if m.get("role") == "assistant"
        ])
    }
    
    # Save to file
    output_path = f"trajectories/{task_id}.jsonl"
    await write_file(output_path, json.dumps(trajectory))
```

## 2. Tool Registry

The tool registry (in `tools/registry.py`) provides centralized tool management.

### 2.1 Tool Definition

Tools are defined with a declarative schema:

```python
@register_tool(
    name="terminal",
    description="Execute shell commands",
    dangerous=True,
    approval_required=True
)
class TerminalTool(Tool):
    schema = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command to execute"
            },
            "timeout": {
                "type": "integer",
                "description": "Max execution time in seconds",
                "default": 180
            }
        },
        "required": ["command"]
    }
    
    async def execute(
        self,
        command: str,
        timeout: int = 180
    ) -> str:
        """Execute terminal command."""
        # Implementation...
        pass
```

### 2.2 Registration System

Tools register themselves via decorator pattern:

```python
# In tools/registry.py

_tool_registry: Dict[str, Tool] = {}

def register_tool(**kwargs):
    """Decorator for registering tools."""
    def decorator(tool_class: Type[Tool]):
        # Create instance with metadata
        tool = tool_class(**kwargs)
        
        # Store in registry
        _tool_registry[tool.name] = tool
        
        return tool_class
    
    return decorator

# Usage in tool files
@register_tool(
    name="terminal",
    description="Execute shell commands",
    dangerous=True
)
class TerminalTool(Tool):
    # Tool implementation...
    pass
```

### 2.3 Handler Dispatch

The registry dispatches tool calls to handlers:

```python
async def execute_tool(
    self,
    tool_name: str,
    parameters: Dict
) -> Any:
    """Execute a tool with parameters."""
    
    # 1. Get tool from registry
    tool = self.get_tool(tool_name)
    if not tool:
        raise ToolNotFoundError(tool_name)
    
    # 2. Validate parameters
    validation_errors = tool.validate_params(parameters)
    if validation_errors:
        raise ValidationError(validation_errors)
    
    # 3. Check for dangerous command
    if tool.dangerous:
        await self._check_dangerous_approval(tool, parameters)
    
    # 4. Execute handler
    result = await tool.execute(**parameters)
    
    # 5. Log execution
    self._log_execution(tool_name, parameters, result)
    
    return result
```

### 2.4 Safety Controls

Dangerous commands require explicit approval:

```python
async def _check_dangerous_approval(
    self,
    tool: Tool,
    parameters: Dict
) -> None:
    """Check approval for dangerous commands."""
    
    # Check production mode
    if self.config.get("production_mode"):
        raise ProductionModeError(
            f"Dangerous command not allowed in production: {tool.name}"
        )
    
    # Check session approval
    if tool.approval_required:
        if tool.name not in self.approved_tools:
            approval = await self._request_approval(tool, parameters)
            if not approval:
                raise ApprovalDeniedError(tool.name)
            self.approved_tools.add(tool.name)
```

## 3. Messaging Gateway

The messaging gateway (in `gateway/`) handles multi-platform communication.

### 3.1 Platform Abstraction

Platform adapters implement a common interface:

```python
class PlatformAdapter(ABC):
    """Base class for messaging platforms."""
    
    @abstractmethod
    async def start(self) -> None:
        """Start the platform adapter."""
        pass
    
    @abstractmethod
    async def handle_message(
        self,
        user_id: str,
        message: str,
        context: Dict
    ) -> None:
        """Handle incoming message."""
        pass
    
    @abstractmethod
    async def send_message(
        self,
        user_id: str,
        message: str,
        **kwargs
    ) -> None:
        """Send message to user."""
        pass
    
    @abstractmethod
    def is_authenticated(self, user_id: str) -> bool:
        """Check if user is authenticated."""
        pass
```

### 3.2 Telegram Adapter

Telegram implementation uses polling for reliability:

```python
class TelegramAdapter(PlatformAdapter):
    """Telegram platform adapter."""
    
    def __init__(self, bot_token: str, allowed_users: List[str]):
        self.bot = AsyncTelegramBot(token=bot_token)
        self.allowed_users = set(allowed_users)
    
    async def start(self) -> None:
        """Start Telegram polling."""
        await self.bot.start_polling()
    
    async def handle_message(
        self,
        user_id: str,
        message: str,
        context: Dict
    ) -> None:
        """Handle incoming Telegram message."""
        
        # Check authentication
        if not self.is_authenticated(user_id):
            await self.send_message(
                user_id,
                "❌ Not authorized. Contact admin."
            )
            return
        
        # Process via gateway
        await self.gateway.process_message(
            platform="telegram",
            user_id=user_id,
            message=message,
            context=context
        )
    
    async def send_message(
        self,
        user_id: str,
        message: str,
        **kwargs
    ) -> None:
        """Send message to Telegram user."""
        await self.bot.send_message(
            chat_id=user_id,
            text=message,
            parse_mode="MarkdownV2"
        )
    
    def is_authenticated(self, user_id: str) bool:
        """Check if user is allowed."""
        return user_id in self.allowed_users
```

### 3.3 Session Management

Sessions maintain per-user state:

```python
class SessionManager:
    """Manages user sessions across platforms."""
    
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
    
    def get_or_create_session(
        self,
        user_id: str,
        platform: str
    ) -> Session:
        """Get or create user session."""
        key = f"{platform}:{user_id}"
        
        if key not in self.sessions:
            self.sessions[key] = Session(
                user_id=user_id,
                platform=platform,
                toolsets=self._get_default_toolsets(platform),
                created_at=datetime.utcnow()
            )
        
        return self.sessions[key]
    
    def _get_default_toolsets(self, platform: str) -> List[str]:
        """Get default toolsets for platform."""
        toolset_map = {
            "telegram": ["hermes-telegram"],
            "discord": ["hermes-discord"],
            "whatsapp": ["hermes-whatsapp"]
        }
        return toolset_map.get(platform, [])
```

### 3.4 Event Hooks

Event hooks enable customization at lifecycle points:

```python
class HookManager:
    """Manages event hooks for gateway."""
    
    async def fire_hook(
        self,
        event_type: str,
        context: Dict
    ) -> None:
        """Fire all handlers for an event type."""
        
        for hook in self._get_hooks_for_event(event_type):
            try:
                await hook.handle(event_type, context)
            except Exception as e:
                logger.error(f"Hook error: {e}")
    
    async def _get_hooks_for_event(
        self,
        event_type: str
    ) -> List[Hook]:
        """Load hooks from filesystem."""
        hooks_dir = Path("~/.hermes/hooks").expanduser()
        hooks = []
        
        for hook_path in hooks_dir.glob("*/handler.py"):
            hook_module = self._load_hook_module(hook_path)
            if hasattr(hook_module, "handle"):
                hooks.append(hook_module.handle)
        
        return hooks
```

## 4. Skills System

The skills system (in `tools/skills_tool.py`) manages feature modules.

### 4.1 Skill Structure

Skills are self-contained with a specific file structure:

```
~/.hermes/skills/my-skill/
├── SKILL.md              # Main skill file (required)
├── references/           # Reference documentation (optional)
│   └── api.md
├── templates/            # Template files (optional)
│   └── config.yaml
└── scripts/              # Utility scripts (optional)
    └── setup.sh
```

**SKILL.md Format:**

```markdown
---
name: my-skill
description: A useful skill for doing things
version: 1.0.0
metadata:
  hermes:
    tags: [automation, utility]
    related_skills: [other-skill]
---

# My Skill

Detailed documentation of what the skill does...

## Usage

How to use the skill...

## Examples

Example interactions...
```

### 4.2 Skill Discovery

Skills are discovered via filesystem scan:

```python
async def discover_skills(
    self,
    category: str = None
) -> List[SkillInfo]:
    """Discover available skills."""
    
    skills_dir = Path("~/.hermes/skills").expanduser()
    skills = []
    
    for skill_path in skills_dir.iterdir():
        skill_file = skill_path / "SKILL.md"
        if not skill_file.exists():
            continue
        
        # Parse skill metadata
        content = await read_file(str(skill_file))
        metadata = self._parse_skill_metadata(content)
        
        # Filter by category if specified
        if category and metadata.get("category") != category:
            continue
        
        skills.append(SkillInfo(
            name=metadata["name"],
            description=metadata["description"],
            version=metadata.get("version", "1.0.0"),
            tags=metadata.get("metadata", {}).get("hermes", {}).get("tags", []),
            path=str(skill_path)
        ))
    
    return skills
```

### 4.3 Skill Invocation

Skills are invoked by loading content and building messages:

```python
async def invoke_skill(
    self,
    skill_name: str,
    instruction: str
) -> str:
    """Invoke a skill with instruction."""
    
    # 1. Load skill content
    skill_path = self._get_skill_path(skill_name)
    skill_content = await read_file(f"{skill_path}/SKILL.md")
    
    # 2. Build invocation message
    message = self._build_invocation_message(
        skill_content,
        instruction
    )
    
    # 3. Send to agent as user message
    result = await self.agent.chat(message)
    
    return result

def _build_invocation_message(
    self,
    skill_content: str,
    instruction: str
) -> str:
    """Build message to invoke skill."""
    
    return f"""
You have been loaded with a skill. Use this skill to complete the task.

## Skill Content
{skill_content}

## User Instruction
{instruction}

Supporting files can be loaded via the skill_view tool if needed.
"""
```

### 4.4 Community Hub

The skills hub connects to online repositories:

```python
class SkillsHub:
    """Connects to online skill repositories."""
    
    async def search_skills(
        self,
        query: str,
        source: str = "github"
    ) -> List[SkillInfo]:
        """Search for skills online."""
        
        if source == "github":
            return await self._search_github(query)
        elif source == "clawhub":
            return await self._search_clawhub(query)
        else:
            raise ValueError(f"Unknown source: {source}")
    
    async def install_skill(
        self,
        skill_url: str,
        source: str = "github"
    ) -> None:
        """Install a skill from online repository."""
        
        # 1. Download skill
        skill_data = await self._download_skill(skill_url, source)
        
        # 2. Scan for security issues
        security_scan = await self._scan_security(skill_data)
        if not security_scan.safe:
            raise SecurityError(security_scan.issues)
        
        # 3. Install to local filesystem
        await self._install_skill_data(skill_data)
        
        # 4. Update lock file
        await self._update_lockfile(skill_url, source)
```

## Component Interaction Patterns

### 1. Request-Response Flow

```
User → Gateway → Agent → Tool Registry → Tool Handler
    ←          ←       ←               ← Result
```

### 2. Tool Execution Flow

```
Agent → Tool Registry → Validation → Handler
       ← Schema         ← Errors     ← Result
```

### 3. Skill Loading Flow

```
User → Skills Tool → Load SKILL.md → Build Message → Agent
```

### 4. Event Hook Flow

```
Event → Hook Manager → Load Hooks → Execute Handlers → Results
```

## Performance Considerations

| Component | Bottleneck | Optimization Strategy |
|-----------|-----------|---------------------|
| **Agent Core** | LLM API latency | Streaming responses, parallel tools |
| **Tool Registry** | I/O for tool loading | Lazy loading, caching |
| **Messaging Gateway** | Platform polling | Webhooks (future), batching |
| **Skills System** | Filesystem access | Skill indexing, in-memory cache |

---

*Next: [Section 4: Integrations](04_integrations.md)*
