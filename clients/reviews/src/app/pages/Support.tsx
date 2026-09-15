/* Verdiict — Support. A NATIVE support screen skinned in the `v` design system,
 * rendered inside the Verdiict app shell (not the shared main-app page). What's
 * shared is only the DATA layer: the tRPC/query hooks (`@shared/pages/support/
 * use-support`) and the pure model (types/labels/options/upload helper). The
 * presentation here matches Team/Billing. One component renders both the ticket
 * list (with a create modal) and the single-ticket thread, deciding by the wouter
 * route (`/support` vs `/support/:id`), the same way the template reference does.
 * Tickets are creator-scoped on the server; a closed ticket rejects replies. */
import { useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Send,
  X,
} from 'lucide-react';
import {
  useCreateSupportTicket,
  useSupportReply,
  useSupportTicket,
  useSupportTickets,
} from '@shared/pages/support/use-support';
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  formatTicketTime,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  uploadTicketAttachment,
  type SupportAttachment,
  type TicketCategory,
  type TicketComment,
  type TicketPriority,
} from '@shared/pages/support/model';
import { useCurrentUser } from '@shared/auth/auth-context';
import { Modal, SkeletonRows } from '../components';
import { useToast } from '../toast';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  fontWeight: 600,
  marginBottom: 6,
};

/** The component is mounted for BOTH `/support` and `/support/:id`; it inspects
 * the URL itself and renders the list or a single ticket accordingly. */
export function Support() {
  const [detail, params] = useRoute('/support/:id');
  if (detail && params?.id) return <TicketDetail id={params.id} />;
  return <TicketList />;
}

/* ── List + create ────────────────────────────────────────────────────── */

