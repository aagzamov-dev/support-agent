"""LangGraph StateGraph — support agent flow."""

from langgraph.graph import END, StateGraph

from app.agent.nodes import understand, respond
from app.agent.state import AgentState

_graph = StateGraph(AgentState)
_graph.add_node("understand", understand)
_graph.add_node("respond", respond)

_graph.set_entry_point("understand")
_graph.add_edge("understand", "respond")
_graph.add_edge("respond", END)

agent_graph = _graph.compile()


async def run_support_agent(user_message: str, ticket_id: str = "", channel: str = "chat", past_history: str = "") -> dict:
    """Run the support agent. Returns {reply, ticket_action, agent_steps, kb_results}."""
    initial: AgentState = {
        "ticket_id": ticket_id,
        "user_message": user_message,
        "channel": channel,
        "chat_history_str": past_history,
        "messages": [],
        "kb_results": [],
        "agent_steps": [],
        "reply": "",
        "ticket_action": {"action": "none"},
    }
    final = await agent_graph.ainvoke(initial)
    return {
        "reply": final.get("reply", ""),
        "ticket_action": final.get("ticket_action", {}),
        "agent_steps": final.get("agent_steps", []),
        "kb_results": final.get("kb_results", []),
    }
