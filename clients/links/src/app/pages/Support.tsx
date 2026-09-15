/* Support — NATIVE Adeyy screen (list + create + single-ticket thread).
 *
 * Every Prodesk frontend ships its own Support UI so it blends in as just another
 * app screen; only the DATA layer is shared:
 *   - `@shared/pages/support/use-support` — the tRPC/query hooks.
 *   - `@shared/pages/support/model`       — types, labels, options, upload helper.
 * This is the Adeyy re-skin of clients/_template/src/pages/Support.tsx, dressed in
 * the bespoke Adeyy classes (abtn / ainput / dcard / aempty …) instead of shadcn.
 * Mounted for both `/support` and `/support/:id`; it inspects the URL itself. */
import { useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import {
  useSupportTickets,
  useSupportTicket,
  useCreateSupportTicket,
  useSupportReply,
} from '@shared/pages/support/use-support';
import {
  formatTicketTime,
  uploadTicketAttachment,
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  type SupportAttachment,
  type TicketCategory,
  type TicketComment,
  type TicketPriority,
} from '@shared/pages/support/model';
import { Icon, Modal } from '../components';
import { useToast } from '../toast';

export function Support() {
  const [detail, params] = useRoute('/support/:id');
  if (detail && params?.id) return <TicketDetail id={params.id} />;
  return <TicketList />;
}

/* Small muted status chip — Adeyy keeps status monochrome, not coloured. */
function StatusChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        color: 'var(--ink-60)',
        background: 'var(--bg-inset)',
        borderRadius: 'var(--ar)',
        padding: '3px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

/* ── List + create ────────────────────────────────────────────────────── */

function TicketList() {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const list = useSupportTickets();
  const tickets = list.data?.items ?? [];

  return (
    <div>
      <div className="apage-head">
        <h1>Support</h1>
        <span className="spacer" />
        <button className="abtn abtn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          New ticket
        </button>
      </div>

      {list.isLoading ? (
        <p
          className="mutetext"
          style={{ padding: '24px 0', textAlign: 'center' }}
        >
          Loading…
        </p>
      ) : tickets.length === 0 ? (
        <div className="aempty">
          <div className="serif">No tickets yet.</div>
          <p>
            Get help from our team — open a ticket and we&rsquo;ll reply here
            and by email.
          </p>
          <button
            className="abtn abtn-primary"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={15} />
            New ticket
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              className="dcard"
              onClick={() => navigate(`/support/${t.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                textAlign: 'left',
                padding: '14px 18px',
                cursor: 'pointer',
                font: 'inherit',
                width: '100%',
              }}
            >
              <span
                className="tnum"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--ink-40)',
                }}
              >
                #{t.ticketNumber}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontWeight: 'var(--w-semibold)',
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.subject}
                </span>
                <span className="mutetext" style={{ fontSize: 12 }}>
                  Updated {formatTicketTime(t.updatedAt)}
                </span>
              </span>
              <StatusChip label={STATUS_LABEL[t.status]} />
              <Icon name="chevronRight" size={16} />
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateTicketModal
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/support/${id}`)}
        />
      )}
    </div>
  );
}

function CreateTicketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { data: user } = useCurrentUser();
  const toast = useToast();
  const create = useCreateSupportTicket();

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('general');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [contactEmail, setContactEmail] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [subjectErr, setSubjectErr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment('drafts', file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err) {
      toast('Upload failed: ' + ((err as Error)?.message ?? 'unknown error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSubmit =
    subject.trim().length >= 3 &&
    body.trim().length > 0 &&
    !create.isPending &&
    !uploading;

  const submit = async () => {
    if (subject.trim().length < 3) {
      setSubjectErr(true);
      toast('Please add a subject (at least 3 characters).');
      return;
    }
    if (body.trim().length === 0) return;
    try {
      const ticket = await create.mutateAsync({
        subject: subject.trim(),
        category,
        priority,
        body: body.trim(),
        attachments,
        contactEmail: contactEmail.trim() || undefined,
      });
      toast(`Ticket #${ticket.ticketNumber} created`);
      onCreated(ticket.id);
    } catch (e) {
      toast('Error: ' + ((e as Error)?.message ?? 'could not create ticket'));
    }
  };

  return (
    <Modal title="New ticket" onClose={onClose} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="afield">
          <label>Subject</label>
          <input
            className={'ainput' + (subjectErr ? ' err' : '')}
            value={subject}
            autoFocus
            onChange={(e) => {
              setSubject(e.target.value);
              if (subjectErr) setSubjectErr(false);
            }}
            placeholder="Brief summary of your issue"
          />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="afield" style={{ flex: 1, minWidth: 180 }}>
            <label>Category</label>
            <select
              className="ainput"
              value={category}
              onChange={(e) => setCategory(e.target.value as TicketCategory)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="afield" style={{ flex: 1, minWidth: 180 }}>
            <label>Priority</label>
            <select
              className="ainput"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="afield">
          <label>Reply-to email</label>
          <input
            className="ainput"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={user?.email ?? 'you@example.com'}
          />
          <span className="hint">
            Leave blank to use {user?.email ?? 'your account email'}.
          </span>
        </div>

        <div className="afield">
          <label>Message</label>
          <textarea
            className="ainput"
            value={body}
            rows={5}
            style={{ resize: 'vertical' }}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe your issue in detail…"
          />
          <AttachControl
            attachments={attachments}
            uploading={uploading}
            fileRef={fileRef}
            onPick={onPick}
            onRemove={(i) =>
              setAttachments((prev) => prev.filter((_, j) => j !== i))
            }
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 18,
        }}
      >
        <button
          className="abtn abtn-quiet"
          onClick={onClose}
          disabled={create.isPending}
        >
          Cancel
        </button>
        <button
          className="abtn abtn-primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Creating…' : 'Create ticket'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);
  const reply = useSupportReply(id);
  const toast = useToast();

  return (
    <div>
      <div style={{ padding: '18px 0 14px' }}>
        <button
          type="button"
          className="backlink"
          onClick={() => navigate('/support')}
        >
          <Icon name="back" size={14} />
          All tickets
        </button>
      </div>

      {isLoading ? (
        <p
          className="mutetext"
          style={{ padding: '24px 0', textAlign: 'center' }}
        >
          Loading…
        </p>
      ) : isError || !data ? (
        <div className="aempty">
          <div className="serif">Ticket not found.</div>
          <p>
            This ticket may have been removed, or it isn&rsquo;t one of yours.
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderBottom: '1px solid var(--border-1)',
              paddingBottom: 16,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                fontSize: 12,
                color: 'var(--ink-40)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                #{data.ticket.ticketNumber}
              </span>
              <StatusChip label={STATUS_LABEL[data.ticket.status]} />
              <span>{PRIORITY_LABEL[data.ticket.priority]}</span>
              <span>·</span>
              <span>{CATEGORY_LABEL[data.ticket.category]}</span>
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 'var(--w-heavy)',
                letterSpacing: '-0.02em',
              }}
            >
              {data.ticket.subject}
            </h1>
            <span className="mutetext" style={{ fontSize: 12 }}>
              Opened {formatTicketTime(data.ticket.createdAt)}
            </span>
          </div>

          <Thread comments={data.comments as TicketComment[]} />

          {data.ticket.status === 'closed' ? (
            <p
              className="mutetext"
              style={{
                marginTop: 18,
                padding: '14px 16px',
                textAlign: 'center',
                fontSize: 13,
                border: '1px solid var(--border-1)',
                borderRadius: 'var(--ar-lg)',
                background: 'var(--bg-inset)',
              }}
            >
              This ticket is closed. Open a new ticket if you still need help.
            </p>
          ) : (
            <div style={{ marginTop: 18 }}>
              <Composer
                pathId={id}
                sending={reply.isPending}
                submitLabel="Reply"
                placeholder="Write a reply…"
                onSend={async ({ body, attachments }) => {
                  try {
                    await reply.mutateAsync({
                      ticketId: id,
                      body,
                      attachments,
                    });
                  } catch (e) {
                    toast(
                      'Error: ' +
                        ((e as Error)?.message ?? 'could not send reply'),
                    );
                    throw e;
                  }
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p
        className="mutetext"
        style={{ padding: '20px 0', textAlign: 'center', fontSize: 13 }}
      >
        No messages yet.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div
            key={c.id}
            style={{
              border:
                '1px solid ' +
                (isSupport ? 'var(--adeyy-tint-bd)' : 'var(--border-1)'),
              background: isSupport ? 'var(--adeyy-tint)' : 'var(--card)',
              borderRadius: 'var(--ar-lg)',
              padding: '12px 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  fontWeight: 'var(--w-semibold)',
                  color: isSupport ? 'var(--adeyy-ink)' : 'var(--ink)',
                }}
              >
                {isSupport ? 'Support' : 'You'}
              </span>
              <span style={{ color: 'var(--ink-40)' }}>
                {formatTicketTime(c.createdAt)}
              </span>
            </div>
            <p
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.55,
                color: 'var(--ink-80)',
              }}
            >
              {c.body}
            </p>
            {c.attachments?.map((a) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  marginTop: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12.5,
                  color: 'var(--adeyy-ink)',
                }}
              >
                <Icon name="download" size={14} />
                {a.name}
              </a>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── Composer + attach control ────────────────────────────────────────── */

function AttachControl({
  attachments,
  uploading,
  fileRef,
  onPick,
  onRemove,
}: {
  attachments: SupportAttachment[];
  uploading: boolean;
  fileRef: React.RefObject<HTMLInputElement>;
  onPick: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}
    >
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {attachments.map((a, i) => (
            <span
              key={a.url}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--ink-80)',
                border: '1px solid var(--border-1)',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--ar)',
                padding: '4px 8px',
              }}
            >
              <span
                style={{
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {a.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemove(i)}
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--ink-40)',
                  display: 'inline-flex',
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div>
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => onPick(e.target.files)}
        />
        <button
          type="button"
          className="abtn abtn-ghost abtn-sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="upload" size={14} />
          {uploading ? 'Uploading…' : 'Attach'}
        </button>
      </div>
    </div>
  );
}

function Composer({
  onSend,
  sending,
  placeholder = 'Write a reply…',
  pathId = 'drafts',
  submitLabel = 'Send',
}: {
  onSend: (input: {
    body: string;
    attachments: SupportAttachment[];
  }) => void | Promise<void>;
  sending?: boolean;
  placeholder?: string;
  pathId?: string;
  submitLabel?: string;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment(pathId, file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err) {
      toast('Upload failed: ' + ((err as Error)?.message ?? 'unknown error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSend = body.trim().length > 0 && !sending && !uploading;

  const submit = async () => {
    if (!canSend) return;
    await onSend({ body: body.trim(), attachments });
    setBody('');
    setAttachments([]);
  };

  return (
    <div
      style={{
        border: '1px solid var(--border-1)',
        background: 'var(--card)',
        borderRadius: 'var(--ar-lg)',
        padding: 12,
      }}
    >
      <textarea
        className="ainput"
        value={body}
        rows={3}
        style={{
          resize: 'vertical',
          border: 0,
          padding: 4,
          background: 'transparent',
        }}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 6,
        }}
      >
        <AttachControl
          attachments={attachments}
          uploading={uploading}
          fileRef={fileRef}
          onPick={onPick}
          onRemove={(i) =>
            setAttachments((prev) => prev.filter((_, j) => j !== i))
          }
        />
        <button
          className="abtn abtn-primary"
          disabled={!canSend}
          onClick={() => void submit()}
        >
          {sending ? 'Sending…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
