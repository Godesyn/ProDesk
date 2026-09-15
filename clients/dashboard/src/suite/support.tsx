/* Prodesk Suite — NATIVE Support screen, skinned in the suite's Forest kit.
   The DATA layer is shared (@shared/pages/support/*); only the presentation lives
   here so Support reads as just another suite view (topbar + sidebar + .pd-page),
   not the foreign shared page. Mounted for both `/support` and `/support/:id`; it
   inspects the URL itself to decide list vs. detail (the suite is a URL-state
   machine, not a wouter Switch). */

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
import { Icon } from './icons';
import { Button, pushToast } from './ui';
import {
  FndHeader,
  FndEmpty,
  FndModal,
  FndInput,
  FndTextarea,
  FndSelect,
} from './fnd-shared';
import type { Brand } from './data';

/* Column template for the ticket list — number · subject · updated · status. */
const ROW_COLS = '64px minmax(0, 1fr) minmax(0, 150px) 104px';

function errMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong.';
}

export function SupportTool({ brand }: { brand: Brand }) {
  const [detail, params] = useRoute('/support/:id');
  if (detail && params?.id) return <TicketDetail id={params.id} brand={brand} />;
  return <TicketList brand={brand} />;
}

/* ── List + create ────────────────────────────────────────────────────── */

