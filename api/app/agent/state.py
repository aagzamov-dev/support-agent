"""Agent state for the support desk agent."""

from __future__ import annotations
from typing import Annotated, TypedDict, Any
from langgraph.graph import add_messages


class AgentState(TypedDict):
    ticket_id: str
    user_message: str
    channel: str
    chat_history_str: str
    messages: Annotated[list, add_messages]  # LLM conversation
    
    # Classification & Routing
    intent: str             # e.g., chitchat, rag_needed, db_query, escalate
    sentiment: str          # e.g., positive, neutral, negative, angry
    metadata_filters: dict  # Extracted constraints (os, device, etc)
    
    # Execution State
    kb_results: list
    tool_results: list
    context_confidence: float # 0.0 to 1.0
    
    # Audit & Final Output
    agent_steps: list       # recorded tool calls for admin view
    reply: str              # final text reply
    ticket_action: dict     # {action: create|update|resolve|escalate|none, team, priority, title, ...}
    is_duplicate: bool
    duplicate_of: str
