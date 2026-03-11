"""POST /api/chat — main user-facing chat endpoint."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.services import ticket_service as svc
from app.core.websockets import manager

router = APIRouter(prefix="/api", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    channel: str = "chat"
    ticket_id: str = ""
    session_id: str = "user"


@router.post("/chat")
async def chat(body: ChatRequest, db: AsyncSession = Depends(get_session)):
    from app.agent.graph import run_support_agent

    past_history = ""
    current_ticket = None
    
    # 1. Duplicate detection if new thread
    is_dup = False
    dup_id = ""
    if not body.ticket_id:
        detected = await svc.detect_duplicate_ticket(db, body.session_id, body.message)
        if detected:
            is_dup = True
            dup_id = detected
            body.ticket_id = detected # implicitly route to that ticket
    
    if body.ticket_id:
        current_ticket = await svc.get_ticket(db, body.ticket_id)
        if current_ticket:
            for m in current_ticket.get("messages", []):
                role = "User" if m["role"] == "user" else "Admin" if m["role"] == "admin" else "Agent"
                past_history += f"{role}: {m['content']}\n"

    # Run the agent
    result = await run_support_agent(
        body.message, 
        ticket_id=body.ticket_id, 
        channel=body.channel, 
        past_history=past_history,
        is_duplicate=is_dup,
        duplicate_of=dup_id
    )

    reply = result["reply"]
    ticket_action = result["ticket_action"]
    agent_steps = result["agent_steps"]
    ticket = current_ticket

    action_type = ticket_action.get("action")

    # Force ticket creation if missing (except for chitchat/none)
    ticket_id = body.ticket_id
    agent_msg = None
    if not ticket_id and action_type != "none":
        ticket = await svc.create_ticket(
            db,
            title=ticket_action.get("title", body.message[:80]) or "Support Request",
            team=ticket_action.get("team", "help_desk"),
            priority=ticket_action.get("priority", "P3"),
            summary=ticket_action.get("summary", ""),
            created_by=body.session_id,
        )
        ticket_id = ticket["id"]
        action_type = "create" # Ensure we know a ticket was just made
    elif ticket_id and action_type == "resolve":
        await svc.update_ticket(db, ticket_id, status="resolved")
        ticket = await svc.get_ticket(db, ticket_id)

    if ticket_id:
        # Save user message
        await svc.add_message(db, ticket_id=ticket_id, role="user", content=body.message, channel=body.channel)
        
        if reply:
            # Save agent reply
            agent_msg = await svc.add_message(db, ticket_id=ticket_id, role="agent", content=reply, channel=body.channel)
            # Broadcast the new agent reply to WS
            await manager.broadcast_to_ticket(ticket_id, {
                "type": "new_message",
                "message": agent_msg
            })
        # Save agent steps (for admin reasoning view)
        for step in agent_steps:
            await svc.add_agent_step(
                db, ticket_id=ticket_id,
                step_type=step.get("step_type", ""),
                tool_name=step.get("tool_name", ""),
                input_data=step.get("input"),
                output_data=step.get("output"),
            )

    return {
        "reply": reply,
        "ticket": ticket,
        "kb_results_count": len(result.get("kb_results", [])),
        "message_id": agent_msg["id"] if agent_msg else None
    }