function TicketList({ brand }: { brand: Brand }) {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const list = useSupportTickets();
  const tickets = list.data?.items ?? [];

  return (
    <div>
      <FndHeader
        app={{ icon: 'lifebuoy', name: 'Support', tag: "We'll reply by email and here" }}
        brand={brand}
        pill="Help"
        primaryLabel="New ticket"
        onPrimary={() => setCreating(true)}
      />

      <div className="pd-fnd-table">
        <div className="pd-fnd-head" style={{ gridTemplateColumns: ROW_COLS }}>
          <span>#</span>
          <span>Subject</span>
          <span className="pd-hide-sm">Updated</span>
          <span>Status</span>
        </div>
        {list.isLoading ? (
          <div
            style={{
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 14,
            }}
          >
            Loading…
          </div>
        ) : tickets.length === 0 ? (
          <FndEmpty
            line="You haven't opened any tickets yet."
            cta="New ticket"
            onCta={() => setCreating(true)}
          />
        ) : (
          tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              className="pd-fnd-row"
              style={{ gridTemplateColumns: ROW_COLS }}
              onClick={() => navigate(`/support/${t.id}`)}
            >
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                #{t.ticketNumber}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.subject}
              </span>
              <span
                className="pd-hide-sm"
                style={{ fontSize: 12.5, color: 'var(--ink-3)' }}
              >
                {formatTicketTime(t.updatedAt)}
              </span>
              <span>
                <span className="pd-kind-pill">{STATUS_LABEL[t.status]}</span>
              </span>
            </button>
          ))
        )}
      </div>

      {creating && (
        <CreateTicket
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/support/${id}`)}
        />
      )}
    </div>
  );
}

function CreateTicket({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { data: user } = useCurrentUser();
  const create = useCreateSupportTicket();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('general');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [contactEmail, setContactEmail] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);

  const canSubmit =
    subject.trim().length >= 3 && body.trim().length > 0 && !create.isPending;

  const submit = async () => {
    if (subject.trim().length < 3) {
      pushToast('Please add a subject (at least 3 characters).', 'error');
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
      pushToast(`Ticket #${ticket.ticketNumber} created`, 'info');
      onCreated(ticket.id);
    } catch (e) {
      pushToast(errMessage(e), 'error');
    }
  };

  return (
    <FndModal
      title="New ticket"
      eyebrow="Get help from our team"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {create.isPending ? 'Creating…' : 'Create ticket'}
          </Button>
        </>
      }
    >
      <FndInput
        label="Subject"
        value={subject}
        onChange={setSubject}
        placeholder="Brief summary of your issue"
      />
      <FndSelect
        label="Category"
        value={CATEGORY_LABEL[category]}
        options={CATEGORY_OPTIONS.map((c) => CATEGORY_LABEL[c])}
        onChange={(label) => {
          const found = CATEGORY_OPTIONS.find((c) => CATEGORY_LABEL[c] === label);
          if (found) setCategory(found);
        }}
      />
      <FndSelect
        label="Priority"
        value={PRIORITY_LABEL[priority]}
        options={PRIORITY_OPTIONS.map((p) => PRIORITY_LABEL[p])}
        onChange={(label) => {
          const found = PRIORITY_OPTIONS.find((p) => PRIORITY_LABEL[p] === label);
          if (found) setPriority(found);
        }}
      />
      <FndInput
        label="Reply-to email"
        value={contactEmail}
        onChange={setContactEmail}
        type="email"
        placeholder={user?.email ?? 'you@example.com'}
        sub={`Leave blank to use ${user?.email ?? 'your account email'}.`}
      />
      <FndTextarea
        label="Message"
        value={body}
        onChange={setBody}
        rows={5}
        placeholder="Describe your issue in detail…"
      />
      <AttachField
        pathId="drafts"
        attachments={attachments}
        setAttachments={setAttachments}
      />
    </FndModal>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id, brand }: { id: string; brand: Brand }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);
  const reply = useSupportReply(id);
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);

  const send = async () => {
    if (body.trim().length === 0 || reply.isPending) return;
    try {
      await reply.mutateAsync({ ticketId: id, body: body.trim(), attachments });
      setBody('');
      setAttachments([]);
    } catch (e) {
      pushToast(errMessage(e), 'error');
    }
  };

  return (
    <div>
      <button
        type="button"
        className="pd-textlink"
        style={{ fontSize: 13, marginBottom: 16, display: 'inline-block' }}
        onClick={() => navigate('/support')}
      >
        ← All tickets
      </button>

      {isLoading ? (
        <div
          style={{
            padding: '40px 0',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 14,
          }}
        >
          Loading…
        </div>
      ) : isError || !data ? (
        <div
          style={{
            padding: '40px 0',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 14,
          }}
        >
          Ticket not found.
        </div>
      ) : (
        <>
          <FndHeader
            app={{
              icon: 'lifebuoy',
              name: data.ticket.subject,
              tag: `#${data.ticket.ticketNumber} · Opened ${formatTicketTime(
                data.ticket.createdAt,
              )}`,
            }}
            brand={brand}
            pill={STATUS_LABEL[data.ticket.status]}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 4,
              }}
            >
              <span className="pd-kind-pill">
                {PRIORITY_LABEL[data.ticket.priority]}
              </span>
              <span className="pd-kind-pill">
                {CATEGORY_LABEL[data.ticket.category]}
              </span>
            </div>
          </FndHeader>

          <Thread comments={(data.comments ?? []) as TicketComment[]} />

          {data.ticket.status === 'closed' ? (
            <p
              style={{
                margin: '20px 0 0',
                padding: '14px 16px',
                textAlign: 'center',
                fontSize: 13.5,
                color: 'var(--ink-3)',
                background: 'var(--paper-2)',
                border: '1px solid var(--rule-2)',
                borderRadius: 'var(--r-3)',
              }}
            >
              This ticket is closed. Open a new ticket if you still need help.
            </p>
          ) : (
            <div
              style={{
                marginTop: 20,
                background: 'var(--white)',
                border: '1px solid var(--rule-2)',
                borderRadius: 'var(--r-3)',
                padding: 14,
              }}
            >
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a reply…"
                rows={3}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: 'var(--font)',
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: 'var(--ink)',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <AttachField
                  pathId={id}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  inline
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={body.trim().length === 0 || reply.isPending}
                  onClick={() => void send()}
                >
                  {reply.isPending ? 'Sending…' : 'Reply'}
                </Button>
              </div>
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
        style={{
          padding: '32px 0',
          textAlign: 'center',
          fontSize: 13.5,
          color: 'var(--ink-3)',
        }}
      >
        No messages yet.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div key={c.id} className={isSupport ? 'pd-msg-ai' : 'pd-msg-me'}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 5,
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.75,
              }}
            >
              <span>{isSupport ? 'Support' : 'You'}</span>
              <span style={{ fontWeight: 400 }}>
                {formatTicketTime(c.createdAt)}
              </span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
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
                  marginTop: 8,
                  fontSize: 12.5,
                  color: 'inherit',
                  textDecoration: 'underline',
                }}
              >
                <Icon name="document" size={14} /> {a.name}
              </a>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── Attachment picker (shared by create + reply) ─────────────────────── */

function AttachField({
  pathId,
  attachments,
  setAttachments,
  inline = false,
}: {
  pathId: string;
  attachments: SupportAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<SupportAttachment[]>>;
  inline?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment(pathId, file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (e) {
      pushToast(errMessage(e), 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginBottom: inline ? 0 : 4 }}>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => void onPick(e.target.files)}
      />
      {attachments.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 7,
            marginBottom: 8,
          }}
        >
          {attachments.map((a, i) => (
            <span
              key={a.url}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--paper-2)',
                border: '1px solid var(--rule-2)',
                borderRadius: 'var(--r-2)',
                padding: '4px 8px',
                fontSize: 12,
                color: 'var(--ink-2)',
              }}
            >
              <Icon name="document" size={13} style={{ color: 'var(--ink-3)' }} />
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
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, j) => j !== i))
                }
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--ink-3)',
                  display: 'inline-flex',
                  padding: 0,
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        className="pd-textlink"
        style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="link" size={14} />
        {uploading ? 'Uploading…' : 'Attach'}
      </button>
    </div>
  );
}
