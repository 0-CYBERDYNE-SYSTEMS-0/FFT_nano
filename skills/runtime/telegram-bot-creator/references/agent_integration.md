# Agent Integration Patterns

How to wire backend agents/pipelines into Telegram. Three main approaches depending on architecture.

## Pattern 1: Simple Function-Based Agent

**When to use:** Single-purpose agent, no external dependencies, synchronous logic

**Example:** Customer support classifier that routes to departments

```python
from agent_adapter import TelegramAgentAdapter

class SupportAgent(TelegramAgentAdapter):
    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Classify message
        category = classify_message(message)

        # Route response
        if category == "billing":
            return "Routing to billing team..."
        elif category == "technical":
            return "Routing to technical support..."
        else:
            return "Please describe your issue."

def classify_message(text: str) -> str:
    # Your classification logic here
    if "invoice" in text.lower():
        return "billing"
    return "general"
```

## Pattern 2: LLM-Based Agent (Claude/OpenRouter)

**When to use:** Conversational agent, natural language understanding, multi-turn conversations

**Example:** AI assistant using Claude API via OpenRouter

```python
import httpx
from agent_adapter import TelegramAgentAdapter

class LLMAgent(TelegramAgentAdapter):
    def __init__(self, bot_token: str, openrouter_key: str):
        super().__init__(bot_token)
        self.openrouter_key = openrouter_key
        self.base_url = "https://openrouter.io/api/v1"

    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Get user context
        state = self.get_user_state(user_id)
        system_prompt = state.get('system_prompt', 'You are a helpful assistant.')

        # Call LLM
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.openrouter_key}"},
                json={
                    "model": "claude-3-5-sonnet:free",  # or your chosen model
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": message}
                    ],
                    "max_tokens": 1024,
                }
            )

        data = response.json()
        return data['choices'][0]['message']['content']
```

**Setup OpenRouter:**
1. Get free API key from https://openrouter.io
2. Add to `.env`: `OPENROUTER_API_KEY=your_key`
3. Models available: claude-opus-4-5, claude-sonnet (free tier), qwen, mixtral, etc.

## Pattern 3: Multi-Agent Pipeline

**When to use:** Complex workflows, different agents for different stages, conditional routing

**Example:** Task automation bot (classify → plan → execute → report)

```python
from agent_adapter import TelegramAgentAdapter

class PipelineAgent(TelegramAgentAdapter):
    def __init__(self, bot_token: str):
        super().__init__(bot_token)
        self.agents = {
            "classifier": ClassifierAgent(),
            "planner": PlannerAgent(),
            "executor": ExecutorAgent(),
        }

    async def process_agent_request(self, message: str, user_id: str) -> str:
        state = self.get_user_state(user_id)

        # Stage 1: Classify
        task_type = await self.agents["classifier"].classify(message)
        self.update_user_state(user_id, "task_type", task_type)

        # Stage 2: Plan
        plan = await self.agents["planner"].plan(message, task_type)
        self.update_user_state(user_id, "plan", plan)

        # Stage 3: Execute
        result = await self.agents["executor"].execute(plan)

        return f"✅ Task completed:\n{result}"

class ClassifierAgent:
    async def classify(self, message: str) -> str:
        # Classification logic
        return "automation"

class PlannerAgent:
    async def plan(self, message: str, task_type: str) -> dict:
        return {"steps": ["step1", "step2"]}

class ExecutorAgent:
    async def execute(self, plan: dict) -> str:
        return "Execution result"
```

## Pattern 4: External API Integration

**When to use:** Agent runs on separate service, Telegram is just interface

**Example:** Bot forwards to remote agent service

```python
import httpx
from agent_adapter import TelegramAgentAdapter

class RemoteAgentAdapter(TelegramAgentAdapter):
    def __init__(self, bot_token: str, agent_service_url: str):
        super().__init__(bot_token)
        self.agent_url = agent_service_url

    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Forward to backend service
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.agent_url}/process",
                json={
                    "user_id": user_id,
                    "message": message,
                    "context": self.get_user_state(user_id)
                },
                timeout=30.0
            )

        data = response.json()
        return data.get("response", "Error processing request")
```

Deploy your agent service separately (FastAPI, Flask, etc.), expose `/process` endpoint.

## Pattern 5: Agentskills.io Spec Compliance

**When to use:** Using agent framework that follows agentskills.io protocol

```python
import json
from agent_adapter import TelegramAgentAdapter

class AgentSkillsAdapter(TelegramAgentAdapter):
    """Bridges agentskills.io protocol agents to Telegram."""

    def __init__(self, bot_token: str, agent_spec_path: str):
        super().__init__(bot_token)
        # Load agent spec
        with open(agent_spec_path) as f:
            self.agent_spec = json.load(f)

    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Format message as agentskills.io request
        request = {
            "type": "skill_request",
            "skill": self.agent_spec["name"],
            "input": message,
            "context": self.get_user_state(user_id)
        }

        # Process through agent framework
        response = await self.call_agent_skill(request)
        return response["output"]

    async def call_agent_skill(self, request: dict) -> dict:
        # Implement based on your agentskills.io setup
        pass
```

## Choosing a Pattern

| Pattern | Complexity | Latency | Scalability | Best For |
|---------|-----------|---------|-------------|----------|
| Simple Function | Low | Low | Medium | Routing, classification |
| LLM-Based | Medium | Medium | High | Conversational AI |
| Multi-Agent Pipeline | High | High | Medium | Complex workflows |
| Remote API | Medium | Medium | High | Decoupled architecture |
| Agentskills.io | Medium | Variable | High | Agent framework integration |

Start simple (Pattern 1/2), scale to pipelines (Pattern 3/4) as needed.
