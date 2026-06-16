import { useState, useEffect } from "react";
import { supabase } from "./supabase";

const INVITE_EMAIL_KEY = "huddle_invite_email";

// Landing page shown to a logged-out person who opened an invite link.
// Shows the inviter's name + photo, collects the invitee's email (which we
// stamp onto the invite row so we can match it after signup), then proceeds.
export default function InviteLanding({ token, onJoin }) {
  const [loading, setLoading] = useState(true);
  const [inviter, setInviter] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { lookup(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A Huddle parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const lookup = async () => {
    setLoading(true);
    try {
      const { data: invite } = await supabase
        .from("invites")
        .select("inviter_id, status, expires_at")
        .eq("token", token)
        .maybeSingle();

      if (!invite || invite.status !== "pending" || new Date(invite.expires_at).getTime() < Date.now()) {
        setInvalid(true);
        setLoading(false);
        return;
      }

      const { data: p } = await supabase
        .from("parents")
        .select("name, photo_url")
        .eq("id", invite.inviter_id)
        .single();
      setInviter(p || null);
    } catch (e) {
      setInvalid(true);
    }
    setLoading(false);
  };

  const proceed = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes("@")) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // Stamp the invitee's email onto the invite so we can match it after signup.
      await supabase.from("invites").update({ invited_email: clean }).eq("token", token);
      // Stash the email so Auth can pre-fill it (so they sign up with the same one).
      localStorage.setItem(INVITE_EMAIL_KEY, clean);
      onJoin();
    } catch (e) {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Huddle</p>
      </div>
    );
  }

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "0.75rem", boxSizing: "border-box"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "420px", textAlign: "center" }}>

        <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 2rem" }}>Huddle</h1>

        {invalid ? (
          <>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⏳</div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>This invite has expired</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 2rem", lineHeight: "1.5" }}>
              Invite links are valid for 48 hours. Ask the person who invited you to send a fresh one.
            </p>
            <button onClick={onJoin}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              Join Huddle anyway →
            </button>
          </>
        ) : (
          <>
            <div style={{ width: "96px", height: "96px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", margin: "0 auto 1.25rem", border: "3px solid #02C39A" }}>
              {inviter?.photo_url ? (
                <img src={inviter.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                inviter?.name?.charAt(0) || "?"
              )}
            </div>

            <h2 style={{ color: "#FFFFFF", fontSize: "1.4rem", fontWeight: "500", margin: "0 0 0.5rem" }}>
              {shortName(inviter?.name)} invited you to Huddle
            </h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.95rem", margin: "0 0 1.75rem", lineHeight: "1.6" }}>
              Huddle is the easiest way for parents to set up playdates. Enter your email to join — you'll be connected with {shortName(inviter?.name)} right away.
            </p>

            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && proceed()}
              style={inputStyle}
            />
            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>{error}</p>}

            <button onClick={proceed} disabled={submitting}
              style={{ width: "100%", padding: "0.95rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              {submitting ? "..." : "Join Huddle →"}
            </button>

            <p style={{ color: "#607080", fontSize: "0.78rem", margin: "1.25rem 0 0", lineHeight: "1.5" }}>
              Free to join. Other parents only ever see your first name and last initial.
            </p>
          </>
        )}
      </div>
    </div>
  );
}