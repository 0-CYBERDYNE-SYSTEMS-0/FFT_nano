# System Architecture

![Architecture Overview](../diagrams/01_architecture_overview.png)

*Figure 1: FFT_nano High-Level Architecture Overview*

## Overview

FFT_nano implements a **layered architecture** designed for modularity, extensibility, and production reliability. The system is organized into four primary layers:

1. **Presentation Layer** - User interfaces and communication channels
2. **Agent Layer** - Core intelligence and orchestration
3. **Integration Layer** - Tool registry and external service connections
4. **Infrastructure Layer** - Storage, messaging, and execution environments

This architectural design enables clear separation of concerns while maintaining tight integration between components for seamless operation.

## Architectural Principles

### 1. Tool-Based Abstraction

Every external service integration is exposed as a **tool** with:
- JSON Schema definition for parameters
- Async handler implementation
- Security metadata (dangerous flag, approval requirements)
- Documentation and usage examples

This abstraction enables:
- **Discovery**: LLM can dynamically discover available capabilities
- **Validation**: Automatic parameter validation before execution
- **Safety**: Dangerous operations require explicit approval
- **Extensibility**: New integrations added without modifying core agent

### 2. Platform-Agnostic Gateway

The messaging gateway platform is decoupled from business logic:
- **Telegram**, **WhatsApp**, and **Discord** adapters implement common interface
- Platform-specific optimizations (emoji rendering, markdown formatting)
- Unified authentication and authorization
- Message transformation and routing

This design enables:
- **Multi-platform support**: Users can interact via preferred channel
- **Consistency**: Same experience across all platforms
- **Scalability**: Add new platforms without redesign
- **Testing**: Testable core logic independent of platform details

### 3. Stateless Agent with Persistent Storage

The agent core is stateless between turns:
- **No in-memory conversation state** across requests
- **Context files** provide persistent state (skills, user preferences, trajectories)
- **File system** for long-term storage (logs, caches, outputs)
- **Environment variables** for configuration

This design enables:
- **Horizontal scaling**: Multiple agent instances can run concurrently
- **Fault tolerance**: Restart without conversation loss
- **Auditability**: Complete history preserved in storage
- **Distributability**: Deploy across multiple machines

### 4. Plugin-Based Skills System

Skills are self-contained feature modules:
- **SKILL.md** file with metadata, documentation, and instructions
- **Supporting files** (templates, scripts, references)
- **Dynamic loading** at runtime without restart
- **Community marketplace** for sharing

This architecture enables:
- **Feature discovery**: Agent can browse and load new skills
- **Decoupling**: Skills don't require core changes
- **Collaboration**: Community can contribute skills
- **Versioning**: Skills have independent lifecycle

## Core Architectural Components

### Agent Core

The agent core (implemented in `AIAgent` class) manages:

1. **Conversation State**
   - Message history in OpenAI format
   - Tool call tracking and results
   - Reasoning context for supported models
   - Trajectory logging for training

2. **Tool Orchestration**
   - Tool schema compilation from registry
   - Dynamic tool selection based on toolsets
   - Parallel execution of independent tools
   - Result aggregation and formatting

3. **Iteration Management**
   - Max turn limits to prevent infinite loops
   - Early termination on completion
   - Timeout protection per tool call
   - Error handling and recovery

4. **Memory Integration**
   - Long-term memory across sessions
   - Context file loading and caching
   - Session search for relevant past interactions
   - Knowledge base for domain-specific information

### Tool Registry

The tool registry (in `tools/registry.py`) provides:

1. **Schema Management**
   - Central storage of all tool schemas
   - Automatic compilation to OpenAI format
   - Parameter validation and type checking
   - Documentation generation

2. **Handler Dispatch**
   - Mapping tool names to handler functions
   - Async execution with timeout protection
   - Error handling and result formatting
   - Progress callbacks for UI updates

3. **Safety Controls**
   - Dangerous command detection
   - Per-session approval tracking
   - Production mode enforcement
   - Audit logging

### Messaging Gateway

The messaging gateway (in `gateway/`) handles:

1. **Platform Adapters**
   - **Telegram**: Poll-based message handling, markdown support, sticker/voice recognition
   - **WhatsApp**: Real-time message handling, media support
   - **Discord**: Slash commands, reaction handling, rich embeds

2. **Session Management**
   - Per-user conversation state
   - Toolset configuration per platform
   - Authentication and authorization
   - Rate limiting and abuse prevention

3. **Message Processing**
   - Platform-specific parsing
   - Markdown and HTML sanitization
   - Media file handling (images, voice)
   - Format transformation for agent compatibility

4. **Event Hooks**
   - Startup/shutdown events
   - Session lifecycle events
   - Tool execution events
   - Command execution events

### Skills System

The skills system (in `tools/skills_tool.py`) enables:

1. **Skill Loading**
   - Dynamic import from `~/.hermes/skills/`
   - YAML frontmatter parsing
   - Content indexing for search
   - Version tracking

