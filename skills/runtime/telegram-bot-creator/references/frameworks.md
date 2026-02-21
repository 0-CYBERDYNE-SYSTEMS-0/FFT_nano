# Telegram Bot Frameworks

Quick comparison of the two main Python frameworks. Both work well; choice depends on your async patterns and preference.

## aiogram (Recommended for modern async projects)

**Best for:** Complex async workflows, multi-step agent integrations, high-concurrency bots

**Strengths:**
- Modern async/await patterns throughout
- Built for scalability
- Clean middleware system
- Easy state management with FSM (Finite State Machine)
- Active development, good documentation

**Setup:**
```bash
pip install aiogram python-dotenv
```

**Quick start:**
```python
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command

bot = Bot(token="YOUR_TOKEN")
dp = Dispatcher()

@dp.message(Command(start=True))
async def start(message: types.Message):
    await message.answer("Hello!")

asyncio.run(dp.start_polling(bot))
```

**Middleware for agent routing:**
```python
@dp.middleware()
async def agent_middleware(handler, event, data):
    user_id = event.from_user.id
    # Route to appropriate agent
    data["agent"] = get_agent_for_user(user_id)
    return await handler(event, data)
```

**FSM for multi-step workflows:**
```python
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

class AgentStates(StatesGroup):
    waiting_for_input = State()
    processing = State()

@dp.message(AgentStates.waiting_for_input)
async def handle_input(message: types.Message, state: FSMContext):
    # Process input, transition to next state
    await state.set_state(AgentStates.processing)
```

## python-telegram-bot

**Best for:** Simpler bots, projects already using this library, rapid prototyping

**Strengths:**
- Well-established, stable API
- Large community
- Simple to get started
- Good for basic use cases
- Mature codebase

**Setup:**
```bash
pip install python-telegram-bot python-dotenv
```

**Quick start:**
```python
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters

app = Application.builder().token("YOUR_TOKEN").build()

async def start(update: Update, context):
    await update.message.reply_text("Hello!")

app.add_handler(CommandHandler("start", start))
app.run_polling()
```

**Handler routing for agents:**
```python
async def handle_message(update: Update, context):
    agent = get_agent_for_user(update.effective_user.id)
    response = await agent.process(update.message.text)
    await update.message.reply_text(response)

app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
```

## Recommendation

For **agent-heavy bots with complex state management**: Use **aiogram** with FSM
For **simple routing agents**: Either framework works; **python-telegram-bot** may be simpler

Both support async, webhooks, and polling. Use the `agent_adapter.py` base class from scripts/ to keep agent logic framework-independent.
