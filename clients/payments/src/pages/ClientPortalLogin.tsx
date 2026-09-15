/**
 * Client Portal Login
 * Public page where clients request a magic-link to access their portal.
 * Route: /client-portal/login
 */
import { useState } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useMutation } from "@tanstack/react-query";

export default function ClientPortalLogin() {
  const trpc = useTRPC();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const requestLink = useMutation({
    ...trpc.payments.clientPortal.requestMagicLink.mutationOptions(),
    onSuccess: () => setSent(true),
    onError: (e) => setError(e.message || "Something went wrong. Please try again."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return;
    requestLink.mutate({ email: email.trim(), origin: window.location.origin });
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#F4F1E8",
      padding: "24px",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40 }}>
        <img src="/logo-wordmark.svg" alt="EziQuotes" style={{ height: 26, width: "auto", objectFit: "contain" }} />
        <span style={{
          fontSize: 11, fontWeight: 600, color: "#0E0E0C",
          background: "rgba(14,14,12,0.08)",
          padding: "2px 8px", borderRadius: 4, letterSpacing: "0.06em", textTransform: "uppercase",
        }}>Client Portal</span>
      </div>

      <div style={{
        background: "#fff",
        borderRadius: 16,
        padding: "40px 36px",
        width: "100%",
        maxWidth: 420,
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      }}>
        {sent ? (
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "#D9F542",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
              fontSize: 24,
            }}>✓</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#0E0E0C" }}>
              Check your inbox
            </h2>
            <p style={{ margin: 0, color: "#666", lineHeight: 1.6, fontSize: 14 }}>
              We've sent a login link to <strong>{email}</strong>. Click the link in the email to access your portal. It expires in 24 hours.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              style={{
                marginTop: 24,
                background: "none",
                border: "none",
                color: "#0E0E0C",
                fontSize: 13,
                cursor: "pointer",
                textDecoration: "underline",
                opacity: 0.6,
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700, color: "#0E0E0C", letterSpacing: "-0.02em" }}>
              Client portal
            </h1>
            <p style={{ margin: "0 0 28px", color: "#666", fontSize: 14, lineHeight: 1.6 }}>
              Enter your email address and we'll send you a secure login link.
            </p>

            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#0E0E0C", marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: "1.5px solid #e0ddd4",
                  borderRadius: 8,
                  fontSize: 15,
                  color: "#0E0E0C",
                  background: "#FAFAF7",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 150ms",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#0E0E0C")}
                onBlur={(e) => (e.target.style.borderColor = "#e0ddd4")}
              />

              {error && (
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "#e53e3e" }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={requestLink.isPending || !email.trim()}
                style={{
                  marginTop: 16,
                  width: "100%",
                  padding: "13px",
                  background: requestLink.isPending ? "#ccc" : "#0E0E0C",
                  color: requestLink.isPending ? "#888" : "#D9F542",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: requestLink.isPending ? "not-allowed" : "pointer",
                  transition: "opacity 150ms",
                  letterSpacing: "-0.01em",
                }}
              >
                {requestLink.isPending ? "Sending…" : "Send login link →"}
              </button>
            </form>

            <p style={{ margin: "20px 0 0", fontSize: 12, color: "#999", textAlign: "center", lineHeight: 1.6 }}>
              No password needed. We'll email you a secure one-time link.
            </p>
          </>
        )}
      </div>

      <p style={{ marginTop: 24, fontSize: 12, color: "#999" }}>
        Powered by <strong style={{ color: "#0E0E0C" }}>EziQuotes</strong>
      </p>
    </div>
  );
}