2. **Skill Discovery**
   - Category-based browsing
   - Tag-based filtering
   - Keyword search across skill content
   - Related skill recommendations

3. **Skill Execution**
   - Building invocation messages with skill content
   - Loading supporting files on demand
   - Context injection for agent understanding
   - Result formatting

4. **Community Hub**
   - GitHub repository integration
   - ClawHub marketplace support
   - Claude marketplace compatibility
   - LobeHub skill discovery

## Data Flow Architecture

### Request Flow

```
User Message → Platform Adapter → Gateway → Agent Core
  → Tool Selection → Tool Registry → Tool Handler
  → External System → Result → Tool Registry
  → Agent Core → Response Formatting → Gateway
  → Platform Adapter → User Message
```

### Key Flow Characteristics:

1. **Asynchronous Processing**: All I/O operations are async to enable concurrent handling
2. **Stateless Core**: Agent core doesn't maintain state between turns
3. **Tool Isolation**: Each tool handler is isolated with error handling
4. **Bidirectional Gateway**: Can both receive requests and send notifications
5. **Audit Trail**: Every operation logged for compliance and debugging

### Tool Execution Flow

1. **Discovery**: Agent receives tool schemas from registry
2. **Selection**: LLM chooses appropriate tools for task
3. **Validation**: Parameters validated against schema
4. **Approval**: Dangerous commands require user approval
5. **Execution**: Tool handler called async with timeout
6. **Result**: Formatted result returned to agent
7. **Retry**: Agent can retry with modified parameters
8. **Completion**: Final response generated from results

## Component Interaction Diagram

![Component Interactions](../diagrams/02_component_interactions.png)

*Figure 2: Core Component Interactions*

### Component Responsibilities

| Component | Primary Responsibility | Key Technologies |
|-----------|---------------------|------------------|
| **AIAgent** | Conversation orchestration | OpenAI API, Python asyncio |
| **Tool Registry** | Schema management, handler dispatch | JSON Schema, async/await |
| **Messaging Gateway** | Multi-platform communication | Telegram Bot API, Discord API |
| **Skills System** | Feature module loading | YAML parsing, dynamic import |
| **Environment Backends** | Command execution environments | Docker, SSH, Singularity |
| **Process Manager** | Background process tracking | PostgreSQL, async task queue |
| **Cron Scheduler** | Scheduled task execution | AP scheduler, cron expressions |
| **Memory System** | Long-term knowledge storage | Vector database, FTS5 |

## Deployment Architecture

### Single-Machine Deployment

For small-scale deployments:

```
┌─────────────────────────────────────┐
│         Single Server              │
│  ┌───────────────────────────────┐ │
│  │  Messaging Gateway (Gateway)  │ │
│  └───────────────┬───────────────┘ │
│                  │                 │
│  ┌───────────────▼───────────────┐ │
│  │  Agent Core (run_agent.py)    │ │
│  └───────────────┬───────────────┘ │
│                  │                 │
│  ┌───────────────▼───────────────┐ │
│  │  Tool Registry + Handlers    │ │
│  └───────────────┬───────────────┘ │
│                  │                 │
│  ┌───────────────▼───────────────┐ │
│  │  External Integrations        │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
         │         │         │
    Telegram   Discord   WhatsApp
```

### Distributed Deployment

For high-availability or high-scale deployments:

```
                     Load Balancer
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   Gateway Node 1    Gateway Node 2    Gateway Node 3
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
               Message Queue (Redis/RabbitMQ)
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   Agent Instance 1  Agent Instance 2  Agent Instance 3
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                  Shared Storage
           (PostgreSQL + File System)
```

### Scaling Considerations

| Factor | Horizontal Scale | Vertical Scale |
|--------|------------------|----------------|
| **Gateway** | Yes (stateless) | Limited (I/O bound) |
| **Agent Core** | Yes (stateless) | Limited (CPU/GPU bound) |
| **Tool Registry** | No (shared state) | Yes (memory bound) |
| **External APIs** | N/A (external) | N/A |
| **Storage** | No (shared state) | Yes (disk bound) |

## Technology Stack

### Core Technologies

- **Language**: Python 3.10+
- **LLM API**: OpenRouter (supports Anthropic, OpenAI, Google, Meta)
- **Async Framework**: Python asyncio
- **Data Validation**: Pydantic
- **Configuration**: YAML
- **Database**: PostgreSQL (optional for distributed deployments)

### Messaging Platforms

- **Telegram**: `python-telegram-bot` v20+
- **Discord**: `discord.py` v2.0+
- **WhatsApp**: `yowsup` or official Business API

### Storage and Persistence

- **File System**: Local filesystem for skills, logs, caches
- **Database**: PostgreSQL (optional, for distributed deployments)
- **Vector DB**: Optional (for RAG capabilities)
- **Cron Scheduler**: AP scheduler

### Development Tools

- **Testing**: pytest, pytest-asyncio
- **Type Checking**: mypy
- **Linting**: black, ruff
- **Documentation**: Markdown, Excalidraw

---

*Next: [Section 3: Core Components](03_core_components.md)*
