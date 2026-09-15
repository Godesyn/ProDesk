/**
 * TopBar — builder chrome: wordmark, breadcrumb, save state, preview toggle, save draft button.
 * CSS: .tb, .tb-left, .tb-wordmark, .tb-divider, .tb-crumb, .tb-name, .tb-save-state
 *
 * PHASE2-45: Save Draft button added to right side of TopBar.
 */
import { useRef, useEffect, useState } from "react";
import { Icon } from "./atoms";
import type { SaveState } from "./types";
import { LazyImage } from "@shared/components/ui/lazy-image";

interface TopBarProps {
  title: string;
  onTitleChange: (v: string) => void;
  saveState: SaveState;
  proposalSlug?: string;
  onPreview: () => void;
  onSaveDraft?: () => void;
  onSend?: () => void;
  onBack: () => void;
  wordmarkUrl?: string;
  /** Current user for avatar — passed from ProposalBuilder via useAuth() */
  user?: { name?: string; email?: string } | null;
  /** Logout callback from useAuth() */
  onLogout?: () => void;
}

export function TopBar({
  title, onTitleChange, saveState, proposalSlug, onPreview, onSaveDraft, onBack,
  wordmarkUrl, user, onLogout,
}: TopBarProps) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  // Sync contenteditable to title prop
  useEffect(() => {
    if (nameRef.current && nameRef.current.textContent !== title) {
      nameRef.current.textContent = title;
    }
  }, [title]);

  const previewTitle = !proposalSlug
    ? "Add a title and at least one item to enable preview"
    : "Preview proposal as client will see it";

  return (
    <div className="tb">
      {/* Left: wordmark + breadcrumb */}
      <div className="tb-left">
        <button
          type="button"
          className="tb-wordmark"
          onClick={onBack}
          title="Back to proposals"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {wordmarkUrl ? (
            <LazyImage src={wordmarkUrl} alt="EziQuotes" wrapperClassName="h-[18px] w-auto flex-shrink-0" className="object-contain" />
          ) : (
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.03em", color: "var(--ink)" }}>
              EziQuotes
            </span>
          )}
        </button>

        <div className="tb-divider" />

        <div className="tb-crumb">
          <button
            type="button"
            onClick={onBack}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-60)", fontSize: 13, padding: 0 }}
          >
            Proposals
          </button>
          <span className="sep" style={{ color: "var(--ink-40)" }}>/</span>
          <span
            ref={nameRef}
            className="tb-name"
            contentEditable
            suppressContentEditableWarning
            onBlur={e => onTitleChange(e.currentTarget.textContent ?? "")}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            spellCheck={false}
          />
        </div>

        {/* Save state indicator */}
        <div
          className={`tb-save-state${saveState.saving ? " saving" : ""}`}
          style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-40)" }}
        >
          <span
            className="dot"
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: saveState.saving ? "var(--volt)" : saveState.saved ? "var(--volt)" : "var(--ink-20)",
              display: "inline-block",
              transition: "background 200ms",
            }}
          />
          {saveState.saving ? "Saving…" : saveState.saved ? "Saved" : "Draft"}
        </div>
      </div>

      {/* Right: save draft + preview + user avatar */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {/* PHASE2-45: Save Draft button — triggers immediate autosave */}
        {onSaveDraft && (
          <button
            type="button"
            className="btn"
            onClick={onSaveDraft}
            disabled={saveState.saving}
            title="Save draft"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              opacity: saveState.saving ? 0.5 : 1,
            }}
          >
            <Icon name="save" size={13} />
            Save draft
          </button>
        )}

        {/* Preview is always visible; opacity dims when not yet saveable */}
        <button
          type="button"
          className="btn"
          onClick={proposalSlug ? onPreview : undefined}
          title={previewTitle}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            opacity: proposalSlug ? 1 : 0.45,
            cursor: proposalSlug ? "pointer" : "not-allowed",
          }}
        >
          <Icon name="eye" size={13} />
          Preview
        </button>

        {/* User avatar with logout dropdown */}
        {(user || onLogout) && (
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setUserMenuOpen(o => !o)}
              title={user?.name ?? "Account"}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "var(--bg-inset)",
                border: "1px solid var(--border-2)",
                fontWeight: 600, fontSize: 12,
                color: "var(--ink)",
              }}
            >
              {user?.name?.charAt(0).toUpperCase() ?? "?"}
            </button>
            {userMenuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 400,
                  background: "var(--bg-card)", border: "1px solid var(--border-1)",
                  borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                  minWidth: 180, padding: "4px 0",
                }}
              >
                {user && (
                  <div style={{ padding: "8px 14px 6px", borderBottom: "1px solid var(--border-1)", marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>{user.name}</div>
                    {user.email && <div style={{ fontSize: 11, color: "var(--ink-60)", marginTop: 2 }}>{user.email}</div>}
                  </div>
                )}
                {onLogout && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); onLogout(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", textAlign: "left",
                      padding: "7px 14px",
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 13, color: "var(--danger, #e53e3e)",
                    }}
                  >
                    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M10 3h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3M7 11l3-3-3-3M10 8H1" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
