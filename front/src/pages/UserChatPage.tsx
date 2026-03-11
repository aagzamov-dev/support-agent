import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sendMessage, transcribeVoice, sendFeedback } from '../api/chat';
import { getTicket, listUserTickets, createTicket } from '../api/tickets';
import { formatDate } from '../lib/utils';
import AudioRecorder from '../components/AudioRecorder';
import { MessageSquare, Mic } from 'lucide-react';

interface ChatMsg {
    id: string | number;
    role: 'user' | 'agent' | 'system' | 'admin';
    content: string;
    ticket?: Record<string, unknown> | null;
    audio_url?: string | null;
}

export default function UserChatPage() {
    const [messages, setMessages] = useState<ChatMsg[]>([
        { id: 0, role: 'agent', content: "Hello! 👋 I'm your support assistant. How can I help you today?\n\nYou can ask me about:\n• Laptop or software issues\n• VPN or network problems\n• Account & password help\n• Sales & licensing questions\n• Security concerns" },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Continuous Context
    const [activeTicket, setActiveTicket] = useState<Record<string, unknown> | null>(null);
    const [isResolved, setIsResolved] = useState(false);
    const [feedbackGiven, setFeedbackGiven] = useState(false);
    const [agentStatus, setAgentStatus] = useState<string | null>(null);

    // New Ticket Modal State
    const [showNewModal, setShowNewModal] = useState(false);
    const [newTicketChannel, setNewTicketChannel] = useState<'chat' | 'email' | 'voice'>('chat');

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
                    setAgentStatus(null);
                    const m = data.message;
                    setMessages(prev => {
                        // Prevent duplicates
                        if (prev.some(x => x.id === m.id)) return prev;
                        return [...prev, { id: m.id, role: m.role as any, content: m.content }];
                    });
                } else if (data.type === "ticket_update") {
                    if (data.ticket.status === 'resolved') setIsResolved(true);
                    refetchHistory();
                } else if (data.type?.startsWith("AGENT_")) {
                    setAgentStatus(data.message);
                }
            } catch (e) {
                console.error("WS Parse error", e);
            }
        };

        return () => ws.close();
    }, [activeTicket?.id, refetchHistory]);

    const handleNewChatClick = () => {
        setShowNewModal(true);
    };

    const handleCreateTicket = async () => {
        setShowNewModal(false);
        setLoading(true);
        try {
            const t = await createTicket("New Support Request", newTicketChannel, sessionId);
            setActiveTicket(t);
            setIsResolved(false);
            setFeedbackGiven(false);

            let welcome = "Hello! 👋 I'm your support assistant. Let's get started on a new issue. What can I help you with?";
            if (newTicketChannel === 'email') welcome = "Subject: Open Support Ticket\n\nPlease reply with the details of your request in an email format.";
            if (newTicketChannel === 'voice') welcome = "Voice mode active. Please click the microphone to send your request.";

            setMessages([{ id: Date.now(), role: 'agent', content: welcome }]);
            refetchHistory(); // Instantly shows in sidebar
        } catch {
            alert('Failed to create ticket instantly.');
        }
        setLoading(false);
    };

    const loadTicket = async (ticketId: string) => {
        setLoading(true);
        try {
            const t = await getTicket(ticketId);
            setActiveTicket(t);
            setIsResolved(t.status === 'resolved');
            setFeedbackGiven(!!t.feedback_score);

            const dbMessages = (t.messages || []).map((m: any) => ({
                id: m.id, role: m.role, content: m.content, audio_url: m.metadata?.audio_url
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
        setAgentStatus("Thinking...");
        try {
            const ticketId = (activeTicket?.id as string) || '';
            // Pass session_id inside message or adjust backend to infer.
            // For now activeTicket dictates context.
            const res = await sendMessage(text, activeTicket?.channel as string || 'chat', ticketId, sessionId);

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
        setAgentStatus(null);
    };

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
        <div style={{
            display: 'grid',
            gridTemplateColumns: '300px 1fr',
            height: 'calc(100vh - 56px)',
            background: 'var(--bg-primary)',
            position: 'absolute',
            top: 56,
            left: 240,
            right: 0,
            bottom: 0
        }}>

            {/* Sidebar: History */}
            <div style={{ background: 'var(--bg-card)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 style={{ margin: 0 }}>Support Tickets</h3>
                        <button className="btn btn-primary btn-sm" onClick={handleNewChatClick}>+ New Chat</button>
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column' }}>
                    {(userHistory?.tickets || []).filter((t: any) => t.channel !== 'email').map((t: any) => (
                        <div key={t.id}
                            onClick={() => loadTicket(t.id)}
                            style={{
                                padding: '12px 14px',
                                marginBottom: 8,
                                borderRadius: 'var(--radius)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                background: activeTicket?.id === t.id ? 'var(--accent-glow)' : 'rgba(255,255,255,0.03)',
                                border: activeTicket?.id === t.id ? '1px solid var(--accent)' : '1px solid transparent',
                                boxShadow: activeTicket?.id === t.id ? 'var(--shadow-glow)' : 'none'
                            }}>
                            <div className="flex justify-between items-center mb-1">
                                <span style={{ fontWeight: 700, fontSize: '0.75rem', color: activeTicket?.id === t.id ? 'var(--accent)' : 'var(--text-secondary)' }}>{t.id}</span>
                                <span className={`badge ${t.status === 'resolved' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.6rem' }}>{t.status}</span>
                            </div>
                            <div className="text-sm font-medium truncate" style={{ color: activeTicket?.id === t.id ? 'var(--text)' : 'var(--text-secondary)' }}>{t.title || 'Support Request'}</div>
                            <div className="text-xs text-muted mt-2">{formatDate(t.created_at)}</div>
                        </div>
                    ))}
                    {!userHistory?.tickets?.length && (
                        <div className="p-8 text-center text-sm text-muted">
                            <span style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }}>💬</span>
                            No tickets yet.<br />Start a chat today!
                        </div>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                    {activeTicket && (
                        <div style={{ textAlign: 'center', marginBottom: 32 }}>
                            <span style={{
                                padding: '6px 16px',
                                background: 'var(--bg-card)',
                                borderRadius: '20px',
                                border: '1px solid var(--border)',
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)'
                            }}>
                                Active Ticket: <strong>{activeTicket.id as string}</strong>
                            </span>
                        </div>
                    )}

                    <div className="flex flex-col gap-6">
                        {messages.map((msg) => (
                            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                <div className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble-user' : msg.role === 'admin' ? 'chat-bubble-admin' : 'chat-bubble-agent'}`}>
                                    {msg.role === 'admin' && <div style={{ fontWeight: 700, fontSize: '0.7rem', color: 'var(--warning)', marginBottom: 4, textTransform: 'uppercase' }}>🛡️ Human Agent</div>}
                                    {msg.content}
                                    {msg.audio_url && (
                                        <div style={{ marginTop: 8 }}>
                                            <audio src={msg.audio_url.startsWith('http') ? msg.audio_url : `http://localhost:8000${msg.audio_url.startsWith('/') ? '' : '/'}${msg.audio_url}`} controls style={{ height: 36, width: '100%', maxWidth: 240, borderRadius: 18, filter: msg.role === 'user' ? 'invert(1)' : 'none' }} />
                                        </div>
                                    )}
                                    {msg.ticket && (
                                        <div style={{
                                            marginTop: 12, padding: '12px', borderRadius: 'var(--radius-sm)',
                                            background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                <span style={{ fontSize: '1.2rem' }}>🎫</span>
                                                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Ticket Created</span>
                                            </div>
                                            <div className="text-xs font-mono" style={{ opacity: 0.8 }}>
                                                {msg.ticket.id as string} · {msg.ticket.team as string} · {msg.ticket.priority as string}
                                            </div>
                                            <div className="text-xs mt-1" style={{ opacity: 0.7 }}>{msg.ticket.title as string}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {loading && (
                        <div className="mt-4">
                            <div className="agent-status-tag">
                                <div className="spinner" />
                                <span>{agentStatus || "Thinking..."}</span>
                            </div>
                        </div>
                    )}

                    {isResolved && !feedbackGiven && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                            <div style={{ padding: '32px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', border: '1px solid var(--success)', textAlign: 'center', boxShadow: 'var(--shadow-lg)' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🏁</div>
                                <h2 style={{ margin: '0 0 8px 0', color: 'var(--success)' }}>Issue Resolved</h2>
                                <p style={{ margin: '0 0 24px 0', color: 'var(--text-secondary)' }}>We hope we could help you today. How was your experience?</p>
                                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                                    {[1, 2, 3, 4, 5].map(score => (
                                        <button key={score} onClick={() => handleFeedback(score)} className="btn btn-secondary" style={{ width: 50, height: 50, justifyContent: 'center', fontSize: '1.2rem' }}>
                                            {score}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )
                    }

                    {
                        feedbackGiven && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
                                <div style={{ padding: '16px 32px', borderRadius: '30px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)', border: '1px solid var(--success)', fontWeight: 600 }}>
                                    ✅ Thank you for your feedback!
                                </div>
                            </div>
                        )
                    }

                    <div ref={bottomRef} style={{ height: 20 }} />
                </div>

                {/* Input Area */}
                <div style={{ borderTop: '1px solid var(--border)', padding: '20px 24px', background: 'var(--bg-card)' }}>
                    <div className="flex gap-4 items-center">
                        {activeTicket?.channel === 'voice' ? (
                            <div className="flex items-center gap-4 w-full">
                                <div style={{ flex: 1, padding: 10, color: '#888', fontStyle: 'italic' }}>
                                    Voice mode active. Record your request:
                                </div>
                                <AudioRecorder
                                    onSend={async (blob) => {
                                        setLoading(true);
                                        try {
                                            const ticketId = (activeTicket?.id as string) || '';
                                            const res = await transcribeVoice(blob, ticketId, sessionId);
                                            if (res.ticket) {
                                                setActiveTicket(res.ticket);
                                                if (res.ticket.status === 'resolved') setIsResolved(true);
                                                refetchHistory();
                                            }
                                            setMessages(m => [...m, { id: Date.now(), role: 'user', content: `🎤 ${res.transcript}`, audio_url: res.audio_url }]);
                                            setMessages(m => [...m, { id: res.message_id || Date.now() + 1, role: 'agent', content: res.reply, audio_url: res.agent_audio_url }]);
                                        } finally {
                                            setLoading(false);
                                        }
                                    }}
                                    disabled={loading || isResolved}
                                />
                            </div>
                        ) : (
                            <>
                                <div style={{ flex: 1, position: 'relative' }}>
                                    <input
                                        className="form-input w-full"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                                        placeholder={isResolved ? "Ticket has been resolved." : activeTicket?.channel === 'email' ? "Type your email reply here..." : "Describe your problem..."}
                                        disabled={loading || isResolved}
                                        style={{ borderRadius: '24px', padding: '12px 24px', background: 'var(--bg-input)' }}
                                    />
                                </div>
                                <button
                                    className="btn btn-primary"
                                    style={{ borderRadius: '24px', padding: '0 24px', height: 44 }}
                                    onClick={send}
                                    disabled={!input.trim() || loading || isResolved}
                                >
                                    Send
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* New Ticket Modal */}
            {showNewModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        background: 'var(--bg-card)', padding: '32px', borderRadius: 'var(--radius-lg)',
                        width: '400px', maxWidth: '90vw', border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-lg)'
                    }}>
                        <h2 style={{ margin: '0 0 16px', fontSize: '1.5rem' }}>Create New Ticket</h2>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                            Choose your preferred communication mode for this ticket.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
                            {[
                                { id: 'chat', label: 'Chat', icon: <MessageSquare size={18} /> },
                                { id: 'voice', label: 'Voice', icon: <Mic size={18} /> }
                            ].map((mode) => (
                                <button
                                    key={mode.id}
                                    onClick={() => setNewTicketChannel(mode.id as any)}
                                    className="btn"
                                    style={{
                                        flex: 1,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '16px',
                                        height: 'auto',
                                        background: newTicketChannel === mode.id ? 'var(--accent)' : 'var(--bg-secondary)',
                                        color: newTicketChannel === mode.id ? '#fff' : 'var(--text)',
                                        border: newTicketChannel === mode.id ? 'none' : '1px solid var(--border)',
                                        borderRadius: 'var(--radius)'
                                    }}
                                >
                                    {mode.icon}
                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{mode.label}</span>
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowNewModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreateTicket}>Start Ticket</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
