import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDocuments, createDocument, updateDocument, deleteDocument, searchKB, uploadPDF } from '../api/kb';

interface Section { heading: string; content: string; }
interface Doc { id: string; title: string; category: string; tags: string[]; sections: Section[]; }

export default function KnowledgeBasePage() {
    const qc = useQueryClient();
    const { data } = useQuery({ queryKey: ['kb-docs'], queryFn: listDocuments });
    const [editing, setEditing] = useState<Doc | null>(null);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState<{ title: string; category: string; tags: string; sections: Section[] }>({ title: '', category: '', tags: '', sections: [{ heading: '', content: '' }] });

    const [testQuery, setTestQuery] = useState('');
    const testSearch = useQuery({ queryKey: ['kb-test', testQuery], queryFn: () => searchKB(testQuery), enabled: testQuery.length > 2 });

    const createMut = useMutation({
        mutationFn: () => createDocument({ ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-docs'] }); setCreating(false); resetForm(); },
    });

    const updateMut = useMutation({
        mutationFn: () => updateDocument(editing!.id, { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-docs'] }); setEditing(null); resetForm(); },
    });

    const deleteMut = useMutation({
        mutationFn: deleteDocument,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['kb-docs'] }),
    });

    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadMut = useMutation({
        mutationFn: (file: File) => uploadPDF(file),
        onSuccess: () => { 
            qc.invalidateQueries({ queryKey: ['kb-docs'] });
            alert('PDF uploaded successfully!');
        },
        onError: (err: any) => alert(err?.response?.data?.detail || 'Upload failed'),
    });

    function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            uploadMut.mutate(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function resetForm() { setForm({ title: '', category: '', tags: '', sections: [{ heading: '', content: '' }] }); }

    function startEdit(doc: Doc) {
        setEditing(doc);
        setCreating(false);
        setForm({ title: doc.title, category: doc.category, tags: doc.tags.join(', '), sections: [...doc.sections] });
    }

    function addSection() { setForm({ ...form, sections: [...form.sections, { heading: '', content: '' }] }); }
    function removeSection(i: number) { setForm({ ...form, sections: form.sections.filter((_, idx) => idx !== i) }); }
    function updateSection(i: number, field: 'heading' | 'content', val: string) {
        const s = [...form.sections]; s[i] = { ...s[i], [field]: val }; setForm({ ...form, sections: s });
    }

    const isEditing = editing || creating;

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <h1>📚 Knowledge Base</h1>
                {!isEditing && (
                    <div className="flex gap-2">
                        <input type="file" accept=".pdf" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadMut.isPending}>
                            {uploadMut.isPending ? 'Uploading...' : '📄 Upload PDF'}
                        </button>
                        <button className="btn btn-primary" onClick={() => { resetForm(); setCreating(true); setEditing(null); }}>+ Add Document</button>
                    </div>
                )}
            </div>

            {/* Search test */}
            <div className="card mb-4">
                <div className="card-header"><span className="card-title">🔍 Test Vector Search</span></div>
                <input className="form-input w-full mb-2" placeholder="Search runbooks..." value={testQuery} onChange={(e) => setTestQuery(e.target.value)} />
                {testSearch.data?.results?.map((r: Record<string, unknown>, i: number) => (
                    <div key={i} className="text-sm" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600 }}>{r.doc_title as string}</span> — {r.section as string}
                        <span className="badge badge-info" style={{ marginLeft: 8 }}>{((r.relevance as number) * 100).toFixed(0)}%</span>
                    </div>
                ))}
            </div>

            {/* Edit/Create Form */}
            {isEditing && (
                <div className="card mb-4">
                    <div className="card-header">
                        <span className="card-title">{editing ? `Edit: ${editing.title}` : 'New Document'}</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setCreating(false); resetForm(); }}>✕ Cancel</button>
                    </div>
                    <div className="flex-col gap-3">
                        <div className="flex gap-3">
                            <div className="form-group w-full"><label className="form-label">Title</label><input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Category</label><input className="form-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="database" /></div>
                        </div>
                        <div className="form-group"><label className="form-label">Tags (comma-separated)</label><input className="form-input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="disk, postgresql, wal" /></div>

                        <div className="flex items-center justify-between"><span className="form-label">Sections</span><button className="btn btn-secondary btn-sm" onClick={addSection}>+ Add Section</button></div>
                        {form.sections.map((s, i) => (
                            <div key={i} style={{ padding: 12, background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                                <div className="flex items-center justify-between mb-2">
                                    <input className="form-input" style={{ flex: 1 }} placeholder="Section heading" value={s.heading} onChange={(e) => updateSection(i, 'heading', e.target.value)} />
                                    {form.sections.length > 1 && <button className="btn btn-danger btn-sm" style={{ marginLeft: 8 }} onClick={() => removeSection(i)}>✕</button>}
                                </div>
                                <textarea className="form-textarea w-full" placeholder="Content..." value={s.content} onChange={(e) => updateSection(i, 'content', e.target.value)} />
                            </div>
                        ))}
                        <button className="btn btn-primary" onClick={() => editing ? updateMut.mutate() : createMut.mutate()} disabled={!form.title || !form.sections[0]?.heading}>
                            {editing ? 'Update Document' : 'Create Document'}
                        </button>
                    </div>
                </div>
            )}

            {/* Document list */}
            <div className="flex-col gap-2">
                {(data?.documents || []).map((doc: Doc) => (
                    <div key={doc.id} className="card">
                        <div className="flex items-center justify-between">
                            <div>
                                <div style={{ fontWeight: 600 }}>{doc.title}</div>
                                <div className="text-xs text-muted">{doc.category} · {doc.sections.length} sections · {doc.tags.join(', ')}</div>
                            </div>
                            <div className="flex gap-2">
                                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(doc)}>✏️ Edit</button>
                                <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('Delete this document?')) deleteMut.mutate(doc.id); }}>🗑</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
