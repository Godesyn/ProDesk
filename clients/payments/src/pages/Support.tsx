/**
 * NATIVE Support screen for the Payments (EziQuotes) frontend.
 *
 * Re-skin of the template reference (clients/_template/src/pages/Support.tsx) in
 * EziQuotes' bespoke `.pnl`/`.btn`/`.fld` design kit so it reads as just another
 * screen in this app. The DATA layer is shared and untouched:
 *   - `@shared/pages/support/use-support` — tRPC/query hooks.
 *   - `@shared/pages/support/model`       — types, labels, options, upload helper.
 *
 * Mounted (shelled) for both `/support` and `/support/:id`; it inspects the URL
 * itself to decide between the list/create view and a single ticket thread.
 */
import { useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { useCurrentUser } from "@shared/auth/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sanitizeError } from "@/lib/errorMessage";
import {
  useSupportTickets,
  useSupportTicket,
  useCreateSupportTicket,
  useSupportReply,
} from "@shared/pages/support/use-support";
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
  type TicketStatus,
} from "@shared/pages/support/model";

/** Map a ticket status onto one of EziQuotes' `.st` chip tones. */
const STATUS_TONE: Record<TicketStatus, string> = {
  open: "pending",
  in_progress: "sent",
  resolved: "accepted",
  closed: "cancelled",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--paper)",
  border: "1px solid var(--border-1)",
  borderRadius: 6,
  color: "var(--ink)",
};

