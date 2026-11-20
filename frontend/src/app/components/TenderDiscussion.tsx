"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, X } from 'lucide-react';

/** A file attached to a discussion message, as stored by the backend. */
export interface DiscussionAttachment {
  name: string;
  filename?: string;
  url: string;
  content_type?: string;
  size?: number;
}

export interface DiscussionComment {
  author?: string;
  username?: string;
  author_role?: string;
  comment?: string;
  created_at?: string;
  attachments?: string | DiscussionAttachment[] | null;
}

/** Images and documents that can be attached (checked again by the backend). */
export const DISCUSSION_ATTACHMENT_ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip';
const ALLOWED_EXTENSIONS = DISCUSSION_ATTACHMENT_ACCEPT.split(',').map(e => e.slice(1));
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DISCUSSION_MESSAGE_LENGTH = 255;

export function parseAttachments(raw: DiscussionComment['attachments']): DiscussionAttachment[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiscussionAttachment[]) : [];
  } catch {
    return [];
  }
}

function isImage(a: DiscussionAttachment): boolean {
  if (a.content_type?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(a.name || a.filename || '');
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TenderDiscussionProps {
  title: string;
  comments: DiscussionComment[];
  text: string;
  onTextChange: (text: string) => void;
  /** Posts the current text with the chosen files. Resolves true when the message was saved. */
  onPost: (files: File[]) => Promise<boolean>;
  placeholder: string;
  readOnly?: boolean;
  readOnlyPlaceholder?: string;
  /** Adds the login token to a protected /documents link. */
  getDocUrl: (path: string) => string;
  onError: (message: string) => void;
  inputId: string;
}

/** Discussion box for a tender section: messages with image / document attachments. */
export default function TenderDiscussion({
  title, comments, text, onTextChange, onPost, placeholder, readOnly = false,
  readOnlyPlaceholder = 'Discussion is read-only', getDocUrl, onError, inputId
}: TenderDiscussionProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view: scroll to the bottom when messages are added
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [comments.length]);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        onError(`'${f.name}' is not allowed. Attach an image (PNG, JPG, GIF, WEBP) or a document (PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP).`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        onError(`'${f.name}' is larger than 20 MB.`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        onError(`Attach at most ${MAX_FILES} files to one message.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const post = async () => {
    if (posting || readOnly) return;
    if (!text.trim() && files.length === 0) return;
    setPosting(true);
    try {
      const ok = await onPost(files);
      if (ok) setFiles([]);
    } finally {
      setPosting(false);
    }
  };

  const canPost = !readOnly && !posting && (text.trim().length > 0 || files.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minHeight: 0 }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '8px' }}>
        {title} ({comments.length})
      </div>
      {/* The list fills the box down to the input row and only scrolls once it is full.
          It is absolutely positioned so long conversations never stretch the card. */}
      <div style={{ position: 'relative', flex: 1, minHeight: '180px', marginBottom: '12px' }}>
        <div ref={listRef} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto' }}>
          {comments.length === 0 ? (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No discussion messages yet.</span>
          ) : (
            comments.map((c, i) => {
              const attachments = parseAttachments(c.attachments);
              return (
                <div key={i} style={{ background: 'rgba(255, 255, 255, 0.015)', padding: '6px 10px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid rgba(255, 255, 255, 0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '3px' }}>
                    <span style={{ fontWeight: '700' }}>{c.author || c.username} ({c.author_role})</span>
                    <span>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                  </div>
                  {c.comment && <div style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{c.comment}</div>}
                  {attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {attachments.map((a, j) => isImage(a) ? (
                        <a key={j} href={getDocUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}
                           style={{ display: 'block', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={getDocUrl(a.url)} alt={a.name} style={{ display: 'block', width: '96px', height: '72px', objectFit: 'cover' }} />
                        </a>
                      ) : (
                        <a key={j} href={getDocUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}
                           style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', maxWidth: '220px', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', textDecoration: 'none', color: 'var(--text-primary)', background: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
                          <FileText size={12} style={{ color: '#14b8a6', flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                          {a.size ? <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{formatSize(a.size)}</span> : null}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {files.map((f, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '200px', padding: '3px 8px', borderRadius: '12px', fontSize: '10.5px', background: 'rgba(20, 184, 166, 0.08)', border: '1px solid rgba(20, 184, 166, 0.25)', color: 'var(--text-primary)' }}>
                <Paperclip size={11} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}
                        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#ef4444', display: 'flex' }}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            placeholder={readOnly ? readOnlyPlaceholder : placeholder}
            value={text}
            maxLength={MAX_DISCUSSION_MESSAGE_LENGTH}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canPost) { e.preventDefault(); post(); } }}
            disabled={readOnly}
            style={{ flexGrow: 1, minWidth: 0, padding: '6px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', opacity: readOnly ? 0.7 : 1 }}
          />
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            multiple
            accept={DISCUSSION_ATTACHMENT_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => addFiles(e.target.files)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            title="Attach images or documents"
            aria-label="Attach images or documents"
            disabled={readOnly || posting}
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: '6px 9px', fontSize: '11px', display: 'flex', alignItems: 'center' }}
          >
            <Paperclip size={13} />
          </button>
          <button
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: '11px', opacity: canPost ? 1 : 0.6 }}
            onClick={post}
            disabled={!canPost}
          >
            {posting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
