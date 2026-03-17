# Integrations

![Integrations Architecture](../diagrams/04_integrations_architecture.png)

*Figure 1: External System Integrations Overview*

## Overview

FFT_nano's power comes from its ability to integrate with diverse external systems through a unified tool interface. This section details the supported integrations, implementation patterns, and best practices for adding new integrations.

## Integration Categories

### 1. Terminal and Command Execution

**Tool:** `terminal`

The terminal tool provides shell command execution with safety controls:

```python
@register_tool(
    name="terminal",
    description="Execute shell commands on the system",
    dangerous=True,
    approval_required=True
)
class TerminalTool:
    schema = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Shell command to execute"
            },
            "timeout": {
                "type": "integer",
                "default": 180,
                "description": "Max execution time in seconds"
            },
            "workdir": {
                "type": "string",
                "description": "Working directory for execution"
            },
            "pty": {
                "type": "boolean",
                "default": False,
                "description": "Use pseudo-terminal for interactive tools"
            }
        },
        "required": ["command"]
    }
    
    async def execute(
        self,
        command: str,
        timeout: int = 180,
        workdir: str = None,
        pty: bool = False
    ) -> Dict:
        """Execute terminal command."""
        
        # Setup environment
        env = os.environ.copy()
        
        # Execute via appropriate backend
        if self.config.get("docker_mode"):
            result = await self._execute_in_docker(
                command, timeout, workdir
            )
        else:
            result = await self._execute_local(
                command, timeout, workdir, pty
            )
        
        return {
            "output": result["output"],
            "exit_code": result["exit_code"],
            "duration": result["duration"]
        }
```

**Use Cases:**
- System administration tasks
- Running custom scripts
- Managing services and processes
- File system operations

**Safety Features:**
- Command timeout protection
- Dangerous command detection
- Per-session approval tracking
- Production mode enforcement
- Audit logging of all commands

### 2. File System Operations

**Tools:** `read_file`, `write_file`, `search_files`, `patch`

File operations provide controlled access to the filesystem:

```python
@register_tool(
    name="write_file",
    description="Write content to a file (creates parent directories)",
    dangerous=True,
    approval_required=True
)
class WriteFileTool:
    schema = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path to write"
            },
            "content": {
                "type": "string",
                "description": "Content to write to file"
            }
        },
        "required": ["path", "content"]
    }
    
    async def execute(
        self,
        path: str,
        content: str
    ) -> Dict:
        """Write content to file."""
        
        # Resolve path
        full_path = Path(path).expanduser().resolve()
        
        # Security check: prevent writing outside allowed dirs
        if not self._is_allowed_path(full_path):
            raise SecurityError(f"Path not allowed: {path}")
        
        # Create parent directories
        full_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write content atomically
        temp_path = full_path.with_suffix(".tmp")
        await self._async_write(temp_path, content)
        await self._async_rename(temp_path, full_path)
        
        return {
            "path": str(full_path),
            "bytes_written": len(content)
        }
```

**Use Cases:**
- Reading configuration files
- Writing scripts and code
- Searching for patterns
- Patching existing files

**Security Considerations:**
- Path traversal protection
- Allowed directory restrictions
- Atomic writes to prevent corruption
- Size limits on file operations

### 3. Web Services

**Tools:** `web_search`, `web_extract`, `send_message`

Web tools enable HTTP requests and web scraping:

```python
@register_tool(
    name="web_search",
    description="Search the web for information"
)
class WebSearchTool:
    schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query"
            },
            "limit": {
                "type": "integer",
                "default": 5,
                "description": "Number of results to return"
            }
        },
        "required": ["query"]
    }
    
    async def execute(
        self,
        query: str,
        limit: int = 5
    ) -> Dict:
        """Perform web search."""
        
        # Call search API (e.g., DuckDuckGo, Google)
        results = await self._search_api.search(query, limit=limit)
        
        return {
            "data": {
                "web": [
                    {
                        "url": r["url"],
                        "title": r["title"],
                        "description": r["description"]
                    }
                    for r in results
                ]
            }
        }

@register_tool(
    name="web_extract",
    description="Extract content from web pages (PDF supported)"
)
class WebExtractTool:
    schema = {
        "type": "object",
        "properties": {
            "urls": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of URLs to extract"
            }
        },
        "required": ["urls"]
    }
    
    async def execute(
        self,
        urls: List[str]
    ) -> Dict:
        """Extract content from web pages."""
        
        results = []
        for url in urls:
            try:
                # Fetch page content
                content = await self._fetch_url(url)
                
                # Handle PDFs
                if url.lower().endswith('.pdf'):
                    content = await self._extract_pdf(content)
                
                # Convert to markdown
                markdown = await self._convert_to_markdown(content)
                
                results.append({
                    "url": url,
                    "content": markdown,
                    "error": None
                })
            except Exception as e:
                results.append({
                    "url": url,
                    "content": None,
                    "error": str(e)
                })
        
        return {"results": results}
```

