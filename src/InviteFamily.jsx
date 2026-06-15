import { useState } from "react";
import { supabase } from "./supabase";

// Reusable "Invite a family" modal. Generates a sender-locked, single-use,
// 48h invite token (max 3/day), then offers copy + share.
// Pass an optional playdateId to attach a pending playdate (Layer 3).
export default function InviteFamily({ session, inviterName, playdateId = null, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const firstName = (inviterName || "").trim().split(/\s+/)[0] || "A parent";
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const makeToken = () => {
    if (window.crypto && window.crypto.randomUUID) {
      return (window.crypto.randomUUID() + window.crypto.randomUUID()).replace(/-/g, "");
    }
    return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");
  };

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data: todays, error: countErr } = await supabase
        .from("invites")
        .select("id")
        .eq("inviter_id", session.user.id)
        .gte("created_at", startOfDay.toISOString());
      if (countErr) throw countErr;

      if ((todays || []).length >= 3) {
        setError("You've sent 3 invites today — that's the daily limit. Try again tomorrow.");
        setLoading(false);
        return;
      }

      const token = makeToken();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      const { error: insErr } = await supabase.from("invites").insert({
        token,
        inviter_id: session.user.id,
        playdate_id: playdateId,
        status: "pending",
        expires_at: expiresAt,
      });
      if (insErr) throw insErr;

      const url = `https://huddlefamilies.com/invite/${token}`;
      const msg = `${firstName} invited you to join Huddle — the easiest way to set up playdates for our kids. Join me here: ${url}`;
      setLink(url);
      setShareMsg(msg);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareMsg);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      setError("Couldn't copy automatically — select the message above and copy it manually.");
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on Huddle", text: shareMsg, url: link });
        onClose();
      } catch (e) {
        // User cancelled — keep modal open.
      }
    }
  };

  const overlay = {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.7)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem"
  };
  const modalBox = {
    background: "#162D50", borderRadius: "16px", padding: "2rem",
    width: "100%", maxWidth: "400px", maxHeight: "90vh", overflowY: "auto"
  };

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.2rem", margin: "0 0 0.5rem" }}>Invite a family</h2>
        <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 1.5rem", lineHeight: "1.5" }}>
          Invite a family who isn't on Huddle yet. When they join, you'll be connected so you can set up playdates — even if your kids are in different classes or schools.
        </p>

        {!link ? (
          <>
            {error && (
              <div style={{ background: "#3D1515", border: "1px solid #F87171", borderRadius: "8px", padding: "0.6rem 0.85rem", marginBottom: "1rem" }}>
                <p style={{ color: "#F87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>
              </div>
            )}
            <button onClick={generate} disabled={loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              {loading ? "Creating invite..." : "Create invite link →"}
            </button>
            <button onClick={onClose}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer", marginTop: "0.75rem" }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.6rem 0.85rem", marginBottom: "1rem" }}>
              <p style={{ color: "#02C39A", fontSize: "0.8rem", margin: 0, fontWeight: "500" }}>✓ Invite ready — valid for 48 hours</p>
            </div>

            {/* Message preview — selectable */}
            <p style={{ color: "#8AAEC8", fontSize: "0.72rem", letterSpacing: "0.05em", margin: "0 0 0.4rem" }}>YOUR INVITE MESSAGE</p>
            <div style={{ background: "#0F2044", border: "1px solid #2A4A6B", borderRadius: "10px", padding: "0.85rem 1rem", marginBottom: "1rem", userSelect: "all", WebkitUserSelect: "all", cursor: "text" }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: 0, lineHeight: "1.5", wordBreak: "break-word" }}>{shareMsg}</p>
            </div>

            {/* Primary: Copy (reliable everywhere) */}
            <button onClick={copy}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: copied ? "#0F3D2E" : "#02C39A", color: copied ? "#02C39A" : "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer", border: copied ? "1px solid #02C39A" : "none" }}>
              {copied ? "✓ Copied! Now paste it into a text or email" : "📋 Copy invite message"}
            </button>

            {/* Secondary: native share (mobile) */}
            {canNativeShare && (
              <button onClick={share}
                style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #02C39A", background: "transparent", color: "#02C39A", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer", marginTop: "0.75rem" }}>
                📤 Or share directly
              </button>
            )}

            <p style={{ color: "#607080", fontSize: "0.75rem", margin: "0.85rem 0 0", textAlign: "center", lineHeight: "1.5" }}>
              {canNativeShare
                ? "Copy and paste into any app, or tap share to pick one."
                : "Copy the message, then paste it into a text or email to the family you're inviting."}
            </p>

            <button onClick={onClose}
              style={{ width: "100%", padding: "0.6rem", borderRadius: "10px", border: "none", background: "transparent", color: "#607080", fontSize: "0.85rem", cursor: "pointer", marginTop: "0.75rem" }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}