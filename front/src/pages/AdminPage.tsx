import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTickets, getTicket, updateTicket } from '../api/tickets';
import { sendReply, sendAdminVoiceReply } from '../api/chat';
import { formatDate } from '../lib/utils';
import AudioRecorder from '../components/AudioRecorder';

const TEAMS = ['all', 'help_desk', 'devops', 'sales', 'network', 'security'];
const STATUSES = ['all', 'open', 'in_progress', 'resolved', 'closed'];
const TEAM_LABELS: Record<string, string> = { help_desk: '🖥 Help Desk', devops: '⚙️ DevOps', sales: '💰 Sales', network: '🌐 Network', security: '🔒 Security' };
const PRIORITY_COLORS: Record<string, string> = { P1: 'var(--critical)', P2: 'var(--high)', P3: 'var(--medium)', P4: 'var(--low)' };

export default function AdminPage() {
    const qc = useQueryClient();
    const [teamFilter, setTeamFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { data: ticketsData } = useQuery({
        queryKey: ['tickets', teamFilter, statusFilter],
        queryFn: () => listTickets(teamFilter === 'all' ? undefined : teamFilter, statusFilter === 'all' ? undefined : statusFilter),
        refetchInterval: 5000,
    });

    const { data: detail } = useQuery({
        queryKey: ['ticket-detail', selectedId],
        queryFn: () => getTicket(selectedId!),
        enabled: !!selectedId,
    });

    const patchMut = useMutation({
        mutationFn: (updates: Record<string, string>) => updateTicket(selectedId!, updates),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['ticket-detail', selectedId] }); },
    });

    const [replyText, setReplyText] = useState('');
    const replyMut = useMutation({
        mutationFn: () => sendReply(selectedId!, replyText),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket-detail', selectedId] }); setReplyText(''); },
    });

    const voiceReplyMut = useMutation({
        mutationFn: (audio: Blob) => sendAdminVoiceReply(selectedId!, audio),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['ticket-detail', selectedId] }); },
    });

    const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

    const toggleStep = (idx: number) => {
        setExpandedSteps(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const tickets = ticketsData?.tickets || [];

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '350px 1fr',
            height: 'calc(100vh - 56px)',
            background: 'var(--bg-primary)',
            position: 'absolute',
            top: 56,
            left: 240,
            right: 0,
            bottom: 0,
            overflow: 'hidden'
        }}>
            {/* Left: Ticket list */}
            <div style={{ background: 'var(--bg-card)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
                    <h2 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Service Desk</h2>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <select className="form-select w-full" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ fontSize: '0.8rem' }}>
                            {TEAMS.map((t) => <option key={t} value={t}>{t === 'all' ? 'All Teams' : TEAM_LABELS[t] || t}</option>)}
                        </select>
                        <select className="form-select w-full" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: '0.8rem' }}>
                            {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Status' : s.replace('_', ' ')}</option>)}
                        </select>
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                    {tickets.length === 0 ? (
                        <div className="empty-state" style={{ marginTop: 40 }}><span style={{ fontSize: 40 }}>📭</span><p>No tickets found</p></div>
                    ) : (
                        <div className="flex-col gap-2">
                            {tickets.map((t: Record<string, unknown>) => (
                                <div key={t.id as string} className="card"
                                    style={{
                                        cursor: 'pointer',
                                        padding: '12px 14px',
                                        background: selectedId === t.id ? 'var(--accent-glow)' : 'transparent',
                                        borderColor: selectedId === t.id ? 'var(--accent)' : 'var(--border)',
                                        boxShadow: selectedId === t.id ? 'var(--shadow-glow)' : 'none'
                                    }}
                                    onClick={() => setSelectedId(t.id as string)}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span style={{ fontWeight: 800, fontSize: '0.7rem', color: PRIORITY_COLORS[t.priority as string], border: `1px solid ${PRIORITY_COLORS[t.priority as string]}`, padding: '1px 6px', borderRadius: 4 }}>{t.priority as string}</span>
                                        <span className="font-mono text-xs text-muted">{(t.id as string).substring(0, 10)}</span>
                                    </div>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 8 }} className="truncate">{t.title as string}</div>
                                    <div className="flex items-center gap-2 text-xs text-muted">
                                        <span className={`badge ${t.status === 'resolved' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: '0.6rem', padding: '1px 6px' }}>{t.status as string}</span>
                                        <span>•</span>
                                        <span>{TEAM_LABELS[t.team as string] || t.team as string}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Detail */}
            <div style={{ background: 'var(--bg-secondary)', overflowY: 'auto' }}>
                {!detail ? (
                    <div className="empty-state" style={{ height: '100%' }}>
                        <div style={{ fontSize: 60, opacity: 0.2, marginBottom: 20 }}>📑</div>
                        <h3>Select a ticket</h3>
                        <p>Choose an incident from the sidebar to view metrics and history.</p>
                    </div>
                ) : (
                    <div style={{ padding: 24 }}>
                        {/* Header Area */}
                        <div className="card mb-6" style={{ background: 'var(--bg-card)', borderLeft: `4px solid ${PRIORITY_COLORS[detail.priority]}` }}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="font-mono text-muted text-sm">{detail.id}</span>
                                        <span className={`badge ${detail.status === 'resolved' ? 'badge-success' : 'badge-warning'}`}>{detail.status}</span>
                                    </div>
                                    <h1 style={{ marginBottom: 8 }}>{detail.title}</h1>
                                    <div className="flex items-center gap-4 text-sm text-muted">
                                        <span><strong>Team:</strong> {TEAM_LABELS[detail.team] || detail.team}</span>
                                        <span><strong>Priority:</strong> <span style={{ color: PRIORITY_COLORS[detail.priority], fontWeight: 700 }}>{detail.priority}</span></span>
                                        <span><strong>Created:</strong> {formatDate(detail.created_at)}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <select className="form-select" value={detail.status} onChange={(e) => patchMut.mutate({ status: e.target.value })} style={{ height: 38 }}>
                                        <option value="open">Mark Open</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="resolved">Mark Resolved</option>
                                        <option value="closed">Close Ticket</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24 }}>
                            {/* Left Column: Conversation */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <h3>Conversation</h3>
                                    <span className="badge badge-info">{detail.messages?.length || 0}</span>
                                </div>
                                <div className="flex flex-col gap-6 mb-6">
                                    {(detail.messages || []).map((m: any) => {
                                        const isEmail = detail.channel === 'email';

                                        if (isEmail) {
                                            return (
                                                <div key={m.id as string} style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: 16 }}>
                                                    <div style={{
                                                        width: '100%', maxWidth: '800px', background: 'var(--bg-card)',
                                                        padding: '24px', borderRadius: '8px', border: '1px solid var(--border)',
                                                        boxShadow: 'var(--shadow-sm)', color: 'var(--text)', textAlign: 'left'
                                                    }}>
                                                        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
                                                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>
                                                                {m.role === 'admin' ? 'From: You (IT Support)' : m.role === 'user' ? 'From: User' : 'From: IT Automated Support'}
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                                                                To: {m.role === 'admin' ? 'User' : 'IT Support'}
                                                            </div>
                                                        </div>
                                                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.95rem' }}>
                                                            {m.content as string}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={m.id as string} className="flex-col gap-1">
                                                <div style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                                    <div className={`chat-bubble ${m.role === 'user' ? 'chat-bubble-user' : m.role === 'admin' ? 'chat-bubble-admin' : 'chat-bubble-agent'}`}
                                                        style={{ fontSize: '0.9rem', padding: '10px 14px' }}>
                                                        <div className="flex justify-between items-center mb-1 gap-4">
                                                            <span style={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.8 }}>
                                                                {m.role === 'user' ? '👤 User' : m.role === 'admin' ? '🛡️ Admin' : '🤖 AI Agent'}
                                                            </span>
                                                            <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>{formatDate(m.created_at as string)}</span>
                                                        </div>
                                                        <div>{m.content as string}</div>

                                                        {m.audio_url && typeof m.audio_url === 'string' && (
                                                            <div style={{ marginTop: 8 }}>
                                                                <audio src={m.audio_url.startsWith('http') ? m.audio_url : `http://localhost:8000${m.audio_url.startsWith('/') ? '' : '/'}${m.audio_url}`} controls style={{ height: 36, width: '100%', maxWidth: 240, borderRadius: 18, filter: m.role !== 'admin' ? 'invert(1)' : 'none' }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="card" style={{ padding: 12, background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                                    <div className="flex gap-2 items-center">
                                        {detail.channel === 'voice' ? (
                                            <div className="flex items-center gap-4 w-full">
                                                <div style={{ flex: 1, padding: 10, color: '#888', fontStyle: 'italic' }}>
                                                    Voice mode active. Record your audio response:
                                                </div>
                                                <AudioRecorder onSend={(blob) => voiceReplyMut.mutate(blob)} disabled={voiceReplyMut.isPending} />
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    className="form-input w-full"
                                                    placeholder={detail.channel === 'email' ? "Type your email response..." : "Type message to user..."}
                                                    value={replyText}
                                                    onChange={(e) => setReplyText(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' && replyText) replyMut.mutate(); }}
                                                    style={{ maxHeight: 40 }}
                                                />
                                                <button className="btn btn-primary" onClick={() => replyMut.mutate()} disabled={!replyText || replyMut.isPending}>Send</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Reasoning & Stats */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <h3>AI Reasoning</h3>
                                    <span style={{ fontSize: '0.7rem', background: 'var(--accent-glow)', color: 'var(--accent)', padding: '2px 6px', borderRadius: 4 }}>LangGraph v2</span>
                                </div>
                                <div className="flex-col gap-3">
                                    {(detail.agent_steps || []).map((s: Record<string, unknown>, i: number) => (
                                        <div key={s.id as string || i} className="reasoning-card">
                                            <div className="reasoning-header" onClick={() => toggleStep(i)}>
                                                <div className="flex items-center gap-3">
                                                    <span style={{ fontSize: '1.1rem' }}>
                                                        {s.step_type === 'triage' ? '⚖️' :
                                                            s.step_type === 'kb_search' ? '📚' :
                                                                s.step_type === 'evaluation' ? '🔍' :
                                                                    s.step_type === 'drafting' ? '✍️' :
                                                                        s.step_type === 'classification' ? '🏷️' :
                                                                            s.step_type === 'escalation' ? '🚨' :
                                                                                '🔧'}
                                                    </span>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'capitalize' }}>{String(s.step_type)}</div>
                                                        <div className="text-xs text-muted">{String(s.tool_name)}</div>
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{expandedSteps[i] ? '▲' : '▼'}</span>
                                            </div>
                                            {expandedSteps[i] && (
                                                <div className="reasoning-body">
                                                    <div className="mb-3">
                                                        <div className="text-xs font-bold text-muted mb-1 uppercase">Process Input</div>
                                                        <pre style={{ margin: 0, padding: 8, fontSize: '0.7rem' }}>{JSON.stringify(s.input, null, 2)}</pre>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold text-muted mb-1 uppercase">Agent Decision</div>
                                                        <pre style={{ margin: 0, padding: 8, fontSize: '0.7rem' }}>{JSON.stringify(s.output, null, 2)}</pre>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {(detail.agent_steps || []).length === 0 && (
                                        <div className="empty-state" style={{ padding: 20 }}>
                                            <p className="text-sm">No reasoning steps recorded for this interaction.</p>
                                        </div>
                                    )}
                                </div>

                                {/* Summary Card */}
                                <div className="card mt-6">
                                    <h3 style={{ fontSize: '0.9rem', marginBottom: 12 }}>Executive Summary</h3>
                                    {detail.summary ? (
                                        <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}>
                                            {detail.summary}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted">No summary generated yet.</p>
                                    )}

                                    {Number(detail.feedback_score) > 0 && (
                                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                                            <span className="text-sm text-muted mr-2">User Rating:</span>
                                            <span style={{ fontSize: '1.2rem', color: 'var(--success)', fontWeight: 800 }}>{detail.feedback_score}/5 ⭐️</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
