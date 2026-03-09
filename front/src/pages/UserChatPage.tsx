import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sendMessage, transcribeVoice, sendFeedback } from '../api/chat';
import { getTicket, listUserTickets } from '../api/tickets';
import { formatDate } from '../lib/utils';

interface ChatMsg {
    id: string | number;
    role: 'user' | 'agent' | 'system' | 'admin';
    content: string;
    ticket?: Record<string, unknown> | null;
}

export default function UserChatPage() {
    const [messages, setMessages] = useState<ChatMsg[]>([
        { id: 0, role: 'agent', content: "Hello! 👋 I'm your support assistant. How can I help you today?\n\nYou can ask me about:\n• Laptop or software issues\n• VPN or network problems\n• Account & password help\n• Sales & licensing questions\n• Security concerns" },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [recording, setRecording] = useState(false);
    const [mediaRec, setMediaRec] = useState<MediaRecorder | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Continuous Context
    const [activeTicket, setActiveTicket] = useState<Record<string, unknown> | null>(null);
    const [isResolved, setIsResolved] = useState(false);
    const [feedbackGiven, setFeedbackGiven] = useState(false);

    // Auth Hack
    const [sessionId] = useState(() => {
        let sid = localStorage.getItem('demo_session_id');
        if (!sid) { sid = 'user_' + Math.random().toString(36).substring(2, 9); localStorage.setItem('demo_session_id', sid); }
        return sid;
    });

    const { data: userHistory, refetch: refetchHistory } = useQuery({
        queryKey: ['userTickets', sessionId],
        queryFn: () => listUserTickets(sessionId)
    });

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isResolved]);

    // Connect to WebSocket room when a ticket becomes active
    useEffect(() => {
        if (!activeTicket?.id) return;
        const ws = new WebSocket(`ws://localhost:8000/api/ws/chat/${activeTicket.id}`);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "new_message") {
                    const m = data.message;
                    setMessages(prev => {
                        // Prevent duplicates
                        if (prev.some(x => x.id === m.id)) return prev;
                        return [...prev, { id: m.id, role: m.role as any, content: m.content }];
                    });
                } else if (data.type === "ticket_update") {
                    if (data.ticket.status === 'resolved') setIsResolved(true);
                    refetchHistory();
                }
            } catch (e) {
                console.error("WS Parse error", e);
            }
        };

        return () => ws.close();
    }, [activeTicket?.id, refetchHistory]);

    const handleNewChat = () => {
        setActiveTicket(null);
        setIsResolved(false);
        setFeedbackGiven(false);
        setMessages([{ id: Date.now(), role: 'agent', content: "Hello! 👋 I'm your support assistant. Let's get started on a new issue. What can I help you with?" }]);
    };

    const loadTicket = async (ticketId: string) => {
        setLoading(true);
        try {
            const t = await getTicket(ticketId);
            setActiveTicket(t);
            setIsResolved(t.status === 'resolved');
            setFeedbackGiven(!!t.feedback_score);

            const dbMessages = (t.messages || []).map((m: any) => ({
                id: m.id, role: m.role, content: m.content
            }));

            setMessages([{ id: 0, role: 'agent', content: "Loading history..." }, ...dbMessages]);
        } catch {
            alert('Failed to load ticket.');
        }
        setLoading(false);
    };

    const send = async () => {
        if (!input.trim() || loading || isResolved) return;
        const text = input.trim();
        setInput('');
        const userMsg: ChatMsg = { id: Date.now(), role: 'user', content: text };
        setMessages((m) => [...m, userMsg]);
        setLoading(true);
        try {
            const ticketId = (activeTicket?.id as string) || '';
            // Pass session_id inside message or adjust backend to infer.
            // For now activeTicket dictates context.
            const res = await sendMessage(text, 'chat', ticketId, sessionId);

            if (res.ticket) {
                setActiveTicket(res.ticket);
                if (res.ticket.status === 'resolved') setIsResolved(true);
                refetchHistory();
            }

            const agentMsg: ChatMsg = {
                id: res.message_id || Date.now() + 1,
                role: 'agent',
                content: res.reply,
                ticket: !activeTicket && res.ticket ? res.ticket : null
            };
            setMessages((m) => {
                if (res.message_id && m.some(x => x.id === res.message_id)) {
                    return m.map(x => x.id === res.message_id ? { ...agentMsg, ticket: agentMsg.ticket || x.ticket } : x);
                }
                return [...m, agentMsg];
            });

        } catch {
            setMessages((m) => [...m, { id: Date.now() + 1, role: 'system', content: '❌ Failed to get response. Please try again.' }]);
        }
        setLoading(false);
    };

    const startRec = async () => {
        if (isResolved) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream);
            const chunks: BlobPart[] = [];
            mr.ondataavailable = (e) => chunks.push(e.data);
            mr.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(chunks, { type: 'audio/webm' });
                setLoading(true);
                try {
                    const ticketId = (activeTicket?.id as string) || '';
                    const res = await transcribeVoice(blob, ticketId, sessionId);

                    if (res.ticket) {
                        setActiveTicket(res.ticket);
                        if (res.ticket.status === 'resolved') setIsResolved(true);
                        refetchHistory();
                    }

                    // Audio transcript represents user input
                    setMessages((m) => [
                        ...m,
                        { id: Date.now(), role: 'user', content: `🎤 ${res.transcript}` }
                    ]);

                    const agentMsg: ChatMsg = {
                        id: res.message_id || Date.now() + 1,
                        role: 'agent',
                        content: res.reply,
                        ticket: !activeTicket && res.ticket ? res.ticket : null
                    };
                    setMessages((m) => {
                        if (res.message_id && m.some(x => x.id === res.message_id)) {
                            return m.map(x => x.id === res.message_id ? { ...agentMsg, ticket: agentMsg.ticket || x.ticket } : x);
                        }
                        return [...m, agentMsg];
                    });
                } catch {
                    setMessages((m) => [...m, { id: Date.now(), role: 'system', content: '❌ Voice transcription failed.' }]);
                }
                setLoading(false);
            };
            mr.start();
            setMediaRec(mr);
            setRecording(true);
        } catch {
            alert('Microphone access denied');
        }
    };

    const stopRec = () => { mediaRec?.stop(); setRecording(false); };

    const handleFeedback = async (score: number) => {
        if (!activeTicket) return;
        try {
            await sendFeedback(activeTicket.id as string, score, '');
            setFeedbackGiven(true);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: 'calc(100vh - 56px - 48px)', gap: 1 }}>

            {/* Sidebar: History */}
            <div style={{ background: 'var(--bg-card)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>My Tickets</span>
                    <button className="btn btn-secondary btn-sm" onClick={handleNewChat}>+ New Chat</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                    {(userHistory?.tickets || []).map((t: any) => (
                        <div key={t.id}
                            onClick={() => loadTicket(t.id)}
                            style={{
                                padding: '10px 12px',
                                marginBottom: 6,
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                background: activeTicket?.id === t.id ? 'var(--bg-input)' : 'transparent',
                                borderLeft: activeTicket?.id === t.id ? '3px solid var(--accent)' : '3px solid transparent'
                            }}>
                            <div className="flex justify-between items-center mb-1">
                                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{t.id}</span>
                                <span className={`badge ${t.status === 'resolved' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>{t.status}</span>
                            </div>
                            <div className="text-xs text-muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title || 'Support Request'}</div>
                            <div className="text-xs text-muted" style={{ marginTop: 4 }}>{formatDate(t.created_at)}</div>
                        </div>
                    ))}
                    {!userHistory?.tickets?.length && (
                        <div className="p-4 text-center text-sm text-muted">No tickets yet. Start a chat!</div>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-secondary)' }}>
                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
                    {activeTicket && (
                        <div style={{ textAlign: 'center', margin: '20px 0', padding: 10, background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)' }}>
                            <span className="text-sm font-bold">Currently Viewing: {activeTicket.id as string}</span>
                        </div>
                    )}
                    {messages.map((msg) => (
                        <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', padding: '10px 0' }}>
                            <div style={{
                                maxWidth: '70%',
                                padding: '12px 16px',
                                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                background: msg.role === 'user' ? 'var(--accent)' : msg.role === 'admin' ? 'var(--warning-light)' : msg.role === 'system' ? 'var(--danger)' : 'var(--bg-card)',
                                color: msg.role === 'user' ? '#fff' : 'var(--text)',
                                border: (msg.role === 'agent' || msg.role === 'admin') ? '1px solid var(--border)' : 'none',
                                whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                            }}>
                                {msg.role === 'admin' && <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 4, color: 'var(--warning)' }}>👤 Human Support</div>}
                                {msg.content}
                                {msg.ticket && (
                                    <div style={{
                                        marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                                        background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                                    }}>
                                        <span style={{ fontWeight: 600, color: 'var(--success)' }}>🎫 Ticket Created</span>
                                        <div className="text-sm" style={{ marginTop: 4 }}>
                                            <strong>{msg.ticket.id as string}</strong> · {msg.ticket.team as string} · {msg.ticket.priority as string}
                                        </div>
                                        <div className="text-xs text-muted">{msg.ticket.title as string}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div style={{ display: 'flex', padding: '4px 0' }}>
                            <div style={{ padding: '12px 16px', borderRadius: '16px 16px 16px 4px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                                <div className="flex items-center gap-2"><div className="spinner" /> <span className="text-sm text-muted">Thinking...</span></div>
                            </div>
                        </div>
                    )}

                    {isResolved && !feedbackGiven && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                            <div style={{ padding: '20px', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--success)', textAlign: 'center' }}>
                                <h3 style={{ margin: '0 0 10px 0', color: 'var(--success)' }}>Issue Resolved</h3>
                                <p style={{ margin: '0 0 15px 0', fontSize: '0.9rem' }}>How was your support experience?</p>
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                                    {[1, 2, 3, 4, 5].map(score => (
                                        <button key={score} onClick={() => handleFeedback(score)} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
                                            {score} ⭐️
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {feedbackGiven && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                            <div style={{ padding: '12px 20px', borderRadius: 'var(--radius-md)', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)' }}>
                                Thank you for your feedback! The chat is now closed.
                            </div>
                        </div>
                    )}

                    <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', padding: 16, background: 'var(--bg-card)' }}>
                    <div className="flex gap-2">
                        <button className={`btn ${recording ? 'btn-danger' : 'btn-secondary'} btn-icon`} onClick={recording ? stopRec : startRec} title="Voice input" disabled={isResolved}>
                            {recording ? '⏹' : '🎤'}
                        </button>
                        <input
                            className="form-input w-full"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                            placeholder={isResolved ? "This ticket has been resolved. Click + New Chat to start over." : "Type your message..."}
                            disabled={loading || isResolved}
                            style={{ fontSize: '0.95rem', padding: '10px 14px' }}
                        />
                        <button className="btn btn-primary" onClick={send} disabled={!input.trim() || loading || isResolved}>Send</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
