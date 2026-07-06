import { useState } from "react";
import Icon from "./Icon";
import { blockParent, submitReport } from "./blocks";

// Drop-in "⋯" menu for blocking/reporting ANY person, anywhere they appear.
// Usage: <PersonMenu session={session} targetId={parentId} targetName={name} onDone={() => refresh()} />
export default function PersonMenu({ session, targetId, targetName, onDone, onRemoveConnection, size = 20, color = "#8AAEC8" }) {
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportCategory, setReportCategory] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportAlsoBlock, setReportAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const short = (n) => {
    if (!n) return "this person";
    const parts = n.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : parts[0];
  };

  if (!targetId || targetId === session?.user?.id) return null;

  const doBlock = async () => {
    setBusy(true);
    const res = await blockParent(session.user.id, targetId);
    setBusy(false);
    setConfirmBlock(false);
    setOpen(false);
    if (res.ok) {
      setToast(`${short(targetName)} blocked.`);
      setTimeout(() => { setToast(""); if (onDone) onDone(); }, 1500);
    } else {
      setToast("Couldn't block, try again.");
      setTimeout(() => setToast(""), 2500);
    }
  };

  const doReport = async () => {
    if (!reportCategory) return;
    setBusy(true);
    const res = await submitReport(session.user.id, targetId, reportCategory, reportDetails, reportAlsoBlock);
    setBusy(false);
    setReporting(false);
    setOpen(false);
    if (res.ok) {
      setToast(reportAlsoBlock ? `Reported and blocked. Thank you.` : `Report submitted. Thank you.`);
      setTimeout(() => { setToast(""); if (onDone) onDone(); }, 1800);
    } else {
      setToast("Couldn't submit, try again.");
      setTimeout(() => setToast(""), 2500);
    }
  };

  const openReport = () => {
    setReportCategory("");
    setReportDetails("");
    setReportAlsoBlock(true);
    setReporting(true);
    setOpen(false);
  };

  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label="More options"
        style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", minWidth: "32px", minHeight: "32px", justifyContent: "center" }}>
        <Icon name="more_horiz" size={size} color={color} />
      </button>

      {toast && (
        <div style={{ position: "fixed", bottom: "90px", left: "50%", transform: "translateX(-50%)", background: "#162D50", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.6rem 1rem", zIndex: 200, maxWidth: "90%" }}>
          <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{toast}</p>
        </div>
      )}

      {/* The ⋯ menu */}
      {open && (
        <div onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(6,16,36,0.6)", zIndex: 90, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "huddleFadeInUp 160ms ease both" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#162D50", borderTopLeftRadius: "18px", borderTopRightRadius: "18px", padding: "1rem", width: "100%", maxWidth: "500px", borderTop: "1px solid #2A4A6B", animation: "huddleSlideUp 240ms cubic-bezier(0.22,1,0.36,1) both" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.82rem", textAlign: "center", margin: "0.25rem 0 1rem" }}>{targetName || "This person"}</p>
            {onRemoveConnection && (
              <button onClick={() => { setOpen(false); onRemoveConnection(); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", background: "#0F2044", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.9rem 1rem", marginBottom: "0.6rem", cursor: "pointer" }}>
                <Icon name="link_off" size={20} color="#8AAEC8" />
                <span style={{ color: "#FFFFFF", fontSize: "0.92rem" }}>Remove connection</span>
              </button>
            )}
            <button onClick={openReport}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", background: "#0F2044", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.9rem 1rem", marginBottom: "0.6rem", cursor: "pointer" }}>
              <Icon name="flag" size={20} color="#E39A9A" />
              <span style={{ color: "#FFFFFF", fontSize: "0.92rem" }}>Report a concern</span>
            </button>
            <button onClick={() => { setConfirmBlock(true); setOpen(false); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", background: "#0F2044", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.9rem 1rem", marginBottom: "0.6rem", cursor: "pointer" }}>
              <Icon name="block" size={20} color="#E39A9A" />
              <span style={{ color: "#FFFFFF", fontSize: "0.92rem" }}>Block {short(targetName)}</span>
            </button>
            <button onClick={() => setOpen(false)}
              style={{ width: "100%", background: "transparent", border: "none", color: "#8AAEC8", fontSize: "0.9rem", padding: "0.7rem", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Block confirm */}
      {confirmBlock && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(6,16,36,0.85)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "16px", padding: "1.5rem", maxWidth: "380px", width: "100%", animation: "huddleScaleIn 200ms cubic-bezier(0.22,1,0.36,1) both" }}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "700", margin: "0 0 0.6rem" }}>Block {short(targetName)}?</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.88rem", lineHeight: "1.5", margin: "0 0 1.25rem" }}>
              You won't see each other or be able to invite each other on Huddle, and any connection will be removed. They won't be notified. (This won't change the fact that your children may share a classroom in real life.)
            </p>
            <button disabled={busy} onClick={doBlock}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#C0504D", color: "#FFFFFF", fontWeight: "700", cursor: "pointer", marginBottom: "0.6rem", fontSize: "0.9rem" }}>
              {busy ? "Blocking..." : "Block"}
            </button>
            <button onClick={() => setConfirmBlock(false)}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontWeight: "600", cursor: "pointer", fontSize: "0.9rem" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Report modal */}
      {reporting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(6,16,36,0.85)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "16px", padding: "1.5rem", maxWidth: "400px", width: "100%", maxHeight: "85vh", overflowY: "auto", animation: "huddleScaleIn 200ms cubic-bezier(0.22,1,0.36,1) both" }}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.15rem", fontWeight: "700", margin: "0 0 0.35rem" }}>Report {short(targetName)}</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.82rem", lineHeight: "1.5", margin: "0 0 1.1rem" }}>
              Reports are sent privately to the Huddle team for review. Your report is confidential.
            </p>
            <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.05em", margin: "0 0 0.5rem" }}>WHAT'S THE CONCERN?</p>
            {[
              { key: "harassment", label: "Harassment or bullying" },
              { key: "inappropriate", label: "Inappropriate behavior or messages" },
              { key: "spam_scam", label: "Spam or scam" },
              { key: "child_safety", label: "Concern about a child's safety" },
              { key: "other", label: "Something else" },
            ].map((opt) => (
              <div key={opt.key} onClick={() => setReportCategory(opt.key)}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.7rem 0.9rem", borderRadius: "10px", border: `1px solid ${reportCategory === opt.key ? "#02C39A" : "#2A4A6B"}`, background: reportCategory === opt.key ? "#12352C" : "transparent", marginBottom: "0.5rem", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `2px solid ${reportCategory === opt.key ? "#02C39A" : "#4A5D78"}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {reportCategory === opt.key && <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#02C39A" }} />}
                </div>
                <span style={{ color: "#FFFFFF", fontSize: "0.88rem" }}>{opt.label}</span>
              </div>
            ))}
            <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Add any details that would help us (optional)" rows={3}
              style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.85rem", marginTop: "0.5rem", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
            <div onClick={() => setReportAlsoBlock(!reportAlsoBlock)}
              style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.7rem 0", cursor: "pointer" }}>
              <div style={{ width: "20px", height: "20px", borderRadius: "6px", border: `2px solid ${reportAlsoBlock ? "#02C39A" : "#4A5D78"}`, background: reportAlsoBlock ? "#02C39A" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {reportAlsoBlock && <Icon name="check" size={14} color="#0F2044" />}
              </div>
              <span style={{ color: "#FFFFFF", fontSize: "0.88rem" }}>Also block {short(targetName)}</span>
            </div>
            <button disabled={!reportCategory || busy} onClick={doReport}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: (!reportCategory || busy) ? "#28405F" : "#C0504D", color: "#FFFFFF", fontWeight: "700", cursor: (!reportCategory || busy) ? "default" : "pointer", fontSize: "0.9rem", marginTop: "0.75rem", marginBottom: "0.6rem" }}>
              {busy ? "Submitting..." : "Submit report"}
            </button>
            <button onClick={() => setReporting(false)}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontWeight: "600", cursor: "pointer", fontSize: "0.9rem" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}