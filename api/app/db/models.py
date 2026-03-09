"""Database models — Ticket, Message, AgentStep."""

from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    team = Column(String, nullable=False, default="help_desk")  # help_desk, devops, sales, network, security
    priority = Column(String, nullable=False, default="P3")     # P1, P2, P3, P4
    status = Column(String, nullable=False, default="open")     # open, in_progress, resolved, closed
    created_by = Column(String, default="user")
    assigned_to = Column(String, default="")
    summary = Column(Text, default="")
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    feedback_score = Column(Integer, nullable=True)     # e.g. 1 to 5
    feedback_text = Column(Text, nullable=True)

    messages = relationship("Message", back_populates="ticket", order_by="Message.created_at")
    agent_steps = relationship("AgentStep", back_populates="ticket", order_by="AgentStep.created_at")


class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True)
    ticket_id = Column(String, ForeignKey("tickets.id"), nullable=False)
    role = Column(String, nullable=False)     # user, agent, system
    content = Column(Text, nullable=False)
    channel = Column(String, default="chat")  # chat, voice, email
    metadata_json = Column(Text, default="{}")
    created_at = Column(DateTime)

    ticket = relationship("Ticket", back_populates="messages")


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id = Column(String, primary_key=True)
    ticket_id = Column(String, ForeignKey("tickets.id"), nullable=False)
    step_type = Column(String, nullable=False)  # kb_search, tool_call, reasoning, decision, ticket_action
    tool_name = Column(String, default="")
    input_data = Column(Text, default="{}")
    output_data = Column(Text, default="{}")
    created_at = Column(DateTime)

    ticket = relationship("Ticket", back_populates="agent_steps")
