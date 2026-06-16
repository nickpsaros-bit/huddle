import { useState } from "react";
import { supabase } from "./supabase";

// "Invite a family" modal. Generates a sender-locked, single-use, 48h token
// (max 3/day). Dead-simple sharing: Send (mobile native share) + Copy link.
export default function InviteFamily({ session, inviterName, playdateId = null, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const firstName = (inviterName || "").trim().split(/\s+/)[0] || "A parent";

  const isMobile = typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const canNativeShare = isMobile && typeof navigator !== "undefined" && !!navigator.share;

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

     if ((todays || []).length >= 10) {
        setError("You've sent 10 invites today — that's the daily limit. Try again tomorrow.");
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

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on Huddle", text: shareMsg, url: link });
        onClose();
      } catch (e) {
        // cancelled — keep modal open
      }
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setError("Couldn't copy — please copy the link manually.");
    }
  };

  const overlay = {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.7)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem"
  };
  const modalBox = {
    background: "#162D50", borderRadius: "16px", padding: "2rem",
    width: "100%", maxWidth: "380px"
  };
  const primaryBtn = {
    width: "100%", padding: "0.95rem", borderRadius: "10px", border: "none",
    background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer"
  };
  const secondaryBtn = {
    width: "100%", padding: "0.85rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "transparent",
    color: "#8AAEC8", fontSize: "0.95rem", fontWeight: "500", cursor: "pointer", marginTop: "0.75rem"
  };

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.2rem", margin: "0 0 0.5rem" }}>Invite a family</h2>
        <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 1.5rem", lineHeight: "1.5" }}>
          Invite a family who isn't on Huddle yet. When they join, you'll be connected so you can set up playdates.
        </p>

        {!link ? (
          <>
            {error && (
              <div style={{ background: "#3D1515", border: "1px solid #F87171", borderRadius: "8px", padding: "0.6rem 0.85rem", marginBottom: "1rem" }}>
                <p style={{ color: "#F87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>
              </div>
            )}
            <button onClick={generate} disabled={loading} style={primaryBtn}>
              {loading ? "Creating invite..." : "Create invite →"}
            </button>
            <button onClick={onClose} style={secondaryBtn}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.7rem 0.9rem", marginBottom: "1.25rem", textAlign: "center" }}>
              <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0, fontWeight: "500" }}>✓ Invite ready — valid for 48 hours</p>
            </div>

            {error && (
              <div style={{ background: "#3D1515", border: "1px solid #F87171", borderRadius: "8px", padding: "0.6rem 0.85rem", marginBottom: "1rem" }}>
                <p style={{ color: "#F87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>
              </div>
            )}

            {canNativeShare ? (
              <>
                <button onClick={share} style={primaryBtn}>📤 Send invite</button>
                <button onClick={copyLink} style={secondaryBtn}>
                  {copied ? "✓ Link copied" : "🔗 Copy invite link"}
                </button>
              </>
            ) : (
              <button onClick={copyLink} style={primaryBtn}>
                {copied ? "✓ Link copied — paste it anywhere" : "🔗 Copy invite link"}
              </button>
            )}

            <button onClick={onClose} style={{ ...secondaryBtn, border: "none", color: "#607080", fontSize: "0.85rem" }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}