**Use Cases:**
- Searching for information
- Extracting data from websites
- Fetching documentation
- Processing PDFs and documents

### 4. IoT and Sensors

**Custom Tool Example:** Weather Station Integration

```python
@register_tool(
    name="read_weather_station",
    description="Read data from local weather station"
)
class WeatherStationTool:
    schema = {
        "type": "object",
        "properties": {
            "station_id": {
                "type": "string",
                "description": "Weather station ID"
            }
        },
        "required": ["station_id"]
    }
    
    async def execute(
        self,
        station_id: str
    ) -> Dict:
        """Read weather station data."""
        
        # Connect to weather station API
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"http://weather-station.local/api/data/{station_id}"
            ) as response:
                data = await response.json()
        
        return {
            "timestamp": data["timestamp"],
            "temperature": data["temp_c"],
            "humidity": data["humidity_pct"],
            "pressure": data["pressure_hpa"],
            "wind_speed": data["wind_speed_mps"],
            "precipitation": data["precipitation_mm"]
        }
```

**Use Cases:**
- Reading sensor data
- Controlling irrigation systems
- Monitoring equipment status
- Triggering alerts based on thresholds

### 5. Home Automation

**Custom Tool Example:** Home Assistant Integration

```python
@register_tool(
    name="home_assistant",
    description="Control Home Assistant devices and read states"
)
class HomeAssistantTool:
    def __init__(self):
        self.base_url = os.getenv("HOMEASSISTANT_URL")
        self.api_token = os.getenv("HOMEASSISTANT_TOKEN")
        self.session = aiohttp.ClientSession(
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json"
            }
        )
    
    schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["get_state", "call_service", "toggle"],
                "description": "Action to perform"
            },
            "entity_id": {
                "type": "string",
                "description": "Entity ID (e.g., switch.irrigation)"
            },
            "service": {
                "type": "string",
                "description": "Service to call (e.g., turn_on)"
            },
            "service_data": {
                "type": "object",
                "description": "Service parameters"
            }
        },
        "required": ["action", "entity_id"]
    }
    
    async def execute(
        self,
        action: str,
        entity_id: str,
        service: str = None,
        service_data: Dict = None
    ) -> Dict:
        """Execute Home Assistant action."""
        
        url = f"{self.base_url}/api/states/{entity_id}"
        
        if action == "get_state":
            async with self.session.get(url) as response:
                return await response.json()
        
        elif action == "call_service":
            service_url = f"{self.base_url}/api/services/{service}"
            async with self.session.post(
                service_url,
                json=service_data or {}
            ) as response:
                return await response.json()
        
        elif action == "toggle":
            service_url = f"{self.base_url}/api/services/homeassistant/toggle"
            async with self.session.post(
                service_url,
                json={"entity_id": entity_id}
            ) as response:
                return await response.json()
```

**Use Cases:**
- Controlling irrigation valves
- Turning on/off lights and equipment
- Monitoring energy usage
- Automating climate control

### 6. Databases

**Custom Tool Example:** PostgreSQL Integration

```python
@register_tool(
    name="query_postgres",
    description="Query PostgreSQL database"
)
class PostgresTool:
    def __init__(self):
        self.connection_string = os.getenv("POSTGRES_CONNECTION_STRING")
    
    schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "SQL query to execute"
            },
            "params": {
                "type": "array",
                "description": "Query parameters"
            }
        },
        "required": ["query"]
    }
    
    async def execute(
        self,
        query: str,
        params: List = None
    ) -> Dict:
        """Execute PostgreSQL query."""
        
        async with asyncpg.connect(self.connection_string) as conn:
            try:
                # Execute query
                rows = await conn.fetch(query, *params)
                
                # Convert to list of dicts
                results = [dict(row) for row in rows]
                
                return {
                    "rows": results,
                    "count": len(results)
                }
            
            except Exception as e:
                return {
                    "error": str(e),
                    "query": query
                }
```

**Use Cases:**
- Querying historical sensor data
- Storing and retrieving user preferences
- Logging and analytics
- Reporting and dashboards

## Integration Implementation Patterns

### Pattern 1: API Client Integration

For REST APIs, create a tool that wraps API calls:

```python
@register_tool(
    name="api_client",
    description="Generic API client"
)
class APIClientTool:
    def __init__(self):
        self.session = aiohttp.ClientSession()
    
    async def execute(
        self,
        method: str,
        url: str,
        headers: Dict = None,
        body: Dict = None
    ) -> Dict:
        """Execute HTTP request."""
        
        async with self.session.request(
            method=method,
            url=url,
            headers=headers,
            json=body
        ) as response:
            return {
                "status": response.status,
                "data": await response.json()
            }
```

### Pattern 2: Protocol Adapter

For non-HTTP protocols, implement custom protocols:

