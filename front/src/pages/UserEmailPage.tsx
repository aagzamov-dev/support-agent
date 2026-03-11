import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Plus } from 'lucide-react';
import { sendMessage } from '../api/chat';
import { getTicket, listUserTickets, createTicket } from '../api/tickets';
import { formatDate } from '../lib/utils';

// We reuse the standard ChatMsg interface since the backend uses the same model.
interface ChatMsg {
    id: string;
    role: string;
    content: string;
    created_at: string;
}

export default function UserEmailPage() {
    const qc = useQueryClient();
    const sessionId = "user-123";
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

    const { data: ticketsData } = useQuery({
        queryKey: ['user-tickets', sessionId],
        queryFn: () => listUserTickets(sessionId),
        refetchInterval: 5000,
    });

    const { data: activeTicket } = useQuery({
        queryKey: ['ticket-detail', selectedTicketId],
        queryFn: () => getTicket(selectedTicketId!),
        enabled: !!selectedTicketId,
        refetchInterval: 3000,
    });

    // Auto-select the first Email ticket
    const emailTickets = (ticketsData?.tickets || []).filter((t: any) => t.channel === 'email');
    useEffect(() => {
        if (!selectedTicketId && emailTickets.length > 0) {
            setSelectedTicketId(emailTickets[0].id as string);
        }
    }, [emailTickets, selectedTicketId]);

    const [input, setInput] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [newSubject, setNewSubject] = useState('');
    const [newBody, setNewBody] = useState('');
    const [newTeam, setNewTeam] = useState('help_desk');

    const chatMut = useMutation({
        mutationFn: async (text: string) => sendMessage(text, 'email', selectedTicketId!, sessionId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['ticket-detail', selectedTicketId] });
        },
    });

    const createTicketMut = useMutation({
        mutationFn: async () => {
            // Create ticket AND send the initial body as a message
            const t = await createTicket(newSubject, 'email', sessionId, newTeam);
            await sendMessage(newBody, 'email', t.id as string, sessionId);
            return t;
        },
        onSuccess: (t) => {
            qc.invalidateQueries({ queryKey: ['user-tickets'] });
            setSelectedTicketId(t.id as string);
            setIsComposing(false);
            setNewSubject('');
            setNewBody('');
            setNewTeam('help_desk');
        }
    });

    const messages = (activeTicket?.messages || []) as ChatMsg[];
    const isResolved = activeTicket?.status === 'resolved' || activeTicket?.status === 'closed';
    const loading = chatMut.isPending || createTicketMut.isPending;

    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [messages.length, loading]);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 56px)', position: 'absolute', top: 56, left: 240, right: 0, bottom: 0, backgroundColor: 'var(--bg-primary)' }}>

            {/* Sidebar: Inbox List */}
            <div style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--text)' }}>Support Inbox</h2>
                    <button className="btn btn-primary" style={{ padding: '6px 12px', borderRadius: '4px', display: 'flex', gap: 6, alignItems: 'center' }} onClick={() => setIsComposing(true)}>
                        <Plus size={16} /> Compose
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                    {emailTickets.length === 0 ? (
                        <div className="empty-state" style={{ marginTop: 40, color: 'var(--text-muted)' }}>
                            <span style={{ fontSize: 40 }}>📭</span>
                            <p>No email threads</p>
                        </div>
                    ) : (
                        <div className="flex-col gap-2">
                            {emailTickets.map((t: any) => (
                                <div key={t.id}
                                    style={{
                                        cursor: 'pointer',
                                        padding: '16px',
                                        borderRadius: '8px',
                                        background: selectedTicketId === t.id && !isComposing ? 'var(--accent-glow)' : 'transparent',
                                        border: selectedTicketId === t.id && !isComposing ? '1px solid var(--accent)' : '1px solid transparent',
                                        borderBottom: selectedTicketId === t.id && !isComposing ? undefined : '1px solid var(--border)'
                                    }}
                                    onClick={() => { setSelectedTicketId(t.id); setIsComposing(false); }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                                        {t.team === 'help_desk' ? 'IT Help Desk' :
                                            t.team === 'sales' ? 'Sales & Accounts' :
                                                t.team === 'devops' ? 'Cloud & DevOps' :
                                                    t.team === 'network' ? 'Network & VPN' :
                                                        t.team === 'security' ? 'Security & Access' : 'Support Desk'}
                                    </div>
                                    <div style={{ fontWeight: selectedTicketId === t.id ? 700 : 500, fontSize: '0.95rem', color: 'var(--text)', marginBottom: 6 }} className="truncate">{t.title}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <span style={{ color: t.status === 'resolved' ? 'var(--success)' : 'var(--warning)' }}>
                                            {t.status === 'resolved' ? '✅ Resolved' : '🔄 Open'}
                                        </span> • {(t.id as string).substring(0, 8)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Area: Thread or Compose */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
                {isComposing ? (
                    <div style={{ padding: 40, maxWidth: 800, margin: '0 auto', width: '100%' }}>
                        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
                            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text)' }}>New Support Request</h3>
                            </div>
                            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                                    <span style={{ width: 80, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>To Dept:</span>
                                    <select
                                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '4px 12px', borderRadius: 16, fontSize: '0.85rem', color: 'var(--text)', outline: 'none', cursor: 'pointer' }}
                                        value={newTeam}
                                        onChange={e => setNewTeam(e.target.value)}
                                    >
                                        <option value="help_desk">IT Help Desk</option>
                                        <option value="sales">Sales & Accounts</option>
                                        <option value="devops">Cloud & DevOps</option>
                                        <option value="network">Network & VPN</option>
                                        <option value="security">Security & Access</option>
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <span style={{ width: 80, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Subject:</span>
                                    <input
                                        style={{ flex: 1, border: 'none', outline: 'none', fontSize: '1rem', padding: '4px 0', background: 'transparent', color: 'var(--text)' }}
                                        placeholder="Brief description of your issue..."
                                        value={newSubject}
                                        onChange={e => setNewSubject(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div style={{ flex: 1, padding: 24 }}>
                                <textarea
                                    style={{ width: '100%', height: '100%', border: 'none', outline: 'none', resize: 'none', fontSize: '0.95rem', lineHeight: 1.6, background: 'transparent', color: 'var(--text)' }}
                                    placeholder="Please describe your issue in detail..."
                                    value={newBody}
                                    onChange={e => setNewBody(e.target.value)}
                                />
                            </div>
                            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-start' }}>
                                <button className="btn btn-primary" style={{ padding: '8px 24px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => createTicketMut.mutate()} disabled={loading || !newSubject.trim() || !newBody.trim()}>
                                    <Send size={16} /> {loading ? 'Sending...' : 'Send Request'}
                                </button>
                                <button className="btn btn-secondary" style={{ marginLeft: 16 }} onClick={() => setIsComposing(false)}>Cancel</button>
                            </div>
                        </div>
                    </div>
                ) : !activeTicket ? (
                    <div className="empty-state" style={{ height: '100%', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: 60, opacity: 0.3, marginBottom: 20 }}>📧</div>
                        <h3 style={{ color: 'var(--text)' }}>No Thread Selected</h3>
                        <p>Select a thread from the inbox or compose a new email.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* Email Header */}
                        <div style={{ padding: '24px 32px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h1 style={{ fontSize: '1.4rem', margin: '0 0 8px 0', color: 'var(--text)' }}>{activeTicket.title as string}</h1>
                                <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    <span>Ticket #{activeTicket.id as string}</span>
                                    <span>•</span>
                                    <span style={{ color: activeTicket.status === 'resolved' || activeTicket.status === 'closed' ? 'var(--success)' : 'var(--warning)' }}>
                                        {activeTicket.status === 'resolved' || activeTicket.status === 'closed' ? 'Closed' : 'Active'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Email Thread Body */}
                        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 800, margin: '0 auto' }}>
                                {messages.map((msg) => (
                                    <div key={msg.id} style={{
                                        background: 'var(--bg-card)',
                                        borderRadius: 8,
                                        border: '1px solid var(--border)',
                                        boxShadow: 'var(--shadow-sm)',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
                                                    {msg.role === 'user' ? 'You' : msg.role === 'admin' ? 'IT Support (Human)' : 'IT Automated Support'}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                                    to {msg.role === 'user' ? 'IT Support' : 'You'}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {formatDate(msg.created_at)}
                                            </div>
                                        </div>
                                        <div style={{ padding: '24px 20px', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.95rem', color: 'var(--text)' }}>
                                            {msg.content}
                                        </div>
                                    </div>
                                ))}

                                {loading && (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                                        <div className="agent-status-tag" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
                                            <div className="spinner" style={{ width: 16, height: 16, borderTopColor: 'var(--text)' }} />
                                            <span>Processing your request...</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Reply Box */}
                        {!isResolved && (
                            <div style={{ padding: '24px 32px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
                                <div style={{ maxWidth: 800, margin: '0 auto', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                                    <div style={{ padding: '8px 16px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                        Reply
                                    </div>
                                    <textarea
                                        style={{ width: '100%', height: 120, border: 'none', outline: 'none', padding: 16, resize: 'none', fontSize: '0.95rem', lineHeight: 1.5, background: 'var(--bg-input)', color: 'var(--text)' }}
                                        placeholder="Write your reply..."
                                        value={input}
                                        onChange={e => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                if (input.trim()) {
                                                    chatMut.mutate(input);
                                                    setInput('');
                                                }
                                            }
                                        }}
                                    />
                                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-secondary)' }}>
                                        <button
                                            className="btn btn-primary"
                                            style={{ padding: '6px 20px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}
                                            disabled={!input.trim() || loading}
                                            onClick={() => {
                                                if (input.trim()) {
                                                    chatMut.mutate(input);
                                                    setInput('');
                                                }
                                            }}
                                        >
                                            <Send size={14} /> Send
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                        {isResolved && (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
                                This thread has been closed. If you need further assistance, please compose a new email.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
