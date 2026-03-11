"""LangGraph nodes for the support agent."""

from __future__ import annotations

import json
from enum import Enum
from typing import Optional
import time

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.agent.prompts import (
    TRIAGE_PROMPT,
    EVALUATOR_PROMPT,
    DRAFTING_PROMPT,
    CLASSIFICATION_PROMPT,
    format_history,
    build_context_str
)
from app.agent.state import AgentState
from app.core.config import settings
from app.core.websockets import manager
import datetime

async def _notify_ws(state: AgentState, message: str, event_type: str = "AGENT_TYPING"):
    t_id = state.get("ticket_id")
    if t_id:
        try:
            await manager.broadcast_to_ticket(t_id, {
                "type": event_type,
                "message": message,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
            })
        except Exception:
            pass


def _get_llm():
    return ChatOpenAI(
        model=settings.LLM_MODEL,
        temperature=settings.LLM_TEMPERATURE,
        api_key=settings.OPENAI_API_KEY,
    )

def _get_fast_llm():
    return ChatOpenAI(
        model=settings.LLM_FAST_MODEL,
        temperature=0.0,
        api_key=settings.OPENAI_API_KEY,
    )


# ── Structured output schemas ──────────────────────────────────────────

class TriageIntent(str, Enum):
    CHITCHAT = "chitchat"
    RAG_NEEDED = "rag_needed"
    DB_QUERY = "db_query"
    ESCALATE = "escalate"
    OBSERVE = "observe"
    RESOLVE = "resolve"

class Sentiment(str, Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    ANGRY = "angry"

class FilterEntry(BaseModel):
    key: str
    value: str

class TriageOutput(BaseModel):
    model_config = {"extra": "forbid"}
    intent: TriageIntent
    sentiment: Sentiment
    metadata_filters: list[FilterEntry] = Field(
        default_factory=list, 
        description="Extracted constraints as list of key-value pairs (e.g. key='os', value='windows')"
    )

class EvalOutput(BaseModel):
    model_config = {"extra": "forbid"}
    reasoning: str = Field(description="Why this score was given")
    context_confidence: float = Field(ge=0.0, le=1.0, description="0.0 to 1.0 confidence")

class ActionEnum(str, Enum):
    create = "create"
    update = "update"
    resolve = "resolve"
    escalate = "escalate"
    none = "none"

class PriorityEnum(str, Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"

class TicketClassification(BaseModel):
    model_config = {"extra": "forbid"}
    reasoning: str
    action: ActionEnum
    title: str = Field(default="", description="Short, descriptive ticket title summarizing the issue (max 10 words)")
    team: str = Field(default="help_desk")
    priority: PriorityEnum = Field(default=PriorityEnum.P3)
    summary: str = Field(default="")
    is_duplicate: bool = Field(default=False)
    duplicate_of: str = Field(default="")


# ── Node 1: Triage ───────────────────────────────────────────────────

async def triage(state: AgentState) -> dict:
    """Classifies the user message intent."""
    start_time = time.time()
    await _notify_ws(state, "Analyzing intent...", "AGENT_ANALYZING")
    llm = _get_fast_llm().with_structured_output(TriageOutput)
    
    user_msg = state["user_message"]
    history_str = format_history(state.get("chat_history_str", ""), state.get("messages", []))
    
    # Fast path: If an Admin has already participated, immediately go to observe mode
    # This prevents the AI from interfering in active Admin conversations.
    if "\nAdmin:" in history_str or history_str.startswith("Admin:"):
        return {
            "intent": "observe",
            "sentiment": "neutral",
            "metadata_filters": {},
            "agent_steps": [{
                "step_type": "triage",
                "tool_name": "system",
                "input": {"user_message": user_msg},
                "output": {"intent": "observe", "reason": "Admin is active in thread"}
            }]
        }
    
    prompt = TRIAGE_PROMPT.format(history=history_str)
    
    messages = [
        SystemMessage(content=prompt),
        HumanMessage(content=user_msg)
    ]
    
    result: TriageOutput = await llm.ainvoke(messages)
    
    # Convert list of entries back to dict for the rest of the flow
    filters_dict = {f.key: f.value for f in result.metadata_filters}
    
    # Log step
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "triage",
        "tool_name": "llm_router",
        "input": {"user_message": user_msg},
        "output": {**result.model_dump(), "duration_ms": int((time.time() - start_time) * 1000)}
    })
    
    return {
        "intent": result.intent.value,
        "sentiment": result.sentiment.value,
        "metadata_filters": filters_dict,
        "agent_steps": agent_steps
    }


