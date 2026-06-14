export default function NavBar({ active, onNavigate }) {
  const tabs = [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "search", label: "Search", icon: "🔍" },
    { id: "playdates", label: "Playdates", icon: "📅" },
    { id: "messages", label: "Messages", icon: "💬" },
    { id: "profile", label: "Profile", icon: "👤" },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#162D50", borderTop: "1px solid #2A4A6B",
      display: "flex", justifyContent: "space-around",
      padding: "0.5rem 0 1rem", zIndex: 50,
    }}>
      {tabs.map((tab) => (
        <button key={tab.id} onClick={() => onNavigate(tab.id)}
          style={{
            background: "transparent", border: "none",
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: "4px", cursor: "pointer", padding: "0.25rem 0.75rem",
          }}>
          <span style={{ fontSize: "1.4rem" }}>{tab.icon}</span>
          <span style={{
            fontSize: "0.65rem",
            color: active === tab.id ? "#02C39A" : "#607080",
            fontFamily: "system-ui, sans-serif",
            fontWeight: active === tab.id ? "600" : "400",
          }}>
            {tab.label}
          </span>
        </button>
      ))}
    </div>
  );
}