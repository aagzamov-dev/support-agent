# AI Support Node Agent: Backend Logic Explained

This document explains exactly how the backend agent (the brain of the chat and voice support) works step-by-step. If you aren't familiar with Python, think of this as a recipe book. Every time a user sends a message, it gets cooked through several files in a specific order before returning a response.

---

## 🏗️ 1. The Core Architecture (LangGraph)

The AI agent is built using a tool called **LangGraph**. Think of LangGraph as a flow chart or a pipeline. Instead of having one massive AI prompt, we break the AI's job into **Nodes** (steps).

The two main nodes in our architecture are:
1. `understand`: Read the user's message, search the Knowledge Base (RAG) for helpful old IT articles, and prepare the memory.
2. `respond`: Give the memory and articles to the OpenAI GPT model so it can write a friendly reply and decide whether to open a new ticket.

### The Flow (`app/agent/graph.py`)

This file is what joins the nodes together in a straight line. 

```python
# app/agent/graph.py
from langgraph.graph import END, StateGraph
from app.agent.nodes import understand, respond

# 1. We create the "Flow Chart"
_graph = StateGraph(AgentState)

# 2. We add our two steps to the chart
_graph.add_node("understand", understand)
_graph.add_node("respond", respond)

# 3. We draw the arrows between the steps
_graph.set_entry_point("understand")      # Start at 'understand'
_graph.add_edge("understand", "respond")  # From 'understand' go to 'respond'
_graph.add_edge("respond", END)           # After 'respond', finish the job

# 4. We compile the chart into a usable Python function
agent_graph = _graph.compile()
```

When you call `run_support_agent(user_message="My VPN is broken!")`, it triggers this flowchart from start to finish.

---

## 🧠 2. The Nodes (The actual logic steps)

The file `app/agent/nodes.py` contains the code that runs when the flowchart hits a specific node.

### Step 1: The `understand` Node

The job of this function is to prepare the context *before* the AI wakes up. 

```python
async def understand(state: AgentState) -> dict:
    from app.services.rag_service import search
    
    # 1. Grab the user's message out of the State variable (the "suitcase" handed between nodes)
    user_msg = state["user_message"]
    
    # 2. Use the RAG service to search the Knowledge Base database for "VPN fixes"
    kb_results = search(user_msg, top_k=5)
    
    # 3. Build the System Prompt (the strict instructions for the AI)
    system_content = build_system_prompt(kb_results, history)

    # 4. Put the Prompt and the User's message into the "suitcase" for the next node
    return {
        "kb_results": kb_results,
        "messages": [
            SystemMessage(content=system_content),
            HumanMessage(content=user_msg),
        ],
    }
```

### Step 2: The `respond` Node

This function actually speaks to `OpenAI` and gets a structured JSON back, not just plain text.

```python
class TicketDecision(BaseModel):
    # This forces the AI to always reply in a strict JSON format!
    action: str      # 'create', 'resolve', or 'none'
    title: str       # 'VPN Issues on Mac'
    team: str        # 'network'
    reply: str       # 'Hello! I can help you fix your VPN. Have you tried...'

async def respond(state: AgentState) -> dict:
    # 1. Start the GPT model and tell it to follow the TicketDecision JSON format
    llm = ChatOpenAI(model="gpt-4o").with_structured_output(TicketDecision)

    # 2. Send the "suitcase" full of prompts and KB articles to GPT
    decision = await llm.ainvoke(state["messages"])

    # 3. Return the reply and ticket decisions back to the Router (main.py/chat.py)
    return {
        "reply": decision.reply,
        "ticket_action": {"action": decision.action, "team": decision.team, ...}
    }
```

---

## ✉️ 3. The API Router Gateway (`app/routers/chat.py`)

When the Frontend React app sends an HTTP `POST` request to `/api/chat`, this file catches it. It acts as the manager setting everything up.

