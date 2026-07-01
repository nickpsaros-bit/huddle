// Shared Huddle button. One source of truth for button styling across the app.
// Variants: primary (teal), secondary (outline), danger (red), ghost (bare).
// Pill-shaped, compact (sizes to content) by default; pass fullWidth to span.
//
// Usage:
//   <Button onClick={...}>Save</Button>                       // primary
//   <Button variant="secondary" onClick={...}>Cancel</Button>
//   <Button variant="danger" onClick={...}>Remove</Button>
//   <Button variant="ghost" size="sm" onClick={...}>Skip</Button>
//   <Button fullWidth onClick={...}>Send invite</Button>

export default function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  fullWidth = false,
  disabled = false,
  type = "button",
  style = {},
  ...rest
}) {
  const sizes = {
    sm: { padding: "0.4rem 0.9rem", fontSize: "0.8rem", minHeight: "34px" },
    md: { padding: "0.55rem 1.25rem", fontSize: "0.9rem", minHeight: "40px" },
    lg: { padding: "0.7rem 1.5rem", fontSize: "0.95rem", minHeight: "46px" },
  };

  const variants = {
    primary: { background: "#02C39A", color: "#0F2044", border: "none" },
    secondary: { background: "transparent", color: "#8AAEC8", border: "1px solid #2A4A6B" },
    danger: { background: "#F87171", color: "#0F2044", border: "none" },
    ghost: { background: "transparent", color: "#8AAEC8", border: "none" },
    // Purple accent (birthday actions), same pill system.
    accent: { background: "#2A1E3D", color: "#C9A9FF", border: "1px solid #7C5CBF" },
  };

  const base = {
    borderRadius: "999px",
    fontWeight: "600",
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    width: fullWidth ? "100%" : "auto",
    transition: "filter 0.15s ease, opacity 0.15s ease",
    whiteSpace: "nowrap",
    ...sizes[size],
    ...variants[variant],
    ...style,
  };

  return (
    <button type={type} onClick={onClick} disabled={disabled} style={base} {...rest}>
      {children}
    </button>
  );
}