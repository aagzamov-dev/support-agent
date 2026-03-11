import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getIncident } from '../api/incidents';
import { getTimeline } from '../api/timeline';
import { runAgentStep, sendHumanReply } from '../api/agent';
import { getTickets, createTicket } from '../api/tickets';
import { sendEmail, sendChat, transcribeVoice, getMessages } from '../api/comms';
import { searchKB } from '../api/kb';
import { useIncidentStream } from '../hooks/useIncidentStream';
import { formatDate, severityClass } from '../lib/utils';
import { KIND_ICONS } from '../lib/constants';

export default function IncidentDetailPage() {
    const { id } = useParams<{ id: string }>();
    const qc = useQueryClient();
    useIncidentStream(id);

    const { data: incident } = useQuery({ queryKey: ['incident', id], queryFn: () => getIncident(id!), enabled: !!id });
    const { data: timeline } = useQuery({ queryKey: ['timeline', id], queryFn: () => getTimeline(id!), enabled: !!id, refetchInterval: 3000 });
    const { data: tickets } = useQuery({ queryKey: ['tickets', id], queryFn: () => getTickets(id!), enabled: !!id });
    const { data: messages } = useQuery({ queryKey: ['messages', id], queryFn: () => getMessages(id!), enabled: !!id });

    const [hint, setHint] = useState('');
    const [rightTab, setRightTab] = useState<'agent' | 'tickets' | 'comms' | 'kb'>('agent');
    const [commsTab, setCommsTab] = useState<'email' | 'chat' | 'voice'>('email');

    // Agent step
    const agentMut = useMutation({
        mutationFn: () => runAgentStep(id!, hint || undefined),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['timeline', id] }); qc.invalidateQueries({ queryKey: ['incident', id] }); setHint(''); },
    });

    // Human reply
    const [replyText, setReplyText] = useState('');
    const replyMut = useMutation({
        mutationFn: () => sendHumanReply(id!, 'operator', replyText),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['timeline', id] }); setReplyText(''); },
    });

    // Ticket
    const [ticketForm, setTicketForm] = useState({ title: '', priority: 'P2', assignee: '', description: '' });
    const ticketMut = useMutation({
        mutationFn: () => createTicket(id!, ticketForm),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets', id] }); setTicketForm({ title: '', priority: 'P2', assignee: '', description: '' }); },
    });

    // Email
    const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' });
    const emailMut = useMutation({
        mutationFn: () => sendEmail({ incident_id: id!, ...emailForm }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', id] }); setEmailForm({ to: '', subject: '', body: '' }); },
    });

    // Chat
    const [chatForm, setChatForm] = useState({ channel: '#dba-alerts', message: '' });
    const chatMut = useMutation({
        mutationFn: () => sendChat({ incident_id: id!, ...chatForm }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', id] }); setChatForm({ ...chatForm, message: '' }); },
    });

    // Voice
    const [recording, setRecording] = useState(false);
    const [mediaRec, setMediaRec] = useState<MediaRecorder | null>(null);
    const [transcript, setTranscript] = useState('');

    const startRecording = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];
        mr.ondataavailable = (e) => chunks.push(e.data);
        mr.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: 'audio/webm' });
            try {
                const res = await transcribeVoice(blob, id, 'operator');
                setTranscript(res.transcript);
                qc.invalidateQueries({ queryKey: ['timeline', id] });
            } catch { setTranscript('Error transcribing audio'); }
        };
        mr.start();
        setMediaRec(mr);
        setRecording(true);
    };

    const stopRecording = () => { mediaRec?.stop(); setRecording(false); };

    // KB Search
    const [kbQuery, setKbQuery] = useState('');
    const kbSearch = useQuery({ queryKey: ['kb-search', kbQuery], queryFn: () => searchKB(kbQuery), enabled: kbQuery.length > 2 });

    if (!incident) return <div className="empty-state"><div className="spinner" /></div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px - 48px)', gap: 16 }}>
            {/* Header */}
            <div className="card" style={{ flexShrink: 0 }}>
                <div className="flex items-center gap-3">
                    <span className={`badge ${severityClass(incident.severity)}`}>{incident.severity.toUpperCase()}</span>
                    <h2 style={{ flex: 1 }}>{incident.title}</h2>
                    <span className="badge badge-info">{incident.status}</span>
                    <span className="text-xs text-muted font-mono">{incident.host}</span>
                </div>
                {incident.summary && <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>{incident.summary}</p>}
            </div>

            {/* Main panels */}
            <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, flex: 1, minHeight: 0 }}>
                {/* Left: Timeline */}
                <div className="panel">
                    <div className="panel-header">📋 Timeline ({timeline?.items?.length || 0})</div>
                    <div className="panel-body">
                        <div className="timeline">
                            {(timeline?.items || []).map((evt: Record<string, unknown>) => (
                                <div key={evt.id as string} className="timeline-item">
                                    <div className="timeline-icon">{KIND_ICONS[(evt.kind as string)] || '📌'}</div>
                                    <div className="timeline-content">
                                        <div className="timeline-time">{formatDate(evt.ts as string)} · <span style={{ color: 'var(--accent)' }}>{evt.actor as string}</span></div>
                                        <div className="timeline-summary">{evt.summary as string}</div>
                                        {evt.kind === 'agent_plan' && evt.data && (
                                            <details className="mt-2" style={{ fontSize: '0.8rem' }}>
                                                <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>View Plan</summary>
                                                <pre style={{ marginTop: 4, fontSize: '0.75rem' }}>{JSON.stringify(evt.data, null, 2)}</pre>
                                            </details>
                                        )}
                                        {evt.kind === 'tool_result' && evt.data && (
                                            <details className="mt-2" style={{ fontSize: '0.8rem' }}>
                                                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                                                    Tool Output {((evt.data as any)?.output?.duration_ms !== undefined) ? `(${(evt.data as any).output.duration_ms} ms)` : ''}
                                                </summary>
                                                <pre style={{ marginTop: 4, fontSize: '0.75rem' }}>{JSON.stringify(evt.data, null, 2)}</pre>
                                            </details>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right: Tabs */}
                <div className="panel">
                    <div className="tabs" style={{ padding: '0 16px' }}>
                        {(['agent', 'tickets', 'comms', 'kb'] as const).map((t) => (
                            <div key={t} className={`tab ${rightTab === t ? 'active' : ''}`} onClick={() => setRightTab(t)}>
                                {t === 'agent' ? '🤖 Agent' : t === 'tickets' ? '🎫 Tickets' : t === 'comms' ? '💬 Comms' : '📚 KB'}
                            </div>
                        ))}
                    </div>
                    <div className="panel-body">
                        {/* Agent Tab */}
                        {rightTab === 'agent' && (
                            <div className="flex-col gap-3">
                                <div className="form-group">
                                    <label className="form-label">Hint / Context (optional)</label>
                                    <input className="form-input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="DBA says WAL cleanup ran last night..." />
                                </div>
                                <button className="btn btn-primary" onClick={() => agentMut.mutate()} disabled={agentMut.isPending}>
                                    {agentMut.isPending ? '⏳ Agent thinking...' : '▶ Run Agent Step'}
                                </button>
                                {agentMut.data && (
                                    <div className="card mt-2">
                                        <div className="card-header"><span className="card-title">Plan (Step #{agentMut.data.step})</span><span className="text-xs text-muted">{agentMut.data.duration_ms}ms</span></div>
                                        <pre style={{ fontSize: '0.75rem', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(agentMut.data.plan, null, 2)}</pre>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tickets Tab */}
                        {rightTab === 'tickets' && (
                            <div className="flex-col gap-3">
                                {(tickets?.items || []).map((t: Record<string, unknown>) => (
                                    <div key={t.id as string} className="card">
                                        <div className="flex items-center gap-2">
                                            <span className="badge badge-high">{(t.data as Record<string, string>)?.priority || 'P2'}</span>
                                            <span style={{ fontWeight: 600 }}>{(t.data as Record<string, string>)?.external_id}</span>
                                            <span className="text-sm">{t.summary as string}</span>
                                        </div>
                                    </div>
                                ))}
                                <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
                                <div className="flex gap-2">
                                    <input className="form-input w-full" placeholder="Ticket title" value={ticketForm.title} onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })} />
                                    <select className="form-select" value={ticketForm.priority} onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}>
                                        <option>P1</option><option>P2</option><option>P3</option>
                                    </select>
                                    <button className="btn btn-primary btn-sm" onClick={() => ticketMut.mutate()} disabled={!ticketForm.title}>Create</button>
                                </div>
                            </div>
                        )}

                        {/* Comms Tab */}
                        {rightTab === 'comms' && (
                            <div>
                                <div className="tabs">
                                    {(['email', 'chat', 'voice'] as const).map((t) => (
                                        <div key={t} className={`tab ${commsTab === t ? 'active' : ''}`} onClick={() => setCommsTab(t)}>
                                            {t === 'email' ? '📧 Email' : t === 'chat' ? '💬 Chat' : '🎤 Voice'}
                                        </div>
                                    ))}
                                </div>

                                {/* Messages */}
                                <div className="flex-col gap-2 mb-4" style={{ maxHeight: 150, overflowY: 'auto' }}>
                                    {(messages?.items || []).filter((m: Record<string, unknown>) => (m.data as Record<string, string>)?.channel === commsTab).map((m: Record<string, unknown>) => (
                                        <div key={m.id as string} className="text-sm" style={{ padding: 6, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
                                            <span className="text-muted">{formatDate(m.ts as string)}</span> {m.summary as string}
                                        </div>
                                    ))}
                                </div>

                                {commsTab === 'email' && (
                                    <div className="flex-col gap-2">
                                        <input className="form-input" placeholder="To" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} />
                                        <input className="form-input" placeholder="Subject" value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
                                        <textarea className="form-textarea" placeholder="Body" value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} />
                                        <button className="btn btn-primary btn-sm" onClick={() => emailMut.mutate()} disabled={emailMut.isPending || !emailForm.to}>Send Email</button>
                                    </div>
                                )}

                                {commsTab === 'chat' && (
                                    <div className="flex-col gap-2">
                                        <input className="form-input" placeholder="Channel (#dba-alerts)" value={chatForm.channel} onChange={(e) => setChatForm({ ...chatForm, channel: e.target.value })} />
                                        <textarea className="form-textarea" placeholder="Message" value={chatForm.message} onChange={(e) => setChatForm({ ...chatForm, message: e.target.value })} />
                                        <button className="btn btn-primary btn-sm" onClick={() => chatMut.mutate()} disabled={chatMut.isPending || !chatForm.message}>Send Chat</button>
                                    </div>
                                )}

                                {commsTab === 'voice' && (
                                    <div className="flex-col gap-3">
                                        <p className="text-sm text-muted">Record a voice message. It will be transcribed and sent as a human reply.</p>
                                        <button className={`btn ${recording ? 'btn-danger' : 'btn-primary'}`} onClick={recording ? stopRecording : startRecording}>
                                            {recording ? '⏹ Stop Recording' : '🎤 Start Recording'}
                                        </button>
                                        {transcript && (
                                            <div className="card">
                                                <div className="card-header"><span className="card-title">Transcript</span></div>
                                                <p className="text-sm">{transcript}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* KB Tab */}
                        {rightTab === 'kb' && (
                            <div className="flex-col gap-3">
                                <input className="form-input" placeholder="Search knowledge base..." value={kbQuery} onChange={(e) => setKbQuery(e.target.value)} />
                                {kbSearch.data?.results?.map((r: Record<string, unknown>, i: number) => (
                                    <div key={i} className="card">
                                        <div className="flex items-center justify-between mb-2">
                                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.doc_title as string} — {r.section as string}</span>
                                            <span className="badge badge-info">{((r.relevance as number) * 100).toFixed(0)}%</span>
                                        </div>
                                        <pre style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{r.content as string}</pre>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer: Human Reply */}
                    <div className="panel-footer">
                        <div className="flex gap-2">
                            <input className="form-input w-full" placeholder="Type a human reply..." value={replyText} onChange={(e) => setReplyText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && replyText) replyMut.mutate(); }} />
                            <button className="btn btn-secondary btn-sm" onClick={() => replyMut.mutate()} disabled={!replyText || replyMut.isPending}>Send</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
