import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Button from "./Button";
import Icon from "./Icon";

const INVITE_KEY = "huddle_pending_invite_token";
const INVITE_EMAIL_KEY = "huddle_invite_email";

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("intro"); // "intro" | "signup" | "signin"
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const stashed = localStorage.getItem(INVITE_EMAIL_KEY);
    if (stashed) {
      setEmail(stashed);
      setMode("signup");
    }
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
      options: { redirectTo: redirectUrl() }
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  };

  // Passkey / quick sign-in. Discoverable-credential flow: no email needed —
  // the device shows the user their Huddle passkey(s) and they pick one.
  // On success, onAuthStateChange in App.jsx picks up the SIGNED_IN event.
  const signInWithPasskey = async () => {
    setPasskeyLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPasskey();
      if (error) {
        // Common, non-alarming cases: user cancelled the prompt, or this device
        // has no Huddle passkey yet. Keep the message gentle and point to email.
        const code = error.code || "";
        if (code === "webauthn_credential_not_found") {
          setError("No quick sign-in is set up on this device yet. Use email or Google below, then turn it on in your profile.");
        } else if (error.name === "NotAllowedError" || /cancel/i.test(error.message || "")) {
          setError(""); // user backed out — no need to shout
        } else {
          setError(error.message || "Couldn't sign in. Try email or Google.");
        }
        setPasskeyLoading(false);
      }
      // success → App.jsx reacts to SIGNED_IN; nothing else to do here.
    } catch (e) {
      setError("This device or browser doesn't support quick sign-in. Use email or Google.");
      setPasskeyLoading(false);
    }
  };

  const sendLink = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectUrl() }
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
  const primaryBtn = {
    width: "100%", padding: "0.95rem", borderRadius: "10px", border: "none",
    background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer"
  };
  const ghostBtn = {
    width: "100%", padding: "0.85rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "transparent",
    color: "#8AAEC8", fontSize: "1rem", fontWeight: "500", cursor: "pointer"
  };
  const googleBtn = {
    width: "100%", padding: "0.85rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#FFFFFF",
    color: "#1F1F1F", fontSize: "1rem", fontWeight: "500",
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", gap: "10px", marginBottom: "1rem"
  };
  const passkeyBtn = {
    width: "100%", padding: "0.85rem", borderRadius: "10px",
    border: "1px solid #02C39A", background: "#0F3D2E",
    color: "#02C39A", fontSize: "1rem", fontWeight: "600",
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", gap: "10px", marginBottom: "1rem"
  };

  // Shared auth controls rendered inline (NOT as a nested component, which
  // would remount the input every keystroke and drop focus).
  const renderAuthControls = (ctaLabel) => (
    <>
      <button onClick={signInWithGoogle} disabled={googleLoading} style={googleBtn}>
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
          <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
          <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
          <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
        </svg>
        {googleLoading ? "Connecting..." : "Continue with Google"}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
        <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
        <span style={{ color: "#607080", fontSize: "0.8rem" }}>or</span>
        <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
      </div>

      <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1rem" }}>Continue with email</p>
      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendLink()}
        style={inputStyle}
      />
      {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
      <Button fullWidth variant="primary" onClick={sendLink} disabled={loading || !email}
        style={{ background: loading ? "#028090" : "#02C39A" }}>
        {loading ? "Sending..." : ctaLabel}
      </Button>
    </>
  );

  return (
    <div style={{
      minHeight: "100vh", background: "#0F2044", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "2rem", fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "3rem", fontWeight: "700", margin: "0 0 0.5rem" }}>
        Huddle
      </h1>
      <p style={{ color: "#B0C4D8", fontSize: "1rem", margin: "0 0 2.5rem", textAlign: "center", maxWidth: "360px", lineHeight: "1.5" }}>
        Playdates &amp; birthdays with your school's parents — minus the group-text chaos.
      </p>

      <div style={{ background: "#162D50", borderRadius: "16px", padding: "2rem", width: "100%", maxWidth: "400px" }}>

        {mode === "intro" && !sent && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", margin: "0 0 0.6rem", textAlign: "center" }}>
              Welcome to Huddle
            </h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem", textAlign: "center", lineHeight: "1.55" }}>
              Huddle connects you with the parents in your kid's classroom, so planning playdates and birthday parties takes a few taps — not a dozen group texts.
            </p>

            {/* What you can do — three concrete points */}
            <div style={{ marginBottom: "1.75rem" }}>
              {[
                { icon: "groups", text: "Find the parents in your kid's classes" },
                { icon: "calendar_month", text: "Set up playdates everyone can RSVP to" },
                { icon: "celebration", text: "Invite the whole class to a birthday" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0.6rem 0" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#0F3D2E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name={item.icon} size={20} color="#02C39A" />
                  </div>
                  <span style={{ color: "#D8E4F0", fontSize: "0.9rem", lineHeight: "1.4" }}>{item.text}</span>
                </div>
              ))}
            </div>

            <Button fullWidth variant="primary" onClick={() => { setError(""); setMode("signup"); }} style={{ marginBottom: "0.85rem" }}>
              Get started<Icon name="arrow_forward" size={18} style={{ verticalAlign: "-3px", marginLeft: 4 }} />
            </Button>
            <Button fullWidth variant="ghost" onClick={() => { setError(""); setMode("signin"); }}>
              I already have an account
            </Button>
          </>
        )}

        {mode === "signup" && !sent && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.4rem" }}>Create your account</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.88rem", margin: "0 0 1.5rem", lineHeight: "1.5" }}>
              Sign up with Google or your email — we'll send a quick magic link, no password needed.
            </p>
            {renderAuthControls("Sign up with email →")}
            <button onClick={() => { setError(""); setMode("intro"); }}
              style={{ ...ghostBtn, border: "none", color: "#607080", marginTop: "1rem", fontSize: "0.85rem" }}>
              <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back
            </button>
          </>
        )}

        {mode === "signin" && !sent && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.4rem" }}>Welcome back</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.88rem", margin: "0 0 1.5rem", lineHeight: "1.5" }}>
              Use quick sign-in if you've set it up, or sign in with Google or your email.
            </p>

            {/* Fast path: passkey / quick sign-in. Sits above the rest as the 1-tap return. */}
            <button onClick={signInWithPasskey} disabled={passkeyLoading} style={passkeyBtn}>
              <Icon name="lock" size={20} color="#B8CCE0" />
              {passkeyLoading ? "Waiting for your device..." : "Quick sign-in"}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
              <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
              <span style={{ color: "#607080", fontSize: "0.8rem" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
            </div>

            {renderAuthControls("Send magic link →")}
            <button onClick={() => { setError(""); setMode("intro"); }}
              style={{ ...ghostBtn, border: "none", color: "#607080", marginTop: "1rem", fontSize: "0.85rem" }}>
              <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back
            </button>
          </>
        )}

        {sent && (
          <>
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <p style={{ margin: "0 0 1rem" }}><Icon name="mail" size={52} color="#3E5A7F" /></p>
              <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.75rem" }}>Check your email</h2>
              <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem", lineHeight: "1.6" }}>
                We sent a magic link to <strong style={{ color: "#FFFFFF" }}>{email}</strong>.
                Tap the link in your email to continue.
              </p>
              <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>
                Didn't get it? Check your spam folder.
              </p>
            </div>
            <button onClick={() => { setSent(false); setEmail(""); setMode("intro"); }} style={{ ...ghostBtn, marginTop: "1.5rem" }}>
              <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Start over
            </button>
          </>
        )}
      </div>
    </div>
  );
}