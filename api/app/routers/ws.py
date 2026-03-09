"""WebSocket /ws — realtime event broadcasting."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.event_bus import event_bus
from app.core.websockets import manager as chat_manager

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Manages WebSocket connections and subscriptions."""

    def __init__(self) -> None:
        self._connections: dict[WebSocket, set[str]] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[ws] = set()
        await ws.send_json({
            "type": "connected",
            "ts": datetime.now(timezone.utc).isoformat(),
        })

    def disconnect(self, ws: WebSocket) -> None:
        subs = self._connections.pop(ws, set())
        for inc_id in subs:
            event_bus.unsubscribe(inc_id, self._make_callback(ws))

    async def subscribe(self, ws: WebSocket, incident_id: str) -> None:
        self._connections.setdefault(ws, set()).add(incident_id)
        cb = self._make_callback(ws)
        event_bus.subscribe(incident_id, cb)
        await ws.send_json({"type": "ok", "ref": "sub", "incident_id": incident_id})

    async def unsubscribe(self, ws: WebSocket, incident_id: str) -> None:
        subs = self._connections.get(ws, set())
        subs.discard(incident_id)
        event_bus.unsubscribe(incident_id, self._make_callback(ws))
        await ws.send_json({"type": "ok", "ref": "unsub", "incident_id": incident_id})

    def _make_callback(self, ws: WebSocket):
        async def _cb(event: dict) -> None:
            try:
                await ws.send_json({"type": "event", "event": event})
            except Exception:
                pass  # connection may be closed
        # Store reference on ws for unsubscribe matching
        key = f"_cb_{id(ws)}"
        if not hasattr(ws, key):
            setattr(ws, key, _cb)
        return getattr(ws, key)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "msg": "Invalid JSON"})
                continue

            msg_type = msg.get("type", "")

            if msg_type == "sub":
                inc_id = msg.get("incident_id", "")
                if inc_id:
                    await manager.subscribe(ws, inc_id)
                else:
                    await ws.send_json({"type": "error", "msg": "Missing incident_id"})

            elif msg_type == "unsub":
                inc_id = msg.get("incident_id", "")
                if inc_id:
                    await manager.unsubscribe(ws, inc_id)

            elif msg_type == "ping":
                await ws.send_json({"type": "pong"})

            else:
                await ws.send_json({"type": "error", "msg": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        manager.disconnect(ws)


@router.websocket("/api/ws/chat/{ticket_id}")
async def websocket_chat_endpoint(websocket: WebSocket, ticket_id: str):
    await chat_manager.connect(websocket, ticket_id)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        chat_manager.disconnect(websocket, ticket_id)