```python
@register_tool(
    name="mqtt_client",
    description="MQTT protocol client"
)
class MQTTClientTool:
    def __init__(self):
        self.client = mqtt.Client()
        self.client.connect(os.getenv("MQTT_BROKER"))
    
    async def execute(
        self,
        action: str,
        topic: str,
        payload: str = None
    ) -> Dict:
        """Execute MQTT operation."""
        
        if action == "publish":
            self.client.publish(topic, payload)
            return {"success": True, "topic": topic}
        
        elif action == "subscribe":
            self.client.subscribe(topic)
            return {"success": True, "topic": topic}
```

### Pattern 3: Data Transformation

For transforming data between systems:

```python
@register_tool(
    name="data_transform",
    description="Transform data between formats"
)
class DataTransformTool:
    schema = {
        "type": "object",
        "properties": {
            "data": {
                "type": "string",
                "description": "Input data"
            },
            "from_format": {
                "type": "string",
                "enum": ["json", "csv", "xml", "yaml"]
            },
            "to_format": {
                "type": "string",
                "enum": ["json", "csv", "xml", "yaml"]
            }
        }
    }
    
    async def execute(
        self,
        data: str,
        from_format: str,
        to_format: str
    ) -> Dict:
        """Transform data format."""
        
        # Parse input
        if from_format == "json":
            parsed = json.loads(data)
        elif from_format == "yaml":
            parsed = yaml.safe_load(data)
        # ... other formats
        
        # Serialize output
        if to_format == "json":
            output = json.dumps(parsed)
        elif to_format == "yaml":
            output = yaml.dump(parsed)
        # ... other formats
        
        return {"data": output}
```

## Adding New Integrations

### Step 1: Define Tool Schema

Create a JSON Schema describing the tool's interface:

```python
schema = {
    "type": "object",
    "properties": {
        "param1": {
            "type": "string",
            "description": "Parameter description"
        },
        "param2": {
            "type": "integer",
            "default": 42,
            "description": "Another parameter"
        }
    },
    "required": ["param1"]
}
```

### Step 2: Implement Handler

Create an async handler function:

```python
async def execute_tool(
    self,
    param1: str,
    param2: int = 42
) -> Dict:
    """Tool implementation."""
    
    # Integration logic here
    result = await self._do_integration_work(param1, param2)
    
    return {
        "success": True,
        "result": result
    }
```

### Step 3: Register Tool

Add the tool to the registry:

```python
@register_tool(
    name="my_integration",
    description="Integration with MyService",
    dangerous=False  # Set to True if modifies external state
)
class MyIntegrationTool(Tool):
    schema = {...}  # From Step 1
    
    async def execute(self, **kwargs) -> Dict:
        return await self._execute_tool(**kwargs)  # From Step 2
```

### Step 4: Configure Environment

Add configuration to `.env`:

```bash
# MyService Integration
MYSERVICE_API_KEY=your_api_key_here
MYSERVICE_BASE_URL=https://api.myservice.com
```

### Step 5: Test Integration

Test via CLI or messaging platform:

```bash
# Test via CLI
hermes chat -q "Use my_integration to do X"

# Test via Telegram (if configured)
# Send: /my_integration param1="value" param2=123
```

## Integration Best Practices

### Security

1. **Credential Management**
   - Store credentials in `.env` file
   - Never hardcode secrets
   - Use environment-specific configs

2. **Input Validation**
   - Validate all parameters
   - Sanitize file paths
   - Check for dangerous commands

3. **Rate Limiting**
   - Respect API rate limits
   - Implement exponential backoff
   - Cache results when appropriate

### Reliability

1. **Error Handling**
   - Catch and log exceptions
   - Return error information in results
   - Implement retry logic for transient failures

2. **Timeout Protection**
   - Set reasonable timeouts
   - Cancel long-running operations
   - Warn user before long operations

3. **Idempotency**
   - Design operations to be idempotent
   - Use unique transaction IDs
   - Track state to prevent duplicates

### Performance

1. **Async Operations**
   - Use async/await for I/O
   - Parallelize independent operations
   - Avoid blocking the event loop

2. **Caching**
   - Cache expensive operations
   - Use appropriate TTL
   - Invalidate cache on changes

3. **Batching**
   - Batch multiple operations
   - Use bulk APIs when available
   - Reduce round trips

## Monitoring and Debugging

### Logging

All tool executions are logged:

```python
logger.info(
    f"Tool executed: {tool_name}",
    extra={
        "tool": tool_name,
        "params": parameters,
        "duration": duration,
        "success": success
    }
)
```

### Metrics

Track integration metrics:

```python
metrics.increment("tool.calls", {"tool": tool_name})
metrics.timing("tool.duration", duration, {"tool": tool_name})
metrics.increment("tool.errors", {"tool": tool_name}, success=False)
```

### Tracing

Enable distributed tracing for complex workflows:

```python
with tracer.start_span("tool_execution") as span:
    span.set_tag("tool.name", tool_name)
    span.set_tag("tool.params", parameters)
    
    result = await self._execute_tool(parameters)
    
    span.set_tag("tool.success", success)
```

---

*Next: [Section 5: Security and Compliance](05_security_compliance.md)*
