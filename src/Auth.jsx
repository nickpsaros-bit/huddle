import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const INVITE_KEY = "huddle_pending_invite_token";
const INVITE_EMAIL_KEY = "huddle_invite_email";

export default function Auth({ onAuth }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill the email captured on the invite landing page (so they sign up
  // with the same email we stamped onto the invite, enabling reliable matching).
  useEffect(() => {
    const stashed = localStorage.getItem(INVITE_EMAIL_KEY);
    if (stashed) setEmail(stashed);
  }, []);

  const redirectUrl = () => {
    const base = window.location.origin;
    const token = localStorage.getItem(INVITE_KEY);
    return token ? `${base}/?invite=${encodeURIComponent(token)}` : base;
  };

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl(),
      }
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  };

  const sendLink = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectUrl(),
      }
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0F2044", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "2rem", fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "3rem", fontWeight: "700", margin: "0 0 0.5rem" }}>
        Huddle
      </h1>
      <p style={{ color: "#B0C4D8", fontSize: "1rem", margin: "0 0 3rem" }}>
        The social app for school families
      </p>

      <div style={{ background: "#162D50", borderRadius: "16px", padding: "2rem", width: "100%", maxWidth: "400px" }}>
        {!sent ? (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 1.5rem" }}>Welcome</h2>

            {/* Google Sign In */}
            <button
              onClick={signInWithGoogle}
              disabled={googleLoading}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: "10px",
                border: "1px solid #2A4A6B", background: "#FFFFFF",
                color: "#1F1F1F", fontSize: "1rem", fontWeight: "500",
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: "10px", marginBottom: "1rem"
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              {googleLoading ? "Signing in..." : "Continue with Google"}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
              <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
              <span style={{ color: "#607080", fontSize: "0.8rem" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
            </div>

            {/* Email */}
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1rem" }}>
              Continue with email
            </p>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              style={inputStyle}
            />
            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
            <button onClick={sendLink} disabled={loading || !email}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: "10px",
                border: "none", background: loading ? "#028090" : "#02C39A",
                color: "#0F2044", fontSize: "1rem", fontWeight: "600",
                cursor: loading ? "not-allowed" : "pointer"
              }}>
              {loading ? "Sending..." : "Send magic link →"}
            </button>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <p style={{ fontSize: "3rem", margin: "0 0 1rem" }}>📬</p>
              <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.75rem" }}>Check your email</h2>
              <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem", lineHeight: "1.6" }}>
                We sent a magic link to <strong style={{ color: "#FFFFFF" }}>{email}</strong>.
                Tap the link in your email to sign in.
              </p>
              <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>
                Didn't get it? Check your spam folder.
              </p>
            </div>
            <button onClick={() => { setSent(false); setEmail(""); }}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: "10px",
                border: "1px solid #2A4A6B", background: "transparent",
                color: "#8AAEC8", fontSize: "1rem", fontWeight: "600",
                cursor: "pointer", marginTop: "1.5rem"
              }}>
              ← Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}