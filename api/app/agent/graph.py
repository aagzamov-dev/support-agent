"""LangGraph StateGraph — support agent flow."""

from langgraph.graph import END, StateGraph

from app.agent.nodes import (
    triage,
    retrieval,
    tool_execution,
    evaluate_context,
    draft_resolution,
    ticket_action,
    escalate,
    quick_respond,
    observe,
    handle_resolution
)
from app.agent.state import AgentState

EVAL_THRESHOLD = 0.4 # Default threshold for context confidence

_graph = StateGraph(AgentState)

# Add all nodes
_graph.add_node("triage", triage)
_graph.add_node("retrieval", retrieval)
_graph.add_node("tool_execution", tool_execution)
_graph.add_node("evaluate_context", evaluate_context)
_graph.add_node("draft_resolution", draft_resolution)
_graph.add_node("ticket_action", ticket_action)
_graph.add_node("escalate", escalate)
_graph.add_node("quick_respond", quick_respond)
_graph.add_node("observe", observe)
_graph.add_node("handle_resolution", handle_resolution)

# Entry point
_graph.set_entry_point("triage")

# Triage Router
def triage_router(state: AgentState) -> str:
    intent = state.get("intent", "rag_needed")
    if intent == "chitchat":
        return "quick_respond"
    elif intent == "db_query":
        return "tool_execution"
    elif intent == "escalate":
        return "escalate"
    elif intent == "observe":
        return "observe"
    elif intent == "resolve":
        return "handle_resolution"
    else:
        return "retrieval"

_graph.add_conditional_edges("triage", triage_router)

# Data gathering merges into evaluation
_graph.add_edge("retrieval", "evaluate_context")
_graph.add_edge("tool_execution", "evaluate_context")

# Evaluation Router
def eval_router(state: AgentState) -> str:
    conf = state.get("context_confidence", 0.0)
    if conf < EVAL_THRESHOLD:
        # If we can't answer it, escalate
        return "escalate"
    return "draft_resolution"

_graph.add_conditional_edges("evaluate_context", eval_router)

# Drafting -> Action
_graph.add_edge("draft_resolution", "ticket_action")

# End nodes or logical progression
_graph.add_edge("ticket_action", END)
_graph.add_edge("quick_respond", END)
_graph.add_edge("observe", END)

# These nodes now flow into ticket_action for professional routing
_graph.add_edge("escalate", "ticket_action")
_graph.add_edge("handle_resolution", "ticket_action")

agent_graph = _graph.compile()


async def run_support_agent(
    user_message: str, 
    ticket_id: str = "", 
    channel: str = "chat", 
    past_history: str = "",
    is_duplicate: bool = False,
    duplicate_of: str = ""
) -> dict:
    """Run the support agent. Returns {reply, ticket_action, agent_steps, kb_results}."""
    initial: AgentState = {
        "ticket_id": ticket_id,
        "user_message": user_message,
        "channel": channel,
        "chat_history_str": past_history,
        "messages": [],
        "intent": "rag_needed",
        "sentiment": "neutral",
        "metadata_filters": {},
        "kb_results": [],
        "tool_results": [],
        "context_confidence": 0.0,
        "agent_steps": [],
        "reply": "",
        "ticket_action": {"action": "none"},
        "is_duplicate": is_duplicate,
        "duplicate_of": duplicate_of
    }
    
    final = await agent_graph.ainvoke(initial)
    
    return {
        "reply": final.get("reply", ""),
        "ticket_action": final.get("ticket_action", {}),
        "agent_steps": final.get("agent_steps", []),
        "kb_results": final.get("kb_results", []),
    }
