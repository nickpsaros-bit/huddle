import { useEffect } from "react";

/**
 * Reusable in-app confirmation modal. Replaces window.confirm(), which is
 * unreliable on mobile (iOS Safari silently suppresses native popups).
 *
 * Usage (per screen):
 *   const [confirm, setConfirm] = useState(null);
 *   ...
 *   <button onClick={() => setConfirm({
 *     title: "Cancel this playdate?",
 *     body: "Invited families will be notified and it'll be removed from their calendars.",
 *     confirmLabel: "Cancel playdate",
 *     tone: "danger",
 *     onConfirm: () => doTheThing(),
 *   })}>...</button>
 *   ...
 *   <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
 *
 * `confirm` is null when hidden, or an object:
 *   { title, body?, confirmLabel?, cancelLabel?, tone?, onConfirm }
 *   tone: "danger" (default) | "primary"
 */
export default function ConfirmModal({ confirm, onClose }) {
  // Close on Escape (desktop niceness; harmless on mobile).
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, onClose]);

  if (!confirm) return null;

  const {
    title,
    body,
    confirmLabel = "Confirm",
    cancelLabel = "Keep it",
    tone = "danger",
    onConfirm,
  } = confirm;

  const confirmBg = tone === "danger" ? "#3D1515" : "#0F3D2E";
  const confirmBorder = tone === "danger" ? "#F87171" : "#02C39A";
  const confirmColor = tone === "danger" ? "#F87171" : "#02C39A";

  const handleConfirm = () => {
    // Run the action, then close. The action itself handles its own async.
    if (typeof onConfirm === "function") onConfirm();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 16, 33, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        zIndex: 1000,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#162D50",
          borderRadius: "16px",
          border: "1px solid #2A4A6B",
          padding: "1.5rem",
          maxWidth: "380px",
          width: "100%",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}
      >
        <h2 style={{ color: "#FFFFFF", fontSize: "1.15rem", fontWeight: "600", margin: "0 0 0.5rem" }}>
          {title}
        </h2>
        {body && (
          <p style={{ color: "#8AAEC8", fontSize: "0.9rem", lineHeight: "1.5", margin: "0 0 1.5rem" }}>
            {body}
          </p>
        )}
        {!body && <div style={{ height: "1rem" }} />}

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "0.8rem",
              borderRadius: "10px",
              border: "1px solid #2A4A6B",
              background: "transparent",
              color: "#8AAEC8",
              fontSize: "0.9rem",
              fontWeight: "500",
              cursor: "pointer",
              minHeight: "48px",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: "0.8rem",
              borderRadius: "10px",
              border: `1px solid ${confirmBorder}`,
              background: confirmBg,
              color: confirmColor,
              fontSize: "0.9rem",
              fontWeight: "600",
              cursor: "pointer",
              minHeight: "48px",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}