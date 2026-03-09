# Support Desk AI Agent

AI-powered support agent that handles IT, DevOps, Sales, Network, and Security requests via chat or voice. Creates tickets automatically and routes them to the right team.

## Quick Start

### Backend

```bash
cd api
python -m venv .venv
.venv\Scripts\activate        # Windows or . .venv/Scripts/activate
pip install -r requirements.txt
pip install chromadb

# Set your OpenAI key
cp .env.example .env
# Edit .env → OPENAI_API_KEY=sk-...

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd front
npm install
npm install react-router-dom date-fns clsx
npm run dev
```

Open **http://localhost:5173**

## Pages

| Page | URL | Description |
|------|-----|-------------|
| **Chat** | `/` | User talks to AI agent. Agent answers and creates tickets. |
| **Tickets** | `/admin` | Admin views all tickets, conversations, and agent reasoning. |
| **KB** | `/kb` | Admin manages knowledge base articles (vector search). |

## How It Works (The Support Agent Pipeline)

When a user interacts with the Chat or Voice UI, this is what happens behind the scenes:

1. **User Interaction `(front/src/pages/UserChatPage.tsx)`**:
   - User types a message or records voice.
   - React sends an HTTP Request passing the `ticket_id` and the user's secret `session_id`.

2. **API Router `(api/app/routers/chat.py)`**:
   - The backend `/api/chat` route receives the payload.
   - It fetches the ongoing chat history from the SQL database using the `ticket_id`.

3. **LangGraph Agent Execution `(api/app/agent/graph.py)`**:
   - The AI Agent starts its two-step node process automatically:
   - **Node 1 (`understand`)**: Searches the ChromaDB Knowledge Base (`rag_service.py`) for matching IT articles using Vector Embeddings. It builds the memory prompt.
   - **Node 2 (`respond`)**: The OpenAI model reads the memory, the articles, and decides exactly how to help the user. It outputs a rigid JSON structure specifying whether to create a ticket (`action='create'`), resolve it, and which Team handles it.

4. **WebSockets Broadcasting `(api/app/core/websockets.py)`**:
   - The AI's reply is instantly saved to the Database.
   - The `ConnectionManager` broadcasts this freshly written code instantly to all connected React browsers over WebSockets (meaning no page refreshing needed!). Admin dashboard and User view sync perfectly.

**Looking for a Deep Dive Architecture Guide?**
👉 **[Read the Backend Agent Logic Guide Here](BACKEND_LOGIC.md)** for detailed Python code examples and beginner-friendly logic explanations for every file!

## Teams

| Team | Handles |
|------|---------|
| Help Desk | Laptop, password, software issues |
| DevOps | Server, database, deployment issues |
| Sales | Pricing, licensing, contracts |
| Network | VPN, WiFi, firewall, printer |
| Security | Phishing, access requests, certificates |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message → get agent reply + ticket |
| POST | `/api/voice/transcribe` | Upload audio → STT → agent reply + ticket |
| GET | `/api/tickets` | List tickets (filter by team/status) |
| GET | `/api/tickets/:id` | Ticket detail with messages + agent steps |
| PATCH | `/api/tickets/:id` | Update ticket status/assignment |
| GET | `/api/kb/search?q=...` | Semantic vector search |
| GET/POST/PUT/DELETE | `/api/kb/documents` | KB document CRUD |

## Tech Stack

- **Backend**: Python, FastAPI, LangGraph, OpenAI (GPT-4o, Whisper, text-embedding-3-small), ChromaDB, SQLite
- **Frontend**: React 19, TypeScript, Vite, TanStack Query, Zustand
- **RAG**: ChromaDB vector store, section-level chunking, cosine similarity search