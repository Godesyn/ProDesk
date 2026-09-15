/**
 * Client Portal Verify
 * Handles the magic-link token from the email, stores session, and redirects to portal.
 * Route: /client-portal/verify?token=...
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useMutation } from "@tanstack/react-query";

export default function ClientPortalVerify() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const [error, setError] = useState("");

  const verifyToken = useMutation({
    ...trpc.payments.clientPortal.verifyToken.mutationOptions(),
    onSuccess: (data) => {
      // Store session in sessionStorage (cp_account_id now holds a brand uuid;
      // key name kept for parity with the export)
      sessionStorage.setItem("cp_session_token", data.sessionToken);
      sessionStorage.setItem("cp_client_id", String(data.clientId));
      sessionStorage.setItem("cp_account_id", String(data.brandId));
      navigate("/client-portal");
    },
    onError: (e) => {
      setError(e.message || "This link is invalid or has expired.");
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setError("No token found in the link. Please request a new login link.");
      return;
    }
    verifyToken.mutate({ token });
  }, []);

  if (error) {
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
        textAlign: "center",
      }}>
        <div style={{
          background: "#fff",
          borderRadius: 16,
          padding: "40px 36px",
          maxWidth: 420,
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#0E0E0C" }}>
            Link expired
          </h2>
          <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14, lineHeight: 1.6 }}>
            {error}
          </p>
          <a
            href="/client-portal/login"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              background: "#0E0E0C",
              color: "#D9F542",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Request a new link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#F4F1E8",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          border: "3px solid rgba(14,14,12,0.1)",
          borderTopColor: "#0E0E0C",
          animation: "spin 700ms linear infinite",
          margin: "0 auto 16px",
        }} />
        <p style={{ fontSize: 14, color: "#666", margin: 0 }}>Verifying your link…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
