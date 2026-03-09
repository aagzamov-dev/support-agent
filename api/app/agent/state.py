"""Agent state for the support desk agent."""

from __future__ import annotations
from typing import Annotated, TypedDict
from langgraph.graph import add_messages


class AgentState(TypedDict):
    ticket_id: str
    user_message: str
    channel: str
    chat_history_str: str
    messages: Annotated[list, add_messages]  # LLM conversation
    kb_results: list
    agent_steps: list       # recorded tool calls for admin view
    reply: str              # final text reply
    ticket_action: dict     # {action: create|update|resolve|none, team, priority, title, ...}
