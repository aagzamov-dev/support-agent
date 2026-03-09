"""Tickets CRUD — admin-facing."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.engine import get_session
from app.db.models import Ticket, Message
from app.services import ticket_service as svc
from app.core.websockets import manager

router = APIRouter(prefix="/api", tags=["tickets"])


@router.get("/tickets")
async def list_tickets(
    team: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_session),
):
    return {"tickets": await svc.list_tickets(db, team=team, status=status, limit=limit)}


@router.get("/user/tickets")
async def list_user_tickets(session_id: str, db: AsyncSession = Depends(get_session)):
    q = select(Ticket).where(Ticket.created_by == session_id).order_by(Ticket.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    result = []
    for t in rows:
        d = svc._ticket_to_dict(t)
        d["message_count"] = (await db.execute(
            select(func.count(Message.id)).where(Message.ticket_id == t.id)
        )).scalar() or 0
        result.append(d)
    return {"tickets": result}


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, db: AsyncSession = Depends(get_session)):
    t = await svc.get_ticket(db, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


class TicketUpdate(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    priority: str | None = None
    team: str | None = None


@router.patch("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, body: TicketUpdate, db: AsyncSession = Depends(get_session)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    t = await svc.update_ticket(db, ticket_id, **updates)
    if not t:
        raise HTTPException(404, "Ticket not found")
        
    await manager.broadcast_to_ticket(ticket_id, {
        "type": "ticket_update",
        "ticket": t
    })
    return t


class TicketReply(BaseModel):
    message: str


@router.post("/tickets/{ticket_id}/reply")
async def reply_ticket(ticket_id: str, body: TicketReply, db: AsyncSession = Depends(get_session)):
    t = await svc.get_ticket(db, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    
    # Add message from admin
    m = await svc.add_message(db, ticket_id=ticket_id, role="admin", content=body.message)
    
    await manager.broadcast_to_ticket(ticket_id, {
        "type": "new_message",
        "message": m
    })
    return m


class TicketFeedback(BaseModel):
    score: int
    text: str | None = None


@router.post("/tickets/{ticket_id}/feedback")
async def feedback_ticket(ticket_id: str, body: TicketFeedback, db: AsyncSession = Depends(get_session)):
    t = await svc.update_ticket(db, ticket_id, feedback_score=body.score, feedback_text=body.text)
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t
