import Icon from "./Icon";

export default function NavBar(props) {
  const active = props.active;
  const onNavigate = props.onNavigate;
  const badges = props.badges || {};
  const halos = props.halos || {};

  const tabs = [
    { id: "home", label: "Home", icon: "home" },
    { id: "network", label: "Network", icon: "group" },
    { id: "playdates", label: "Playdates", icon: "calendar_month" },
    { id: "search", label: "Search", icon: "search" },
  ];

  const haloStyles = {
    teal: { background: "rgba(2, 195, 154, 0.22)", border: "1px solid rgba(2, 195, 154, 0.45)" },
    amber: { background: "rgba(245, 158, 11, 0.22)", border: "1px solid rgba(245, 158, 11, 0.55)" },
  };

  const handleClick = (tabId) => {
    if (typeof onNavigate === "function") {
      onNavigate(tabId);
    }
  };

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#162D50", borderTop: "1px solid #2A4A6B",
      display: "flex", justifyContent: "space-around",
      padding: "0.5rem 0 1rem", zIndex: 50,
    }}>
      {tabs.map((tab) => {
        const badgeCount = badges[tab.id] || 0;
        const haloColor = halos[tab.id];
        const halo = haloColor ? haloStyles[haloColor] : null;
        return (
          <button
            key={tab.id}
            onClick={() => handleClick(tab.id)}
            style={{
              background: "transparent",
              border: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              padding: "0.25rem 0.75rem",
            }}>
            <span style={{ position: "relative", fontSize: "1.4rem", lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {halo && (
                <span style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "38px",
                  height: "38px",
                  borderRadius: "50%",
                  background: halo.background,
                  border: halo.border,
                  zIndex: 0,
                }} />
              )}
              <span style={{ position: "relative", zIndex: 1 }}><Icon name={tab.icon} size={26} color={active === tab.id ? "#02C39A" : "#8AAEC8"} fill={active === tab.id} /></span>
              {badgeCount > 0 && (
                <span style={{
                  position: "absolute",
                  top: "-6px",
                  right: "-10px",
                  zIndex: 2,
                  background: "#E05A5A",
                  color: "#FFFFFF",
                  fontSize: "0.6rem",
                  fontWeight: "700",
                  fontFamily: "system-ui, sans-serif",
                  borderRadius: "10px",
                  minWidth: "16px",
                  height: "16px",
                  padding: "0 4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box",
                  border: "2px solid #162D50",
                }}>
                  {badgeCount}
                </span>
              )}
            </span>
            <span style={{
              fontSize: "0.65rem",
              color: active === tab.id ? "#02C39A" : "#607080",
              fontFamily: "system-ui, sans-serif",
              fontWeight: active === tab.id ? "600" : "400",
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}