```python
# app/routers/chat.py

@router.post("/chat")
async def chat(body: ChatRequest, db: AsyncSession = Depends(get_session)):
    
    # 1. Fetch old history from the database if this is an ongoing ticket
    if body.ticket_id:
        current_ticket = await svc.get_ticket(db, body.ticket_id)
        # ... append old messages to 'past_history'
    
    # 2. Start the LangGraph execution! Pass it the text and history.
    result = await run_support_agent(body.message, past_history=past_history)

    # 3. Read what the LangGraph agent decided to do
    action_type = result["ticket_action"]["action"]

    # 4. Modify the database based on the AI's JSON decisions
    if action_type == "create" and not ticket_id:
        # Save a new ticket to the SQL Database
        ticket = await svc.create_ticket(db, title=result["ticket_action"]["title"], ...)
        ticket_id = ticket["id"]

    # 5. Save the actual message texts to the DB
    if ticket_id:
        await svc.add_message(db, ticket_id=ticket_id, role="user", content=body.message)
        agent_msg = await svc.add_message(db, ticket_id=ticket_id, role="agent", content=result["reply"])

        # 🚀 6. Broadcasting 🚀
        # Instantly shoot the new message down the WebSocket to ALL open browser tabs
        await manager.broadcast_to_ticket(ticket_id, {
            "type": "new_message",
            "message": agent_msg
        })

    # 7. Return the final success response back to React HTTP
    return {"reply": result["reply"], "ticket": ticket}
```

---

## 📡 4. WebSockets Broadcasting (`app/core/websockets.py` and `app/routers/ws.py`)

A WebSocket is a permanent pipeline between the Frontend browser and the Python backend. Since HTTP requests are one-way (browser asks -> server replies), we need WebSockets for two-way (server pushes to browser unexpectedly) when an Admin replies.

**`app/core/websockets.py`**:
* Contains the `ConnectionManager`. It holds memory of every user currently looking at a ticket.
* Imagine a dictionary mapping: `{'TKT-123': [User A's Browser, Admin B's Browser]}`.
* When `broadcast_to_ticket('TKT-123', new_message)` runs, the Manager loops through the browsers and fires the JSON down the pipe.

**`app/routers/ws.py`**:
* When React code writes `new WebSocket('ws://localhost:8000/api/ws/chat/TKT-123')`, it pings the `@router.websocket("/api/ws/chat/{ticket_id}")` function.
* The function accepts the socket, saves it in the `ConnectionManager`, and holds an infinite `while True:` loop open so the connection never drops until the user closes the site.

---

## 📚 5. RAG (Knowledge Base Search) (`app/services/rag_service.py`)

RAG stands for **Retrieval-Augmented Generation**. 

Think of it this way: LLMs are smart but don't know your specific company rules. RAG fixes this by letting the LLM read custom documents on the fly. 

1. **Chunking/Embedding**: Whenever an admin saves a Knowledge Base article in React, `rag_service.py` splits it into pieces ("chunks", e.g. per-paragraph). It asks OpenAI's `text-embedding-3-small` to convert the text into a giant array of 1,536 numbers (a Vector). 
2. **Storing**: It saves these Vectors into a local database called **ChromaDB** (`storage/kb/chroma`).
3. **Searching (`def search(query):`)**: When the user says "My VPN broke", Python converts that exact query into a Vector too. It asks ChromaDB to find the 5 paragraph Vectors physically closest in space (mathematically) to the query Vector.
4. It returns those top 5 article chunks back to `nodes.py -> understand()`.

This is exactly how ChatGPT "searches the web". 

---

## ⚙️ Summary of Request Lifecycles

### When a User speaks to the Agent (Chat or Voice)
1. React `POST`'s to `/api/chat` OR `/api/voice/transcribe`.
2. `chat.py` runs the `agent_graph` (`graph.py`).
3. `understand()` node searches ChromaDB (`rag_service.py`) for matching IT articles.
4. `respond()` node structures a JSON reply and chooses to open a ticket.
5. `chat.py` reads the JSON, writes new database records (Ticket + Messages).
6. `chat.py` fires `manager.broadcast_to_ticket`, instantly updating all React frontends connected to `/api/ws`.

### When an Admin talks to a User
1. React Admin clicks *Send* and triggers a `POST /api/tickets/{id}/reply`.
2. `tickets.py` takes the message and saves it as `role="admin"` directly in the DB.
3. `tickets.py` skips the `agent_graph` (Agent not needed, it's a human!).
4. `tickets.py` fires `manager.broadcast_to_ticket`.
5. The User's React socket receives the JSON and paints it onto the screen with a `👤 Human Support` badge instantly!
