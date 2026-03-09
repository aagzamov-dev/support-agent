import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTickets, getTicket, updateTicket } from '../api/tickets';
import { sendReply } from '../api/chat';
import { formatDate } from '../lib/utils';

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

    const tickets = ticketsData?.tickets || [];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, height: 'calc(100vh - 56px - 48px)' }}>
            {/* Left: Ticket list */}
            <div className="panel">
                <div className="panel-header">
                    <span>🎫 Tickets ({tickets.length})</span>
                </div>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
                    <select className="form-select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                        {TEAMS.map((t) => <option key={t} value={t}>{t === 'all' ? 'All Teams' : TEAM_LABELS[t] || t}</option>)}
                    </select>
                    <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Status' : s.replace('_', ' ')}</option>)}
                    </select>
                </div>
                <div className="panel-body">
                    {tickets.length === 0 ? (
                        <div className="empty-state"><span style={{ fontSize: 28 }}>📭</span><p>No tickets yet</p></div>
                    ) : (
                        <div className="flex-col gap-2">
                            {tickets.map((t: Record<string, unknown>) => (
                                <div key={t.id as string} className="card" style={{ cursor: 'pointer', borderColor: selectedId === t.id ? 'var(--accent)' : undefined }}
                                    onClick={() => setSelectedId(t.id as string)}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: PRIORITY_COLORS[t.priority as string] || 'var(--text)' }}>{t.priority as string}</span>
                                        <span className="font-mono text-xs text-muted">{t.id as string}</span>
                                    </div>
                                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.title as string}</div>
                                    <div className="flex items-center gap-2 mt-2 text-xs text-muted">
                                        <span>{TEAM_LABELS[t.team as string] || t.team as string}</span>
                                        <span>·</span>
                                        <span>{t.status as string}</span>
                                        <span>·</span>
                                        <span>{(t.message_count as number) || 0} msgs</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Detail */}
            <div className="panel">
                {!detail ? (
                    <div className="empty-state" style={{ height: '100%' }}><span style={{ fontSize: 40 }}>👈</span><p>Select a ticket to view details</p></div>
                ) : (
                    <>
                        <div className="panel-header">
                            <div>
                                <span style={{ fontWeight: 700 }}>{detail.id}</span>
                                <span className="text-muted" style={{ marginLeft: 8 }}>{detail.title}</span>
                            </div>
                            <div className="flex gap-2">
                                <select className="form-select" value={detail.status} onChange={(e) => patchMut.mutate({ status: e.target.value })} style={{ fontSize: '0.8rem', padding: '4px' }}>
                                    <option value="open">Open</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="resolved">Resolved</option>
                                    <option value="closed">Closed</option>
                                </select>
                            </div>
                        </div>
                        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            {/* Conversation */}
                            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 'calc(100vh - 180px)' }}>
                                <h3 className="mb-2">💬 Conversation</h3>
                                <div className="flex-col gap-2" style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                                    {(detail.messages || []).map((m: Record<string, unknown>) => (
                                        <div key={m.id as string} style={{
                                            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                                            background: m.role === 'user' ? 'rgba(79,110,247,0.1)' : m.role === 'admin' ? 'rgba(245,158,11,0.1)' : 'var(--bg-input)',
                                            borderLeft: `3px solid ${m.role === 'user' ? 'var(--accent)' : m.role === 'admin' ? 'var(--warning)' : 'var(--success)'}`,
                                        }}>
                                            <div className="flex items-center justify-between mb-2">
                                                <span style={{ fontWeight: 600, fontSize: '0.8rem', color: m.role === 'user' ? 'var(--accent)' : m.role === 'admin' ? 'var(--warning)' : 'var(--success)' }}>
                                                    {m.role === 'user' ? '👤 User' : m.role === 'admin' ? '🛡️ Admin' : '🤖 Agent'}
                                                    {m.channel !== 'chat' && <span className="text-muted" style={{ marginLeft: 6 }}>via {m.channel as string}</span>}
                                                </span>
                                                <span className="text-xs text-muted">{formatDate(m.created_at as string)}</span>
                                            </div>
                                            <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{m.content as string}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 flex gap-2" style={{ flexShrink: 0 }}>
                                    <input className="form-input w-full" placeholder="Type a reply to the user..." value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && replyText) replyMut.mutate(); }} disabled={replyMut.isPending} />
                                    <button className="btn btn-primary btn-sm" onClick={() => replyMut.mutate()} disabled={!replyText || replyMut.isPending}>Reply</button>
                                </div>
                            </div>

                            {/* Agent Reasoning */}
                            <div>
                                <h3 className="mb-2">🧠 Agent Reasoning</h3>
                                <div className="flex-col gap-2">
                                    {(detail.agent_steps || []).map((s: Record<string, unknown>, i: number) => (
                                        <div key={s.id as string || i} style={{
                                            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                                            background: 'var(--bg-input)', border: '1px solid var(--border)',
                                        }}>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span style={{
                                                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    background: s.step_type === 'kb_search' ? 'rgba(59,130,246,0.2)' : s.step_type === 'decision' ? 'rgba(34,197,94,0.2)' : 'rgba(249,115,22,0.2)',
                                                    fontSize: '0.8rem',
                                                }}>
                                                    {s.step_type === 'kb_search' ? '📚' : s.step_type === 'decision' ? '🎯' : '🔧'}
                                                </span>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{s.step_type as string}</div>
                                                    {Boolean(s.tool_name) && <div className="text-xs text-muted">{s.tool_name as string}</div>}
                                                </div>
                                            </div>
                                            <details style={{ fontSize: '0.75rem' }}>
                                                <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>View Details</summary>
                                                <div className="mt-2">
                                                    <div className="text-xs text-muted mb-2">Input:</div>
                                                    <pre style={{ fontSize: '0.7rem', marginBottom: 8 }}>{JSON.stringify(s.input, null, 2)}</pre>
                                                    <div className="text-xs text-muted mb-2">Output:</div>
                                                    <pre style={{ fontSize: '0.7rem' }}>{JSON.stringify(s.output, null, 2)}</pre>
                                                </div>
                                            </details>
                                        </div>
                                    ))}
                                    {(detail.agent_steps || []).length === 0 && (
                                        <div className="empty-state"><p className="text-muted">No agent steps recorded</p></div>
                                    )}
                                </div>

                                {/* Ticket Meta */}
                                <div className="card mt-4">
                                    <h3 className="mb-2">📋 Ticket Info</h3>
                                    <div className="flex-col gap-2 text-sm">
                                        <div className="flex justify-between"><span className="text-muted">Team:</span> <span>{TEAM_LABELS[detail.team] || detail.team}</span></div>
                                        <div className="flex justify-between"><span className="text-muted">Priority:</span> <span style={{ color: PRIORITY_COLORS[detail.priority] }}>{detail.priority}</span></div>
                                        <div className="flex justify-between"><span className="text-muted">Status:</span> <span>{detail.status}</span></div>
                                        <div className="flex justify-between"><span className="text-muted">Created:</span> <span>{formatDate(detail.created_at)}</span></div>
                                        {Number(detail.feedback_score) > 0 && (
                                            <div className="flex justify-between"><span className="text-muted">Feedback:</span> <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{detail.feedback_score as number}/5 ⭐️</span></div>
                                        )}
                                        {detail.summary && <div className="mt-2" style={{ padding: 8, background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)' }}><span className="text-muted text-xs">Summary:</span><p className="text-sm">{detail.summary}</p></div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
