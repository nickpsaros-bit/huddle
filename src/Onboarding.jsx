import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import Icon from "./Icon";

// First-run animated tutorial. Fires ONCE after a new user completes their
// profile (App.jsx gates on hasProfile && !onboarding_seen). Five screens:
// welcome → playdate → birthday → find people → done. Skippable on every screen.
//
// Design intent (matches Huddle's existing identity, doesn't invent a new one):
// each teaching card shows a MINI MOCKUP of the real UI element it explains, and
// that mockup performs one orchestrated entrance (pieces settle in sequence).
// The "boldness" is spent there; everything else stays quiet — Huddle's own
// navy/teal palette, existing card styling, system type.

const NAVY = "#0F2044";
const NAVY_CARD = "#162D50";
const TEAL = "#02C39A";
const TEAL_DEEP = "#0F3D2E";
const BORDER = "#2A4A6B";
const MUTE = "#8AAEC8";
const FAINT = "#607080";
const PURPLE = "#C9A9FF";

// Keyframes injected once (self-contained; doesn't rely on FadeIn internals).
function ensureOnboardingKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("huddle-onboarding-kf")) return;
  const el = document.createElement("style");
  el.id = "huddle-onboarding-kf";
  el.textContent = `
    @keyframes obSettle {
      0%   { opacity: 0; transform: translateY(10px) scale(0.98); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes obFade {
      0%   { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes obPop {
      0%   { opacity: 0; transform: scale(0.6); }
      60%  { transform: scale(1.08); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes obSlideUp {
      0%   { opacity: 0; transform: translateY(14px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ob-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
    }
  `;
  document.head.appendChild(el);
}

