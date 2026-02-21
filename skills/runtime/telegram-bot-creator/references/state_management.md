# State Management

How to persist user state, conversation context, and data across messages.

## In-Memory (Development)

**Simplest approach for testing, not production.**

```python
from agent_adapter import TelegramAgentAdapter

class SimpleAgent(TelegramAgentAdapter):
    def __init__(self, bot_token: str):
        super().__init__(bot_token)
        # self.user_state already available from base class
```

Built-in `user_state` dict in `agent_adapter.py` handles basic state. Use `update_user_state()` and `get_user_state()` methods.

**Limitation:** Data lost when bot restarts.

---

## Redis (Recommended for production)

**Fast, distributed, good for scaling.**

**Setup:**
```bash
pip install aioredis redis
```

**Implementation:**
```python
import json
import aioredis
from agent_adapter import TelegramAgentAdapter

class RedisStateAgent(TelegramAgentAdapter):
    def __init__(self, bot_token: str, redis_url: str = "redis://localhost"):
        super().__init__(bot_token)
        self.redis_url = redis_url
        self.redis = None

    async def connect(self):
        """Initialize Redis connection."""
        self.redis = await aioredis.from_url(self.redis_url)

    async def get_user_state(self, user_id: str) -> dict:
        """Load state from Redis."""
        data = await self.redis.get(f"user:{user_id}:state")
        return json.loads(data) if data else {}

    async def update_user_state(self, user_id: str, key: str, value):
        """Update state in Redis."""
        state = await self.get_user_state(user_id)
        state[key] = value
        await self.redis.set(
            f"user:{user_id}:state",
            json.dumps(state),
            ex=86400  # 24 hour expiry
        )

    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Load state from Redis
        state = await self.get_user_state(user_id)

        # Process with state context
        response = await self.agent_logic(message, state)

        # Update Redis
        await self.update_user_state(user_id, "last_message", message)

        return response

    async def agent_logic(self, message: str, state: dict) -> str:
        # Your agent logic here
        return f"Processed: {message}"
```

**Docker Redis:**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Cloud Redis:**
- AWS ElastiCache
- Google Cloud Memorystore
- Upstash (serverless)
- Redis Labs (managed)

---

## PostgreSQL (For complex data)

**When to use:** Need structured data, complex queries, compliance requirements.

**Setup:**
```bash
pip install asyncpg sqlalchemy
```

**Implementation:**
```python
import asyncpg
from agent_adapter import TelegramAgentAdapter

class SQLStateAgent(TelegramAgentAdapter):
    def __init__(self, bot_token: str, db_url: str):
        super().__init__(bot_token)
        self.db_url = db_url
        self.db = None

    async def connect(self):
        """Initialize DB connection."""
        self.db = await asyncpg.create_pool(self.db_url)

    async def get_user_state(self, user_id: str) -> dict:
        """Load user state from database."""
        async with self.db.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT state FROM user_state WHERE user_id = $1",
                user_id
            )
        return json.loads(row['state']) if row else {}

    async def update_user_state(self, user_id: str, key: str, value):
        """Update or insert user state."""
        state = await self.get_user_state(user_id)
        state[key] = value

        async with self.db.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO user_state (user_id, state, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (user_id)
                DO UPDATE SET state = $2, updated_at = NOW()
                """,
                user_id,
                json.dumps(state)
            )

    async def process_agent_request(self, message: str, user_id: str) -> str:
        state = await self.get_user_state(user_id)
        response = await self.agent_logic(message, state)
        await self.update_user_state(user_id, "last_message", message)
        return response
```

**Schema:**
```sql
CREATE TABLE user_state (
    user_id TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_state_updated ON user_state(updated_at);
```

---

## Hybrid: Redis + PostgreSQL

**Best of both:** Redis for speed, Postgres for persistence.

```python
class HybridStateAgent(TelegramAgentAdapter):
    def __init__(self, bot_token: str, redis_url: str, db_url: str):
        super().__init__(bot_token)
        self.redis_url = redis_url
        self.db_url = db_url

    async def get_user_state(self, user_id: str) -> dict:
        # Try Redis first (fast)
        data = await self.redis.get(f"user:{user_id}:state")
        if data:
            return json.loads(data)

        # Fall back to database (persistent)
        data = await self.get_from_db(user_id)
        if data:
            # Populate Redis for next time
            await self.redis.set(f"user:{user_id}:state", json.dumps(data), ex=3600)
            return data

        return {}

    async def update_user_state(self, user_id: str, key: str, value):
        # Update both
        state = await self.get_user_state(user_id)
        state[key] = value

        # Write to Redis
        await self.redis.set(f"user:{user_id}:state", json.dumps(state), ex=3600)

        # Write to database (async in background)
        asyncio.create_task(self.write_to_db(user_id, state))
```

---

## Aiogram FSM (Framework-level state)

**Built into aiogram for multi-step workflows.**

```python
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.redis import RedisStorage

# Define states
class ConversationStates(StatesGroup):
    step_1 = State()
    step_2 = State()
    step_3 = State()

# Use RedisStorage for distributed state
redis_storage = RedisStorage.from_url("redis://localhost:6379/0")
dp = Dispatcher(storage=redis_storage)

@dp.message(ConversationStates.step_1)
async def handle_step_1(message: types.Message, state: FSMContext):
    data = await state.get_data()

    # Save to state
    await state.update_data(step_1_answer=message.text)

    # Transition to next step
    await state.set_state(ConversationStates.step_2)
    await message.answer("Now step 2...")
```

---

## Cloud Solutions

| Solution | Cost | Scalability | Best For |
|----------|------|-------------|----------|
| Redis | Low | High | Session data, caching |
| PostgreSQL | Medium | Medium | Structured data |
| DynamoDB | Pay-per-use | High | Serverless |
| Firebase | Pay-per-use | High | No ops |
| Supabase | Low | Medium | Postgres with hosting |

**For quick setup:** Use PostgreSQL on:
- DigitalOcean ($12/mo managed)
- AWS RDS free tier
- Google Cloud SQL free tier
- Supabase (free tier)