# ── Node 2: Retrieval ────────────────────────────────────────────────

async def retrieval(state: AgentState) -> dict:
    """Search KB for relevant articles."""
    start_time = time.time()
    await _notify_ws(state, "Searching Knowledge Base...", "AGENT_SEARCHING_KB")
    from app.services.rag_service import search
    
    user_msg = state["user_message"]
    filters = state.get("metadata_filters", {})
    
    kb_results = search(user_msg, top_k=5, filters=filters)
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "kb_search",
        "tool_name": "search_wiki",
        "input": {"query": user_msg},
        "output": {"results_count": len(kb_results), "top_titles": [r.get("doc_title", "") for r in kb_results[:3]], "duration_ms": int((time.time() - start_time) * 1000)},
    })
    
    return {
        "kb_results": kb_results,
        "agent_steps": agent_steps
    }

# ── Node 3: Tool Execution (DB Query) ───────────────────────────────

async def tool_execution(state: AgentState) -> dict:
    """Placeholder for fetching database info (e.g., ticket status)."""
    start_time = time.time()
    await _notify_ws(state, "Querying Database...", "AGENT_ANALYZING")
    # In a real scenario, this would route to specific functions based on the query.
    # We will simulate returning no specific tool results for now.
    return {
        "tool_results": [],
        "agent_steps": state.get("agent_steps", []) + [{
            "step_type": "tool_execution",
            "tool_name": "db_query",
            "input": {},
            "output": {"duration_ms": int((time.time() - start_time) * 1000)}
        }]
    }


# ── Node 4: Context Evaluation ───────────────────────────────────────

async def evaluate_context(state: AgentState) -> dict:
    """Evaluates if the retrieved context is sufficient."""
    start_time = time.time()
    await _notify_ws(state, "Evaluating retrieved context...", "AGENT_ANALYZING")
    llm = _get_fast_llm().with_structured_output(EvalOutput)
    
    user_msg = state["user_message"]
    context_str = build_context_str(state.get("kb_results", []), state.get("tool_results", []))
    
    prompt = EVALUATOR_PROMPT.format(user_message=user_msg, context=context_str)
    
    result: EvalOutput = await llm.ainvoke([HumanMessage(content=prompt)])
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "evaluation",
        "tool_name": "llm_evaluator",
        "input": {"query": user_msg},
        "output": {**result.model_dump(), "duration_ms": int((time.time() - start_time) * 1000)}
    })
    
    return {
        "context_confidence": result.context_confidence,
        "agent_steps": agent_steps
    }


# ── Node 5: Draft Resolution ─────────────────────────────────────────

async def draft_resolution(state: AgentState) -> dict:
    """Drafts the response strictly based on context."""
    start_time = time.time()
    await _notify_ws(state, "Drafting response...", "AGENT_TYPING")
    llm = _get_llm()
    
    history_str = format_history(state.get("chat_history_str", ""), state.get("messages", []))
    context_str = build_context_str(state.get("kb_results", []), state.get("tool_results", []))
    
    prompt = DRAFTING_PROMPT.format(context=context_str, history=history_str)
    
    messages = [
        SystemMessage(content=prompt),
        HumanMessage(content=state["user_message"])
    ]
    
    result = await llm.ainvoke(messages)
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "drafting",
        "tool_name": "llm_writer",
        "input": {"context_length": len(context_str)},
        "output": {"reply_length": len(result.content), "duration_ms": int((time.time() - start_time) * 1000)}
    })
    
    return {
        "reply": result.content,
        "agent_steps": agent_steps
    }


# ── Node 6: Ticket Action & Classification ───────────────────────────