export function Support() {
  const [detail, params] = useRoute("/support/:id");
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
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">SUPPORT</span>
          <h1>Support.</h1>
          <span className="sub">Get help from our team. Open a ticket and we'll reply by email and here.</span>
        </div>
        <div className="acts">
          <button className="btn primary" onClick={() => setCreating(true)}>New ticket</button>
        </div>
      </div>

      {list.isLoading ? (
        <div style={{ padding: 16, color: "var(--ink-60)" }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <div style={{ padding: 16, color: "var(--ink-60)" }}>
          You haven't opened any tickets yet. Start one with “New ticket”.
        </div>
      ) : (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Your tickets</h3>
            <span className="meta">{tickets.length} TOTAL</span>
          </div>
          <div className="pnl-body" style={{ padding: 0 }}>
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/support/${t.id}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 18px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border-1)",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-40)" }}>
                  #{t.ticketNumber}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.subject}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-40)" }}>
                    Updated {formatTicketTime(t.updatedAt)}
                  </span>
                </span>
                <span className={`st ${STATUS_TONE[t.status as TicketStatus]}`}>
                  <span className="d" />
                  {STATUS_LABEL[t.status as TicketStatus]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {creating && (
        <CreateTicketModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); navigate(`/support/${id}`); }}
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
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("general");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [contactEmail, setContactEmail] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateSupportTicket();

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment("drafts", file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err) {
      toast.error(sanitizeError(err, "Upload failed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (subject.trim().length < 3) {
      toast.error("Please add a subject (at least 3 characters).");
      return;
    }
    if (body.trim().length === 0) {
      toast.error("Please describe your issue.");
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
      toast.success(`Ticket #${ticket.ticketNumber} created`);
      onCreated(ticket.id);
    } catch (err) {
      toast.error(sanitizeError(err, "Failed to create ticket"));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="fld">
            <label>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
              style={inputStyle}
            />
          </div>
          <div className="fld-row">
            <div className="fld">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} style={inputStyle}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div className="fld">
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} style={inputStyle}>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="fld">
            <label>Reply-to email</label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={user?.email ?? "you@example.com"}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: "var(--ink-60)" }}>
              Leave blank to use {user?.email ?? "your account email"}.
            </div>
          </div>
          <div className="fld">
            <label>Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Describe your issue in detail…"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {attachments.map((a, i) => (
                <span
                  key={a.url}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--bg-inset)", border: "1px solid var(--border-1)", borderRadius: 6, fontSize: 12, color: "var(--ink-80)" }}
                >
                  <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", padding: 0, lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => onPick(e.target.files)} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <button className="btn ghost sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "Attach files"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" onClick={onClose} disabled={create.isPending}>Cancel</button>
              <button className="btn primary" onClick={submit} disabled={create.isPending || uploading}>
                {create.isPending ? "Creating…" : "Create ticket"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);

  return (
    <div className="page">
      <button
        type="button"
        onClick={() => navigate("/support")}
        style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: "var(--ink-60)", fontSize: 13, padding: 0 }}
      >
        ← All tickets
      </button>

      {isLoading ? (
        <div style={{ padding: 16, color: "var(--ink-60)" }}>Loading…</div>
      ) : isError || !data ? (
        <div style={{ padding: 16, color: "var(--ink-60)" }}>Ticket not found.</div>
      ) : (
        <>
          <div className="page-hd">
            <div className="ttl">
              <span className="eye" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>#{data.ticket.ticketNumber}</span>
                <span className={`st ${STATUS_TONE[data.ticket.status as TicketStatus]}`}>
                  <span className="d" />
                  {STATUS_LABEL[data.ticket.status as TicketStatus]}
                </span>
                <span>{PRIORITY_LABEL[data.ticket.priority as TicketPriority]}</span>
                <span>{CATEGORY_LABEL[data.ticket.category as TicketCategory]}</span>
              </span>
              <h1 style={{ fontSize: 24 }}>{data.ticket.subject}</h1>
              <span className="sub">Opened {formatTicketTime(data.ticket.createdAt)}</span>
            </div>
          </div>

          <Thread comments={data.comments as TicketComment[]} />

          {data.ticket.status === "closed" ? (
            <div style={{ padding: "12px 16px", background: "var(--bg-inset)", border: "1px solid var(--border-1)", borderRadius: 8, textAlign: "center", fontSize: 13, color: "var(--ink-60)" }}>
              This ticket is closed. Open a new ticket if you still need help.
            </div>
          ) : (
            <ReplyComposer id={id} />
          )}
        </>
      )}
    </div>
  );
}

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return <div style={{ padding: 16, color: "var(--ink-60)" }}>No messages yet.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {comments.map((c) => {
        const isSupport = c.authorRole === "support";
        return (
          <div
            key={c.id}
            className="pnl"
            style={
              isSupport
                ? { border: "1px solid var(--volt)", background: "rgba(217,245,66,0.08)" }
                : undefined
            }
          >
            <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>{isSupport ? "Support" : "You"}</span>
                <span style={{ color: "var(--ink-40)" }}>{formatTicketTime(c.createdAt)}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: "var(--ink-80)" }}>{c.body}</p>
              {c.attachments?.map((a) => (
                <a
                  key={a.url}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--ink)", textDecoration: "underline" }}
                >
                  {a.name}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReplyComposer({ id }: { id: string }) {
  const reply = useSupportReply(id);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment(id, file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err) {
      toast.error(sanitizeError(err, "Upload failed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const canSend = body.trim().length > 0 && !reply.isPending && !uploading;

  const submit = async () => {
    if (!canSend) return;
    try {
      await reply.mutateAsync({ ticketId: id, body: body.trim(), attachments });
      setBody("");
      setAttachments([]);
    } catch (err) {
      toast.error(sanitizeError(err, "Failed to send reply"));
    }
  };

  return (
    <div className="pnl">
      <div className="pnl-hd">
        <h3>Reply</h3>
      </div>
      <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Write a reply…"
          style={{ ...inputStyle, resize: "vertical" }}
        />
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {attachments.map((a, i) => (
              <span
                key={a.url}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--bg-inset)", border: "1px solid var(--border-1)", borderRadius: 6, fontSize: 12, color: "var(--ink-80)" }}
              >
                <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", padding: 0, lineHeight: 1 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => onPick(e.target.files)} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <button className="btn ghost sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "Attach files"}
          </button>
          <button className="btn primary" onClick={submit} disabled={!canSend}>
            {reply.isPending ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>
    </div>
  );
}
