import { useState } from "react";
import { supabase } from "./supabase";

export default function Auth({ onAuth }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendLink = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
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

  const buttonStyle = {
    width: "100%", padding: "0.85rem", borderRadius: "10px",
    border: "none", background: loading ? "#028090" : "#02C39A",
    color: "#0F2044", fontSize: "1rem", fontWeight: "600",
    cursor: loading ? "not-allowed" : "pointer"
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
            <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.5rem" }}>Welcome</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
              Enter your email to get started
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
            <button onClick={sendLink} disabled={loading || !email} style={buttonStyle}>
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
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              style={{ ...buttonStyle, marginTop: "1.5rem", background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8" }}>
              ← Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}