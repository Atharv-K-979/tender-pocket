"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, Building2, Download, Eye, FileText, Lock, Search, Trash2, UploadCloud } from 'lucide-react';

type Category = 'profile' | 'certificates';

interface CompanyDoc {
  id: string;
  category: Category;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
}

interface Props {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  showToast: (message: string, type: 'success' | 'error') => void;
}

const TABS: { key: Category; label: string; icon: React.ReactNode }[] = [
  { key: 'profile', label: 'Company Profile Documents', icon: <Building2 size={16} /> },
  { key: 'certificates', label: 'Certificates', icon: <Award size={16} /> },
];

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CompanyDocs({ fetchWithAuth, showToast }: Props) {
  const [category, setCategory] = useState<Category>('profile');
  const [docs, setDocs] = useState<CompanyDoc[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [allowedExt, setAllowedExt] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // showToast is recreated on every parent render; keep it out of load's deps to avoid a refetch loop.
  const toastRef = useRef(showToast);
  useEffect(() => { toastRef.current = showToast; });

  const load = useCallback(() => {
    return fetchWithAuth('/api/company-docs')
      .then(async res => {
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load company documents.');
        setDocs(data.documents);
        setCanManage(Boolean(data.canManage));
        setAllowedExt(data.allowedExtensions || []);
      })
      .catch(err => toastRef.current(err instanceof Error ? err.message : String(err), 'error'))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter(d => d.category === category && (!q || d.original_name.toLowerCase().includes(q)));
  }, [docs, category, search]);

  const uploadFiles = async (files: File[]) => {
    if (!canManage || files.length === 0) return;
    setUploading({ done: 0, total: files.length });
    let ok = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('category', category);
        form.append('file', file);
        const res = await fetchWithAuth('/api/company-docs', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `Upload failed for "${file.name}".`);
        ok++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      setUploading(prev => prev && { ...prev, done: prev.done + 1 });
    }
    setUploading(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await load();
    if (ok) showToast(`Uploaded ${ok} of ${files.length} file${files.length > 1 ? 's' : ''}.`, 'success');
    if (errors.length) showToast(errors.slice(0, 3).join(' • ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ''), 'error');
  };

  const fetchBlob = async (doc: CompanyDoc) => {
    const res = await fetchWithAuth(`/api/company-docs/${encodeURIComponent(doc.id)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not open document.');
    }
    return res.blob();
  };

  const downloadDoc = async (doc: CompanyDoc) => {
    try {
      const blob = await fetchBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const viewDoc = async (doc: CompanyDoc) => {
    if (!PREVIEWABLE.has(doc.mime_type)) {
      await downloadDoc(doc);
      return;
    }
    // Open the tab synchronously so popup blockers allow it, then fill it once the file arrives.
    const win = window.open('', '_blank');
    try {
      const blob = await fetchBlob(doc);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (err) {
      win?.close();
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const deleteDoc = async (doc: CompanyDoc) => {
    if (!window.confirm(`Delete "${doc.original_name}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/company-docs/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed.');
      showToast(`Deleted "${doc.original_name}".`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      {/* Category tabs */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const count = docs.filter(d => d.category === t.key).length;
          const active = t.key === category;
          return (
            <button
              key={t.key}
              onClick={() => setCategory(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px',
                border: `1px solid ${active ? '#6366f1' : 'var(--border-color)'}`,
                background: active ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-card)',
                color: active ? '#6366f1' : 'var(--text-primary)', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
              }}
            >
              {t.icon}
              {t.label}
              {!loading && <span style={{ fontSize: '12px', opacity: 0.7, fontWeight: 500 }}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Upload (MIS Team only) or read-only notice */}
      {canManage ? (
        <div
          className="card"
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading) uploadFiles(Array.from(e.dataTransfer.files)); }}
          onClick={() => !uploading && fileInputRef.current?.click()}
          style={{
            padding: '28px 20px', borderRadius: '12px', textAlign: 'center', cursor: uploading ? 'wait' : 'pointer',
            border: `2px dashed ${dragOver ? '#6366f1' : 'var(--border-color)'}`,
            background: dragOver ? 'rgba(99, 102, 241, 0.06)' : 'var(--bg-card)',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={allowedExt.join(',')}
            style={{ display: 'none' }}
            onChange={e => uploadFiles(Array.from(e.target.files || []))}
          />
          <UploadCloud size={28} style={{ color: '#6366f1', marginBottom: '8px' }} />
          <div style={{ fontWeight: 600, fontSize: '14px' }}>
            {uploading
              ? `Uploading ${uploading.done} of ${uploading.total}…`
              : `Click or drop files to upload to ${TABS.find(t => t.key === category)?.label}`}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {allowedExt.join(', ')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <Lock size={14} /> View-only. Documents are uploaded and maintained by the MIS Team.
        </div>
      )}

      {/* Document list */}
      <div className="card" style={{ borderRadius: '12px', background: 'var(--bg-card)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Search size={16} style={{ color: 'var(--text-secondary)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents by name…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '14px' }}
          />
        </div>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading documents…</div>
        ) : visibleDocs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {search ? 'No documents match your search.' : 'No documents uploaded yet.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '10px 16px', fontWeight: 600 }}>Document</th>
                  <th style={{ padding: '10px 16px', fontWeight: 600 }}>Size</th>
                  <th style={{ padding: '10px 16px', fontWeight: 600 }}>Uploaded by</th>
                  <th style={{ padding: '10px 16px', fontWeight: 600 }}>Uploaded on</th>
                  <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleDocs.map(doc => (
                  <tr key={doc.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <button
                        onClick={() => viewDoc(doc)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', padding: 0, fontSize: '13px', fontWeight: 500 }}
                      >
                        <FileText size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
                        <span style={{ wordBreak: 'break-word' }}>{doc.original_name}</span>
                      </button>
                    </td>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{formatBytes(doc.size_bytes)}</td>
                    <td style={{ padding: '10px 16px' }}>{doc.uploaded_by}</td>
                    <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{new Date(doc.uploaded_at).toLocaleString()}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <IconButton title="View" onClick={() => viewDoc(doc)}><Eye size={15} /></IconButton>
                        <IconButton title="Download" onClick={() => downloadDoc(doc)}><Download size={15} /></IconButton>
                        {canManage && (
                          <IconButton title="Delete" danger onClick={() => deleteDoc(doc)}><Trash2 size={15} /></IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px',
        border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer',
        color: danger ? '#ef4444' : 'var(--text-primary)',
      }}
    >
      {children}
    </button>
  );
}
