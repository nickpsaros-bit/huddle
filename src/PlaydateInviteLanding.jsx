import { useState, useEffect } from "react";
import { supabase } from "./supabase";

// Public landing page for a NON-USER playdate invite (Option A: no account
// required to respond). Renders fully logged-out. Reads invite details via the
// get-invite-by-token edge function (never touches pending_invites directly),
// and Accept/Decline call respond-to-invite (Step 6). "Join Huddle" is offered,
// not forced.
export default function PlaydateInviteLanding({ token }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null); // full response from get-invite-by-token
  const [responding, setResponding] = useState(false);
  const [responded, setResponded] = useState(null); // "yes" | "no" after they reply
  const [error, setError] = useState("");

  const isOptout = new URLSearchParams(window.location.search).get("optout") === "1";

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("get-invite-by-token", {
        body: { token },
      });
      if (fnErr) throw fnErr;
      setState(data);
      // If they arrived via the opt-out link, immediately record the opt-out.
      if (isOptout && data?.status === "pending") {
        await respond("optout");
      }
    } catch (e) {
      setError("We couldn't load this invite. Please try again.");
    }
    setLoading(false);
  };

  const respond = async (choice) => {
    // choice: "yes" | "no" | "optout"
    setResponding(true);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("respond-to-invite", {
        body: { token, choice },
      });
      if (fnErr) throw fnErr;
      setResponded(choice);
    } catch (e) {
      setError("Something went wrong recording your reply. Please try again.");
    }
    setResponding(false);
  };

  // Send the invitee into the normal signup flow, preserving nothing from the
  // connection-invite system (this is a separate path).
  const joinHuddle = () => {
    window.location.href = "/";
  };

  const wrap = {
    minHeight: "100vh", background: "#0F2044", display: "flex",
    alignItems: "center", justifyContent: "center",
    fontFamily: "system-ui, sans-serif", padding: "1.5rem",
  };
  const card = { width: "100%", maxWidth: "440px", textAlign: "center" };
  const brand = { color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 2rem" };

  if (loading) {
    return (
      <div style={wrap}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Huddle</p>
      </div>
    );
  }

  const status = state?.status;

  // ---- Terminal / non-actionable states ----
  if (status === "not_found" || status === "cancelled" || status === "expired") {
    const copy = status === "expired"
      ? { emoji: "⏳", head: "This invite has expired", sub: "Ask the family who invited you to send a fresh one." }
      : status === "cancelled"
      ? { emoji: "🗓️", head: "This event is no longer available", sub: "The family may have cancelled or changed their plans." }
      : { emoji: "🤔", head: "We couldn't find this invite", sub: "Double-check the link from your email, or ask for a new one." };
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={brand}>Huddle</h1>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>{copy.emoji}</div>
          <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>{copy.head}</h2>
          <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 2rem", lineHeight: "1.5" }}>{copy.sub}</p>
          <button onClick={joinHuddle}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
            Explore Huddle →
          </button>
        </div>
      </div>
    );
  }

  if (status === "opted_out" || responded === "optout") {
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={brand}>Huddle</h1>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>✅</div>
          <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>You've been unsubscribed</h2>
          <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: 0, lineHeight: "1.5" }}>
            You won't receive any more playdate invites from Huddle at this email.
          </p>
        </div>
      </div>
    );
  }

  const ev = state?.event || {};
  const isBirthday = ev.kind === "birthday";
  const accent = isBirthday ? "#C9A9FF" : "#02C39A";

  // ---- Post-response confirmation ----
  if (responded === "yes" || responded === "no") {
    const yes = responded === "yes";
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={brand}>Huddle</h1>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>{yes ? "🎉" : "👍"}</div>
          <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>
            {yes ? "You're going!" : "Thanks for letting them know"}
          </h2>
          <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.75rem", lineHeight: "1.5" }}>
            {yes
              ? `We've let ${ev.host_label || "the host"} know you're coming. A calendar invite was in your email — check your inbox to save the date.`
              : `We've let ${ev.host_label || "the host"} know you can't make it. No hard feelings!`}
          </p>
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.25rem" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.95rem", margin: "0 0 0.5rem", fontWeight: "500" }}>Want to make planning easier?</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 1rem", lineHeight: "1.5" }}>
              Join Huddle to see who else is coming, reply to future invites in a tap, and connect with other families at your school.
            </p>
            <button onClick={joinHuddle}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: accent, color: "#0F2044", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer" }}>
              Join Huddle →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Main actionable invite view (status: pending or accepted) ----
  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={brand}>Huddle</h1>

        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>{isBirthday ? "🎂" : "🧸"}</div>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.4rem", fontWeight: "500", margin: "0 0 0.25rem" }}>
          {state?.invitee_name ? `${state.invitee_name}, you're invited!` : "You're invited!"}
        </h2>
        <p style={{ color: "#8AAEC8", fontSize: "0.95rem", margin: "0 0 1.5rem" }}>
          {ev.host_label || "A Huddle family"} invited you to {isBirthday ? "a birthday celebration" : "a playdate"}.
        </p>

        <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "1.25rem", textAlign: "left", marginBottom: "1.5rem" }}>
          {isBirthday && ev.title && (
            <p style={{ color: accent, fontSize: "1rem", fontWeight: "600", margin: "0 0 0.75rem" }}>🎂 {ev.title}</p>
          )}
          <p style={{ color: "#FFFFFF", fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
            <span style={{ color: "#8AAEC8" }}>When:</span> {ev.when}
          </p>
          <p style={{ color: "#FFFFFF", fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
            <span style={{ color: "#8AAEC8" }}>Where:</span> {ev.location}
          </p>
          {ev.note && (
            <p style={{ color: "#607080", fontSize: "0.9rem", margin: "0.75rem 0 0", fontStyle: "italic" }}>"{ev.note}"</p>
          )}
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", margin: "0 0 1rem" }}>{error}</p>}

        <div style={{ display: "flex", gap: "10px", marginBottom: "1.25rem" }}>
          <button onClick={() => respond("yes")} disabled={responding}
            style={{ flex: 1, padding: "0.95rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer" }}>
            {responding ? "..." : "I'll be there 🎉"}
          </button>
          <button onClick={() => respond("no")} disabled={responding}
            style={{ flex: 1, padding: "0.95rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer" }}>
            Can't make it
          </button>
        </div>

        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0, lineHeight: "1.5" }}>
          No account needed to reply. A calendar invite is in your email.
        </p>
      </div>
    </div>
  );
}