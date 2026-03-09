"""WebSocket connection manager for real-time ticket updates."""

from typing import Dict, List
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # Maps ticket_id to a list of active WebSocket connections
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, ticket_id: str):
        await websocket.accept()
        if ticket_id not in self.active_connections:
            self.active_connections[ticket_id] = []
        self.active_connections[ticket_id].append(websocket)

    def disconnect(self, websocket: WebSocket, ticket_id: str):
        if ticket_id in self.active_connections and websocket in self.active_connections[ticket_id]:
            self.active_connections[ticket_id].remove(websocket)
            if not self.active_connections[ticket_id]:
                del self.active_connections[ticket_id]

    async def broadcast_to_ticket(self, ticket_id: str, message: dict):
        if ticket_id in self.active_connections:
            for connection in self.active_connections[ticket_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass


manager = ConnectionManager()
