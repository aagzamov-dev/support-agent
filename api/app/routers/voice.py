"""POST /api/voice/transcribe — voice input via STT."""

import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.services.audio_service import transcribe_audio

router = APIRouter(prefix="/api", tags=["voice"])

# Words that indicate the user considers the issue resolved
_RESOLVE_KEYWORDS = ["thank", "tanks", "thanks", "worked", "fixed", "done", "solved", "great", "perfect"]


@router.post("/voice/transcribe")
async def voice_transcribe(
    audio: UploadFile = File(...),
    ticket_id: str = Form(""),
    session_id: str = Form(""),
    db: AsyncSession = Depends(get_session),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file")

    ext = audio.filename.rsplit(".", 1)[-1] if audio.filename and "." in audio.filename else "webm"
    filename = f"voice_{uuid.uuid4().hex[:8]}.{ext}"

    result = await transcribe_audio(audio_bytes, filename=filename)
    transcript = result["text"]

    # Now run it through the chat agent
    from app.agent.graph import run_support_agent
    from app.services import ticket_service as svc
    
    past_history = ""
    current_ticket = None
    if ticket_id:
        current_ticket = await svc.get_ticket(db, ticket_id)
        if current_ticket:
            for m in current_ticket.get("messages", []):
                role = "User" if m["role"] == "user" else "Admin" if m["role"] == "admin" else "Agent"
                past_history += f"{role}: {m['content']}\n"

    agent_result = await run_support_agent(transcript, ticket_id=ticket_id, channel="voice", past_history=past_history)
    reply = agent_result["reply"]
    ticket_action = agent_result["ticket_action"]
    ticket = current_ticket
    
    action_type = ticket_action.get("action")
    agent_msg = None

    if not ticket_id and action_type != "none":
        generated_title = ticket_action.get("title") or transcript[:80] or "Voice Request"
        ticket = await svc.create_ticket(
            db,
            title=generated_title,
            team=ticket_action.get("team", "help_desk"),
            priority=ticket_action.get("priority", "Medium"),
            summary=ticket_action.get("summary", ""),
            created_by=session_id,
            channel="voice",
        )
        ticket_id = ticket["id"]
        action_type = "create"
    elif ticket_id and action_type == "resolve":
        await svc.update_ticket(db, ticket_id, status="resolved")
        ticket = await svc.get_ticket(db, ticket_id)

    # Update ticket details if it's still the generic default
    if ticket_id and ticket and ticket.get("title") in ("New Support Request", "New Chat Support Ticket", "Voice Request"):
        updates = {}
        if ticket_action.get("title"):
            updates["title"] = ticket_action["title"]
        if ticket_action.get("team"):
            updates["team"] = ticket_action["team"]
        if ticket_action.get("priority"):
            updates["priority"] = ticket_action["priority"]
        
        if updates:
            await svc.update_ticket(db, ticket_id, **updates)
            ticket.update(updates)
            
            from app.core.websockets import manager
            await manager.broadcast_to_ticket(ticket_id, {
                "type": "ticket_update",
                "ticket": ticket
            })
    # Detect resolution intent from transcript
    lower_transcript = transcript.lower()
    is_thanks = any(k in lower_transcript for k in _RESOLVE_KEYWORDS)
    if is_thanks and action_type not in ("resolve", "create"):
        action_type = "resolve"

    if ticket_id:
        from app.core.websockets import manager
        
        # Save & broadcast USER voice message
        user_msg = await svc.add_message(
            db, ticket_id=ticket_id, role="user", content=transcript, channel="voice",
            metadata={"audio_url": result["audio_url"]}
        )
        await manager.broadcast_to_ticket(ticket_id, {
            "type": "new_message",
            "message": user_msg
        })
        
        from app.services.audio_service import generate_audio
        if reply:
            # Escalation check: if RAG confidence is low, keep full reply but add admin note
            is_rag_low = False
            for step in agent_result.get("agent_steps", []):
                if step.get("step_type") == "evaluation" and step.get("output", {}).get("context_confidence", 1.0) < 0.4:
                    is_rag_low = True
                    break
            
            if is_rag_low and "admin will answer" not in reply.lower():
                reply += "\n\nAn Admin will answer you as soon as possible."

            # Generate TTS for the full reply (no truncation!)
            agent_audio_url = await generate_audio(reply)
            
            agent_msg = await svc.add_message(
                db, ticket_id=ticket_id, role="agent", content=reply, channel="voice",
                metadata={"audio_url": agent_audio_url}
            )
            
            await manager.broadcast_to_ticket(ticket_id, {
                "type": "new_message",
                "message": agent_msg
            })
        
        for step in agent_result.get("agent_steps", []):
            await svc.add_agent_step(db, ticket_id=ticket_id, step_type=step.get("step_type", ""),
                                     tool_name=step.get("tool_name", ""), input_data=step.get("input"),
                                     output_data=step.get("output"))

    agent_audio = agent_msg.get("metadata", {}).get("audio_url") if agent_msg and isinstance(agent_msg, dict) else None
    return {
        "transcript": transcript, 
        "reply": reply, 
        "action": action_type,
        "ticket": ticket, 
        "audio_url": result["audio_url"], 
        "agent_audio_url": agent_audio, 
        "message_id": agent_msg["id"] if agent_msg else None
    }


@router.post("/tickets/{ticket_id}/voice_reply")
async def voice_reply(
    ticket_id: str,
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file")

    ext = audio.filename.rsplit(".", 1)[-1] if audio.filename and "." in audio.filename else "webm"
    filename = f"admin_reply_{uuid.uuid4().hex[:8]}.{ext}"

    result = await transcribe_audio(audio_bytes, filename=filename)
    transcript = result["text"]

    from app.services import ticket_service as svc
    from app.core.websockets import manager
    
    # Add message from admin with audio metadata
    m = await svc.add_message(
        db, 
        ticket_id=ticket_id, 
        role="admin", 
        content=transcript, 
        channel="voice",
        metadata={"audio_url": result["audio_url"]}
    )
    
    await manager.broadcast_to_ticket(ticket_id, {
        "type": "new_message",
        "message": m
    })
    
    return m