export default function Onboarding({ session, name, onDone }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const total = 6; // keep in sync with the screens array below

  useEffect(() => { ensureOnboardingKeyframes(); }, []);

  const firstName = (name || "").trim().split(/\s+/)[0] || "there";

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    // Persist that they've seen it, so it never fires again (best-effort — if the
    // write fails we still let them into the app; worst case they see it once more).
    try {
      await supabase
        .from("parents")
        .update({ onboarding_seen: true })
        .eq("id", session.user.id);
    } catch (e) { /* best-effort */ }
    onDone();
  };

  const next = () => {
    if (step >= total - 1) { finish(); return; }
    setStep((s) => s + 1);
  };

  // ---- shared bits ----
  const Skip = () => (
    <button
      onClick={finish}
      style={{
        position: "absolute", top: "1.25rem", right: "1.25rem",
        background: "transparent", border: "none", color: FAINT,
        fontSize: "0.85rem", cursor: "pointer", padding: "0.4rem 0.5rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      Skip
    </button>
  );

  const Dots = () => (
    <div style={{ display: "flex", gap: "7px", justifyContent: "center", marginTop: "1.75rem" }}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          style={{
            width: i === step ? "22px" : "7px",
            height: "7px",
            borderRadius: "999px",
            background: i === step ? TEAL : "#2A4A6B",
            transition: "width 0.28s ease, background 0.28s ease",
          }}
        />
      ))}
    </div>
  );

  const primaryBtn = {
    width: "100%", padding: "0.95rem", borderRadius: "12px", border: "none",
    background: TEAL, color: NAVY, fontSize: "0.98rem", fontWeight: 700,
    cursor: "pointer", fontFamily: "system-ui, sans-serif",
  };

  // Mini playdate card mockup — assembles in sequence.
  const MiniPlaydate = () => (
    <div style={{
      background: NAVY_CARD, border: `1px solid ${BORDER}`, borderRadius: "14px",
      padding: "1.1rem 1.2rem", textAlign: "left",
      animation: "obSettle 0.5s cubic-bezier(0.22,1,0.36,1) both",
    }} className="ob-anim">
      <div className="ob-anim" style={{ animation: "obSlideUp 0.5s 0.12s cubic-bezier(0.22,1,0.36,1) both" }}>
        <p style={{ color: TEAL, fontSize: "0.9rem", fontWeight: 500, margin: "0 0 3px" }}>📅 Sat, 2:00 PM</p>
        <p style={{ color: MUTE, fontSize: "0.82rem", margin: 0 }}>📍 Local Park</p>
      </div>
      <div style={{ height: "1px", background: BORDER, margin: "0.85rem 0" }} className="ob-anim"
           />
      <p className="ob-anim" style={{ color: FAINT, fontSize: "0.7rem", letterSpacing: "0.05em", margin: "0 0 0.6rem", animation: "obFade 0.4s 0.3s both" }}>GUEST LIST</p>
      {[["A", "Alex R.", TEAL, "Going"], ["J", "Jordan M.", FAINT, "Invited"]].map((g, i) => (
        <div key={i} className="ob-anim"
             style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "7px", animation: `obSlideUp 0.45s ${0.4 + i * 0.12}s cubic-bezier(0.22,1,0.36,1) both` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", fontWeight: 600, color: "#FFF" }}>{g[0]}</div>
            <span style={{ color: "#FFF", fontSize: "0.84rem" }}>{g[1]}</span>
          </div>
          <span style={{ color: g[2], fontSize: "0.78rem", fontWeight: 500 }}>{g[3]}</span>
        </div>
      ))}
    </div>
  );

  // Mini birthday card mockup.
  const MiniBirthday = () => (
    <div style={{
      background: NAVY_CARD, border: `1px solid ${BORDER}`, borderRadius: "14px",
      padding: "1.1rem 1.2rem", textAlign: "left",
      animation: "obSettle 0.5s cubic-bezier(0.22,1,0.36,1) both",
    }} className="ob-anim">
      <div className="ob-anim" style={{ animation: "obPop 0.55s 0.1s cubic-bezier(0.22,1,0.36,1) both", display: "inline-block" }}>
        <p style={{ color: PURPLE, fontSize: "1rem", fontWeight: 600, margin: "0 0 6px" }}>🎂 Eleni's 6th Birthday</p>
      </div>
      <p className="ob-anim" style={{ color: TEAL, fontSize: "0.88rem", fontWeight: 500, margin: "0 0 3px", animation: "obSlideUp 0.5s 0.24s cubic-bezier(0.22,1,0.36,1) both" }}>📅 Sun, 11:00 AM</p>
      <p className="ob-anim" style={{ color: MUTE, fontSize: "0.82rem", margin: 0, animation: "obSlideUp 0.5s 0.34s cubic-bezier(0.22,1,0.36,1) both" }}>📍 Community Center</p>
      <div className="ob-anim" style={{ marginTop: "0.9rem", animation: "obFade 0.5s 0.5s both" }}>
        <span style={{ display: "inline-block", background: TEAL_DEEP, color: TEAL, fontSize: "0.72rem", fontWeight: 600, padding: "3px 10px", borderRadius: "999px" }}>
          Invite the whole class 🎉
        </span>
      </div>
    </div>
  );

  // Mini "find parents" row mockup.
  const MiniFind = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
      {[["M", "Maya T.", "Ms. Chen's class"], ["D", "Devin K.", "Room 2B · same school"]].map((p, i) => (
        <div key={i} className="ob-anim"
             style={{
               background: NAVY_CARD, border: `1px solid ${BORDER}`, borderRadius: "12px",
               padding: "0.8rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between",
               animation: `obSettle 0.5s ${0.12 + i * 0.14}s cubic-bezier(0.22,1,0.36,1) both`,
             }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", fontWeight: 600, color: "#FFF" }}>{p[0]}</div>
            <div style={{ textAlign: "left" }}>
              <p style={{ color: "#FFF", fontSize: "0.86rem", fontWeight: 500, margin: "0 0 1px" }}>{p[1]}</p>
              <p style={{ color: FAINT, fontSize: "0.74rem", margin: 0 }}>{p[2]}</p>
            </div>
          </div>
          <span className="ob-anim" style={{
            background: TEAL_DEEP, color: TEAL, border: `1px solid ${TEAL}`,
            fontSize: "0.76rem", fontWeight: 600, padding: "0.35rem 0.7rem", borderRadius: "9px",
            animation: `obPop 0.5s ${0.5 + i * 0.14}s cubic-bezier(0.22,1,0.36,1) both`,
          }}>
            Connect
          </span>
        </div>
      ))}
    </div>
  );

  // Mini "invite by email" mockup — an email row with a teal Invite action,
  // assembling in sequence like the other cards.
  const MiniInvite = () => (
    <div style={{
      background: NAVY_CARD, border: `1px solid ${BORDER}`, borderRadius: "14px",
      padding: "1.1rem 1.2rem", textAlign: "left",
      animation: "obSettle 0.5s cubic-bezier(0.22,1,0.36,1) both",
    }} className="ob-anim">
      <p className="ob-anim" style={{ color: FAINT, fontSize: "0.7rem", letterSpacing: "0.05em", margin: "0 0 0.7rem", animation: "obFade 0.4s 0.12s both" }}>INVITE A FAMILY</p>
      <div className="ob-anim" style={{
        display: "flex", alignItems: "center", gap: "10px",
        background: NAVY, border: `1px solid ${BORDER}`, borderRadius: "10px",
        padding: "0.7rem 0.9rem", marginBottom: "0.85rem",
        animation: "obSlideUp 0.5s 0.22s cubic-bezier(0.22,1,0.36,1) both",
      }}>
        <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "#28405F", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="mail" size={16} color={MUTE} />
        </div>
        <span style={{ color: MUTE, fontSize: "0.86rem" }}>parent@email.com</span>
      </div>
      <div className="ob-anim" style={{ textAlign: "center", animation: "obPop 0.5s 0.5s cubic-bezier(0.22,1,0.36,1) both" }}>
        <span style={{ display: "inline-block", background: TEAL, color: NAVY, fontSize: "0.82rem", fontWeight: 700, padding: "0.5rem 1.4rem", borderRadius: "9px" }}>
          Send invite →
        </span>
      </div>
    </div>
  );

  // ---- screen content ----
  const screens = [
    // 0 — Welcome
    {
      emoji: "👋",
      title: `Welcome, ${firstName}`,
      body: "Huddle helps you connect with other parents at your kids' school — and actually make playdates happen. Here's the 20-second tour.",
      visual: null,
      cta: "Show me around",
    },
    // 1 — Playdate
    {
      eyebrow: "PLAYDATES",
      title: "Set up a playdate",
      body: "On the Playdates tab, tap Set up a playdate, pick the families you want, and choose a time and place. They RSVP in a tap — no group-text chaos.",
      visual: <MiniPlaydate />,
      cta: "Next",
    },
    // 2 — Birthday
    {
      eyebrow: "BIRTHDAYS",
      title: "Throw a birthday",
      body: "The Birthdays tab lets you invite a whole classroom at once. Everyone gets the details and a calendar invite — you just pick the day.",
      visual: <MiniBirthday />,
      cta: "Next",
    },
    // 3 — Find people
    {
      eyebrow: "YOUR PEOPLE",
      title: "Find your people",
      body: "Home shows the parents in your kids' classrooms. Search finds anyone by name or exact email. Tap Connect and you're linked.",
      visual: <MiniFind />,
      cta: "Next",
    },
    // 4 — Grow your community (invite non-users)
    {
      eyebrow: "INVITE FAMILIES",
      title: "Grow your community",
      body: "Know a parent who isn't on Huddle yet? Invite them by email — you can even invite someone to a playdate before they've signed up.",
      visual: <MiniInvite />,
      cta: "Next",
    },
    // 5 — Done
    {
      emoji: "🎉",
      title: "You're all set",
      body: "That's it. Set up a playdate, throw a birthday, and find your people — all from the tabs at the bottom. Have fun.",
      visual: null,
      cta: "Start using Huddle",
    },
  ];

  const s = screens[step];
  const isBirthday = step === 2;
  const accent = isBirthday ? PURPLE : TEAL;

  return (
    <div style={{
      minHeight: "100vh", background: NAVY, fontFamily: "system-ui, sans-serif",
      display: "flex", flexDirection: "column", position: "relative",
    }}>
      <Skip />

      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "2rem 1.5rem", maxWidth: "440px", margin: "0 auto", width: "100%", boxSizing: "border-box",
      }}>
        {/* Brand mark */}
        <p className="ob-anim" key={`brand-${step}`} style={{
          color: TEAL, fontSize: "1.1rem", fontWeight: 700, textAlign: "center",
          margin: "0 0 2rem", letterSpacing: "-0.01em",
          animation: "obFade 0.5s both",
        }}>huddle</p>

        {/* Visual (mockup) or big emoji, keyed by step so it re-animates each screen */}
        <div key={`vis-${step}`} style={{ marginBottom: "1.75rem" }}>
          {s.visual ? s.visual : (
            <div className="ob-anim" style={{
              fontSize: "3.5rem", textAlign: "center",
              animation: "obPop 0.6s cubic-bezier(0.22,1,0.36,1) both",
            }}>{s.emoji}</div>
          )}
        </div>

        {/* Text block, keyed by step */}
        <div key={`txt-${step}`} className="ob-anim" style={{ textAlign: "center", animation: "obSlideUp 0.5s 0.15s cubic-bezier(0.22,1,0.36,1) both" }}>
          {s.eyebrow && (
            <p style={{ color: accent, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.12em", margin: "0 0 0.6rem" }}>{s.eyebrow}</p>
          )}
          <h1 style={{ color: "#FFF", fontSize: "1.55rem", fontWeight: 600, margin: "0 0 0.75rem", lineHeight: 1.2 }}>{s.title}</h1>
          <p style={{ color: MUTE, fontSize: "0.95rem", lineHeight: 1.6, margin: 0 }}>{s.body}</p>
        </div>

        <Dots />
      </div>

      {/* Bottom action */}
      <div style={{ padding: "1.25rem 1.5rem 2rem", maxWidth: "440px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <button onClick={next} disabled={saving} style={{ ...primaryBtn, background: saving ? "#028090" : TEAL }}>
          {saving ? "…" : s.cta}
        </button>
      </div>
    </div>
  );
}