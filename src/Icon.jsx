// Reusable icon component — Material Symbols (Rounded).
//
// Setup (one time):
//   1. npm install material-symbols
//   2. In your app entry (main.jsx or App.jsx), add once:
//        import "material-symbols/rounded.css";
//
// Usage:
//   <Icon name="home" />
//   <Icon name="calendar_month" size={20} color="#02C39A" />
//   <Icon name="school" style={{ marginRight: 6 }} />
//
// Find icon names at https://fonts.google.com/icons (use the rounded style).
export default function Icon({ name, size = 22, color = "currentColor", weight = 400, fill = false, style = {}, ...rest }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden="true"
      style={{
        fontSize: `${size}px`,
        color,
        lineHeight: 1,
        // Material Symbols variable-font axes: FILL (0/1), weight, optical size.
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        verticalAlign: "middle",
        userSelect: "none",
        ...style,
      }}
      {...rest}
    >
      {name}
    </span>
  );
}