"""LangGraph nodes for the support agent."""

from __future__ import annotations

import json
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from app.agent.prompts import build_system_prompt
from app.agent.state import AgentState
from app.core.config import settings


def _get_llm():
    return ChatOpenAI(
        model=settings.LLM_MODEL,
        temperature=settings.LLM_TEMPERATURE,
        api_key=settings.OPENAI_API_KEY,
    )


# ── Structured output for ticket decisions ─────────────────────────────

class TicketDecision(BaseModel):
    action: str = Field(description="Action to take: 'create' for new issue, 'update' for ongoing issue, 'resolve' if fixed, or 'none'")
    title: str = Field(default="", description="Short ticket title")
    team: str = Field(default="help_desk", description="Team: help_desk, devops, sales, network, security")
    priority: str = Field(default="P3", description="Priority: P1, P2, P3, P4")
    reply: str = Field(description="Friendly reply message to the user")
    summary: str = Field(default="", description="Brief internal summary for the ticket")


# ── Node 1: understand ─────────────────────────────────────────────────

async def understand(state: AgentState) -> dict:
    """Search KB for relevant articles based on user message."""
    from app.services.rag_service import search

    user_msg = state["user_message"]
    kb_results = []
    agent_steps = list(state.get("agent_steps", []))

    try:
        kb_results = search(user_msg, top_k=5)
        agent_steps.append({
            "step_type": "kb_search",
            "tool_name": "search_wiki",
            "input": {"query": user_msg},
            "output": {"results_count": len(kb_results), "top_titles": [r.get("doc_title", "") for r in kb_results[:3]]},
        })
    except Exception:
        pass

    # Build conversation history from existing messages
    history = state.get("chat_history_str", "")
    if history:
        history += "\n--- Current Session ---\n"
    for m in state.get("messages", []):
        if hasattr(m, "content"):
            role = getattr(m, "type", "human")
            history += f"{role}: {m.content}\n"

    system_content = build_system_prompt(kb_results, history)

    return {
        "kb_results": kb_results,
        "agent_steps": agent_steps,
        "messages": [
            SystemMessage(content=system_content),
            HumanMessage(content=user_msg),
        ],
    }


# ── Node 2: respond ───────────────────────────────────────────────────

async def respond(state: AgentState) -> dict:
    """LLM generates reply + ticket decision."""
    llm = _get_llm().with_structured_output(TicketDecision)

    decision: TicketDecision = await llm.ainvoke(state["messages"])

    agent_steps = list(state.get("agent_steps", []))
    agent_steps.append({
        "step_type": "decision",
        "tool_name": "llm",
        "input": {"user_message": state["user_message"]},
        "output": decision.model_dump(),
    })

    ticket_action = {"action": decision.action}
    if decision.action != "none":
        ticket_action = {
            "action": decision.action,
            "title": decision.title,
            "team": decision.team,
            "priority": decision.priority,
            "summary": decision.summary,
        }

    return {
        "reply": decision.reply,
        "ticket_action": ticket_action,
        "agent_steps": agent_steps,
    }