async def ticket_action(state: AgentState) -> dict:
    """Determines what DB action to take (create, update, etc)."""
    start_time = time.time()
    await _notify_ws(state, "Finalizing ticket actions...", "AGENT_ANALYZING")
    llm = _get_fast_llm().with_structured_output(TicketClassification)
    
    history_str = format_history(state.get("chat_history_str", ""), state.get("messages", []))
    reply_text = state.get("reply", "")
    
    prompt = CLASSIFICATION_PROMPT.format(history=history_str, reply=reply_text)
    
    result: TicketClassification = await llm.ainvoke([HumanMessage(content=prompt)])
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "classification",
        "tool_name": "llm_classifier",
        "input": {"reply": reply_text},
        "output": {**result.model_dump(), "duration_ms": int((time.time() - start_time) * 1000)}
    })
    
    t_action = {
        "action": result.action.value,
        "title": result.title,
        "team": result.team,
        "priority": result.priority.value,
        "summary": result.summary
    }
    
    return {
        "ticket_action": t_action,
        "is_duplicate": result.is_duplicate,
        "duplicate_of": result.duplicate_of,
        "agent_steps": agent_steps
    }


# ── Node 7: Escalate ─────────────────────────────────────────────────

async def escalate(state: AgentState) -> dict:
    """Explicit escalation to a human."""
    await _notify_ws(state, "Escalating to human agent...", "AGENT_TYPING")
    
    # Check if history already has Admin or Human Support
    history = state.get("chat_history_str", "").lower()
    if "admin:" in history or "human support:" in history or "admin" in history:
        reply = "A human support agent is already assisting you. I am here to observe and provide technical data if needed."
    else:
        reply = "I understand this is frustrating. I am escalating this ticket to a human agent who will assist you shortly."
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "escalation",
        "tool_name": "system",
        "input": {"reason": "Low confidence or explicit escalation"},
        "output": {"action": "assigned to human"}
    })
    
    # We NO LONGER set ticket_action here. 
    # We let the graph flow into 'ticket_action' node for professional routing.
    return {
        "reply": reply,
        "agent_steps": agent_steps
    }

async def observe(state: AgentState) -> dict:
    """Silent observation mode when human is assisting."""
    await _notify_ws(state, "Observing human interaction...", "AGENT_OBSERVING")
    
    # Check if the user is explicitly thanking the admin
    history = state.get("chat_history_str", "").lower()
    user_msg = state["user_message"].lower()
    
    # If the user is thanking us/admin, be polite.
    is_thanks = any(x in user_msg for x in ["thank", "tanks", "ok", "done", "appreciate", "good", "worked"])
    
    if is_thanks:
        reply = "You're very welcome! I'm glad we could help. Please let us know if there's anything else you need!"
    elif "will answer soon" not in history:
        reply = "A human agent will answer soon."
        
    return {
        "reply": reply, 
        "ticket_action": {"action": "none"},
        "agent_steps": state.get("agent_steps", [])
    }


# ── Node 8: Quick Respond ────────────────────────────────────────────

async def quick_respond(state: AgentState) -> dict:
    """Responds to chitchat without RAG."""
    await _notify_ws(state, "Replying...", "AGENT_TYPING")
    llm = _get_fast_llm()
    
    messages = [
        SystemMessage(content="You are a polite AI assistant. The user just sent a greeting or pleasantry. Respond briefly and politely, then ask how you can help them with their IT/business support needs today."),
        HumanMessage(content=state["user_message"])
    ]
    
    result = await llm.ainvoke(messages)
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "quick_respond",
        "tool_name": "llm_writer",
        "input": {"type": "chitchat"},
        "output": {"reply": result.content}
    })
    
    t_action = {"action": "none"}
    
    return {
        "reply": result.content,
        "ticket_action": t_action,
        "agent_steps": agent_steps
    }
async def handle_resolution(state: AgentState) -> dict:
    """Responds to user confirmation and sets resolution action."""
    await _notify_ws(state, "Closing ticket...", "AGENT_TYPING")
    
    # Check if we should be extra friendly
    user_msg = state["user_message"].lower()
    if any(x in user_msg for x in ["thank", "tanks", "appreciate", "worked", "fixed"]):
        reply = "You're very welcome! I'm absolutely glad to help. I'll go ahead and mark this as resolved for you. If anything else comes up, don't hesitate to reach out!"
    else:
        reply = "I'm glad your issue is resolved! I'll go ahead and close this ticket now. Feel free to start a new chat if you need further assistance."
    
    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "decision",
        "tool_name": "system",
        "input": {"reason": "User confirmed resolution"},
        "output": {"action": "resolve"}
    })
    
    return {
        "reply": reply,
        "agent_steps": agent_steps
    }
