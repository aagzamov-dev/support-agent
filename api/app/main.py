"""FastAPI app — Support Desk AI Agent."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.db.engine import engine
from app.db.models import Base
from app.routers import chat, voice, tickets, kb, ws


Path("storage").mkdir(exist_ok=True)
Path("storage/audio").mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Support Desk AI Agent",
    description="AI-powered support agent — chat, voice, ticket management",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

app.mount("/static/audio", StaticFiles(directory="storage/audio"), name="audio")

app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(tickets.router)
app.include_router(kb.router)
app.include_router(ws.router)


@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": "Support Desk AI Agent"}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy"}