function TicketList() {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const list = useSupportTickets();
  const tickets = list.data?.items ?? [];

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Support</h1>
          <p>Open a ticket and our team replies here and by email.</p>
        </div>
        <button className="vbtn vbtn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} />
          New ticket
        </button>
      </div>

      {list.isLoading ? (
        <div className="vcard">
          <SkeletonRows rows={4} />
        </div>
      ) : tickets.length === 0 ? (
        <div className="vempty">
          <span className="serif">No tickets yet.</span>
          <p>Need a hand? Open a ticket and we&rsquo;ll get back to you.</p>
          <button className="vbtn vbtn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            New ticket
          </button>
        </div>
      ) : (
        <div className="vcard" style={{ padding: 0 }}>
          <table className="vtable">
            <thead>
              <tr>
                <th style={{ width: 70 }}>#</th>
                <th>Subject</th>
                <th>Updated</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/support/${t.id}`)}
                >
                  <td className="mono vmuted" style={{ fontSize: 12.5 }}>
                    #{t.ticketNumber}
                  </td>
                  <td style={{ fontWeight: 600 }}>{t.subject}</td>
                  <td className="vmuted" style={{ fontSize: 12.5 }}>
                    Updated {formatTicketTime(t.updatedAt)}
                  </td>
                  <td>
                    <span className="vbadge">{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <ChevronRight size={16} style={{ color: 'var(--v-muted)' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateTicketModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/support/${id}`);
          }}
        />
      )}
    </>
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

  const canSubmit =
    subject.trim().length >= 3 &&
    body.trim().length > 0 &&
    !create.isPending &&
    !uploading;

  async function submit() {
    if (subject.trim().length < 3) {
      toast('Please add a subject (at least 3 characters).');
      return;
    }
    if (!body.trim()) {
      toast('Please describe your issue.');
      return;
    }
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
      toast('Error: ' + errMsg(e));
    }
  }

  return (
    <Modal title="New ticket" onClose={onClose} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Subject</label>
          <input
            className="vinput"
            value={subject}
            autoFocus
            placeholder="Brief summary of your issue"
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Category</label>
            <select
              className="vinput"
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
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Priority</label>
            <select
              className="vinput"
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
        <div>
          <label style={labelStyle}>Reply-to email</label>
          <input
            className="vinput"
            type="email"
            value={contactEmail}
            placeholder={user?.email ?? 'you@example.com'}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <div className="vmuted" style={{ fontSize: 12, marginTop: 6 }}>
            Leave blank to use {user?.email ?? 'your account email'}.
          </div>
        </div>
        <div>
          <label style={labelStyle}>Message</label>
          <textarea
            className="vinput"
            rows={5}
            value={body}
            placeholder="Describe your issue in detail…"
            style={{ resize: 'vertical' }}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <AttachControl
          pathId="drafts"
          attachments={attachments}
          setAttachments={setAttachments}
          uploading={uploading}
          setUploading={setUploading}
          onError={(m) => toast(m)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="vbtn vbtn-quiet" onClick={onClose} disabled={create.isPending}>
          Cancel
        </button>
        <button className="vbtn vbtn-primary" disabled={!canSubmit} onClick={submit}>
          {create.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
          Create ticket
        </button>
      </div>
    </Modal>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);

  return (
    <>
      <button
        type="button"
        className="vbtn vbtn-quiet vbtn-sm"
        style={{ marginBottom: 16 }}
        onClick={() => navigate('/support')}
      >
        <ArrowLeft size={15} />
        All tickets
      </button>

      {isLoading ? (
        <div className="vcard">
          <SkeletonRows rows={3} />
        </div>
      ) : isError || !data ? (
        <div className="vempty">
          <span className="serif">Ticket not found.</span>
          <p>It may have been removed, or the link is out of date.</p>
        </div>
      ) : (
        <>
          <div className="vpagehead">
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
                <span className="mono vmuted" style={{ fontSize: 12.5 }}>
                  #{data.ticket.ticketNumber}
                </span>
                <span className="vbadge">{STATUS_LABEL[data.ticket.status]}</span>
                <span className="vmuted" style={{ fontSize: 12.5 }}>
                  {PRIORITY_LABEL[data.ticket.priority]} · {CATEGORY_LABEL[data.ticket.category]}
                </span>
              </div>
              <h1>{data.ticket.subject}</h1>
              <p>Opened {formatTicketTime(data.ticket.createdAt)}</p>
            </div>
          </div>

          <Thread comments={data.comments as TicketComment[]} />

          {data.ticket.status === 'closed' ? (
            <div className="vbanner" style={{ marginTop: 16 }}>
              <span className="vmuted">
                This ticket is closed. Open a new ticket if you still need help.
              </span>
            </div>
          ) : (
            <ReplyComposer ticketId={id} />
          )}
        </>
      )}
    </>
  );
}

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="vmuted" style={{ textAlign: 'center', padding: '24px 0', fontSize: 14 }}>
        No messages yet.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div
            key={c.id}
            className="vcard"
            style={
              isSupport
                ? {
                    borderColor: 'color-mix(in srgb, var(--v-accent) 40%, var(--v-line))',
                    background: 'color-mix(in srgb, var(--v-accent) 8%, var(--v-card))',
                  }
                : undefined
            }
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                fontSize: 12.5,
              }}
            >
              <span style={{ fontWeight: 600 }}>{isSupport ? 'Support' : 'You'}</span>
              <span className="vmuted">{formatTicketTime(c.createdAt)}</span>
            </div>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>
              {c.body}
            </p>
            {c.attachments?.map((a) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 10,
                  fontSize: 12.5,
                  color: 'var(--v-accent)',
                }}
              >
                <FileText size={14} />
                {a.name}
              </a>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ReplyComposer({ ticketId }: { ticketId: string }) {
  const toast = useToast();
  const reply = useSupportReply(ticketId);
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const canSend = body.trim().length > 0 && !reply.isPending && !uploading;

  async function send() {
    if (!canSend) return;
    try {
      await reply.mutateAsync({ ticketId, body: body.trim(), attachments });
      setBody('');
      setAttachments([]);
    } catch (e) {
      toast('Error: ' + errMsg(e));
    }
  }

  return (
    <div className="vcard" style={{ marginTop: 16 }}>
      <textarea
        className="vinput"
        rows={3}
        value={body}
        placeholder="Write a reply…"
        style={{ resize: 'vertical' }}
        onChange={(e) => setBody(e.target.value)}
      />
      <div style={{ marginTop: 12 }}>
        <AttachControl
          pathId={ticketId}
          attachments={attachments}
          setAttachments={setAttachments}
          uploading={uploading}
          setUploading={setUploading}
          onError={(m) => toast(m)}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="vbtn vbtn-primary" disabled={!canSend} onClick={send}>
          {reply.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          Reply
        </button>
      </div>
    </div>
  );
}

/* ── Shared attach control ────────────────────────────────────────────── */

function AttachControl({
  pathId,
  attachments,
  setAttachments,
  uploading,
  setUploading,
  onError,
}: {
  pathId: string;
  attachments: SupportAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<SupportAttachment[]>>;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  onError: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (attachments.length + files.length > 20) {
      onError('You can attach up to 20 files.');
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment(pathId, file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (e) {
      onError(errMsg(e) || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {attachments.map((a, i) => (
            <span
              key={a.url}
              className="vbadge"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FileText size={13} />
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                style={{
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--v-muted)',
                  display: 'inline-flex',
                  padding: 0,
                }}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => onPick(e.target.files)}
      />
      <button
        type="button"
        className="vbtn vbtn-quiet vbtn-sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
        {uploading ? 'Uploading…' : 'Attach files'}
      </button>
    </div>
  );
}
