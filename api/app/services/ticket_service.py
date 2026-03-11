"""Ticket service — CRUD for tickets, messages, and agent steps."""

from __future__ import annotations

import json
import uuid
import math
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Ticket, Message, AgentStep


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Tickets ────────────────────────────────────────────────────────────

async def create_ticket(
    db: AsyncSession, *, title: str, team: str = "help_desk",
    priority: str = "P3", created_by: str = "user", summary: str = "",
) -> dict:
    t = Ticket(
        id=_uid("TK-"), title=title, team=team, priority=priority,
        status="open", created_by=created_by, assigned_to="",
        summary=summary, created_at=_now(), updated_at=_now(),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _ticket_to_dict(t)


async def get_ticket(db: AsyncSession, ticket_id: str) -> dict | None:
    t = await db.get(Ticket, ticket_id)
    if not t:
        return None
    d = _ticket_to_dict(t)
    # Load messages
    msgs = (await db.execute(
        select(Message).where(Message.ticket_id == ticket_id).order_by(Message.created_at)
    )).scalars().all()
    d["messages"] = [_msg_to_dict(m) for m in msgs]
    # Load agent steps
    steps = (await db.execute(
        select(AgentStep).where(AgentStep.ticket_id == ticket_id).order_by(AgentStep.created_at)
    )).scalars().all()
    d["agent_steps"] = [_step_to_dict(s) for s in steps]
    return d


async def list_tickets(
    db: AsyncSession, *, team: str | None = None,
    status: str | None = None, limit: int = 50,
) -> list[dict]:
    q = select(Ticket).order_by(Ticket.created_at.desc())
    if team:
        q = q.where(Ticket.team == team)
    if status:
        q = q.where(Ticket.status == status)
    q = q.limit(limit)
    rows = (await db.execute(q)).scalars().all()
    result = []
    for t in rows:
        d = _ticket_to_dict(t)
        mc = (await db.execute(
            select(func.count(Message.id)).where(Message.ticket_id == t.id)
        )).scalar() or 0
        d["message_count"] = mc
        result.append(d)
    return result


async def update_ticket(db: AsyncSession, ticket_id: str, **kwargs: Any) -> dict | None:
    kwargs["updated_at"] = _now()
    await db.execute(update(Ticket).where(Ticket.id == ticket_id).values(**kwargs))
    await db.commit()
    t = await db.get(Ticket, ticket_id)
    return _ticket_to_dict(t) if t else None


def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    return dot / (norm1 * norm2) if norm1 and norm2 else 0.0

async def detect_duplicate_ticket(db: AsyncSession, session_id: str, message: str) -> str | None:
    """Find if this message is highly similar (>0.85) to a recent open ticket."""
    since = _now() - timedelta(hours=72)
    q = select(Ticket).where(
        Ticket.created_by == session_id,
        Ticket.status == "open",
        Ticket.created_at >= since
    )
    rows = (await db.execute(q)).scalars().all()
    
    if not rows:
        return None
        
    from app.services.rag_service import embed_text_async, _embed_async
    try:
        msg_emb = await embed_text_async(message)
        target_texts = [f"{t.title} {t.summary}" for t in rows]
        if target_texts:
            t_embs = await _embed_async(target_texts)
            for t, t_emb in zip(rows, t_embs):
                if _cosine_similarity(msg_emb, t_emb) > 0.85:
                    return t.id
    except Exception:
        pass # fail silently if embedding fails
    return None


# ── Messages ───────────────────────────────────────────────────────────

async def add_message(
    db: AsyncSession, *, ticket_id: str, role: str, content: str,
    channel: str = "chat", metadata: dict | None = None,
) -> dict:
    m = Message(
        id=_uid("msg-"), ticket_id=ticket_id, role=role, content=content,
        channel=channel, metadata_json=json.dumps(metadata or {}),
        created_at=_now(),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _msg_to_dict(m)


# ── Agent Steps ────────────────────────────────────────────────────────

async def add_agent_step(
    db: AsyncSession, *, ticket_id: str, step_type: str,
    tool_name: str = "", input_data: Any = None, output_data: Any = None,
) -> dict:
    s = AgentStep(
        id=_uid("step-"), ticket_id=ticket_id, step_type=step_type,
        tool_name=tool_name,
        input_data=json.dumps(input_data or {}, default=str),
        output_data=json.dumps(output_data or {}, default=str),
        created_at=_now(),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _step_to_dict(s)


# ── Helpers ────────────────────────────────────────────────────────────

def _ticket_to_dict(t: Ticket) -> dict:
    return {
        "id": t.id, "title": t.title, "team": t.team, "priority": t.priority,
        "status": t.status, "created_by": t.created_by, "assigned_to": t.assigned_to,
        "summary": t.summary or "",
        "category_id": getattr(t, "category_id", ""),
        "channel": getattr(t, "summary", "").replace("Channel: ", "") if "Channel:" in getattr(t, "summary", "") else "chat",
        "sentiment_score": getattr(t, "sentiment_score", 0.0),
        "escalated_at": t.escalated_at.isoformat() if getattr(t, "escalated_at", None) else None,
        "duplicate_of": getattr(t, "duplicate_of", None),
        "feedback_score": t.feedback_score,
        "created_at": t.created_at.isoformat() if t.created_at else "",
        "updated_at": t.updated_at.isoformat() if t.updated_at else "",
    }


def _msg_to_dict(m: Message) -> dict:
    meta = m.metadata_json
    if isinstance(meta, str):
        try: meta = json.loads(meta)
        except: meta = {}
    return {
        "id": m.id, "ticket_id": m.ticket_id, "role": m.role,
        "content": m.content, "channel": m.channel, "metadata": meta,
        "token_count": getattr(m, "token_count", 0),
        "llm_latency_ms": getattr(m, "llm_latency_ms", 0),
        "confidence_score": getattr(m, "confidence_score", None),
        "created_at": m.created_at.isoformat() if m.created_at else "",
    }


def _step_to_dict(s: AgentStep) -> dict:
    def _parse(val):
        if isinstance(val, str):
            try: return json.loads(val)
            except: return {}
        return val or {}
    return {
        "id": s.id, "ticket_id": s.ticket_id, "step_type": s.step_type,
        "tool_name": s.tool_name, "input": _parse(s.input_data),
        "output": _parse(s.output_data),
        "created_at": s.created_at.isoformat() if s.created_at else "",
    }
