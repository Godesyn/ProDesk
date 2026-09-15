/**
 * SendDialog — modal for sending the proposal via SMS or email.
 * Uses shadcn Dialog internally.
 */
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Icon } from "./atoms";

interface SendDialogProps {
  open: boolean;
  onClose: () => void;
  onSend: (channel: "sms" | "email", recipient: string) => Promise<void>;
  defaultPhone?: string;
  defaultEmail?: string;
  proposalTitle: string;
  clientName?: string;
  isSending?: boolean;
}

export function SendDialog({
  open, onClose, onSend, defaultPhone, defaultEmail, proposalTitle, clientName, isSending,
}: SendDialogProps) {
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [recipient, setRecipient] = useState(channel === "sms" ? (defaultPhone ?? "") : (defaultEmail ?? ""));
  const [error, setError] = useState("");

  function handleChannelChange(c: "sms" | "email") {
    setChannel(c);
    setRecipient(c === "sms" ? (defaultPhone ?? "") : (defaultEmail ?? ""));
    setError("");
  }

  async function handleSend() {
    if (!recipient.trim()) {
      setError(channel === "sms" ? "Phone number required" : "Email address required");
      return;
    }
    setError("");
    try {
      await onSend(channel, recipient.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send");
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent style={{ maxWidth: 480 }}>
        <DialogHeader>
          <DialogTitle>Send proposal</DialogTitle>
          <DialogDescription>
            {clientName ? `Sending "${proposalTitle}" to ${clientName}` : `Sending "${proposalTitle}"`}
          </DialogDescription>
        </DialogHeader>

        {/* Channel selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["sms", "email"] as const).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => handleChannelChange(c)}
              style={{
                flex: 1, padding: "10px 16px",
                borderRadius: 8,
                border: `1px solid ${channel === c ? "var(--ink)" : "var(--border-2)"}`,
                background: channel === c ? "var(--ink)" : "transparent",
                color: channel === c ? "var(--paper)" : "var(--ink)",
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <Icon name={c === "sms" ? "mobile" : "link"} size={14} />
              {c === "sms" ? "SMS" : "Email"}
            </button>
          ))}
        </div>

        {/* Recipient input */}
        <div className="field">
          <label>{channel === "sms" ? "Phone number" : "Email address"}</label>
          <input
            className={`input${error ? " error" : ""}`}
            type={channel === "sms" ? "tel" : "email"}
            value={recipient}
            onChange={e => { setRecipient(e.target.value); setError(""); }}
            placeholder={channel === "sms" ? "+61 4XX XXX XXX" : "client@example.com"}
            autoFocus
          />
          {error && (
            <span className="error-pill">
              <Icon name="x" size={11} />
              {error}
            </span>
          )}
        </div>

        {/* Info note */}
        <p style={{ fontSize: 12, color: "var(--ink-60)", marginTop: 8, lineHeight: 1.5 }}>
          {channel === "sms"
            ? "A secure link will be sent via SMS. The client can view and accept the proposal on any device."
            : "A secure link will be sent via email. The client can view and accept the proposal on any device."}
        </p>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose} disabled={isSending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleSend}
            disabled={isSending || !recipient.trim()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {isSending ? (
              <>
                <span style={{ width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 600ms linear infinite" }} />
                Sending…
              </>
            ) : (
              <>
                <Icon name="send" size={13} />
                Send proposal
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
