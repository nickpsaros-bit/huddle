import Icon from "./Icon";

// Shared top bar for the main tab screens (Home, Network, Playdates, Birthdays).
// Carries: a title (or the Huddle logo on Home), an optional tutorial replay
// button (Home only), a global Search action, the notifications bell (with
// count), and the profile avatar.
//
// Props:
//   title           string — shown left. If isHome, renders the teal "Huddle" logo instead.
//   isHome          bool   — use the branded logo treatment + show the tutorial button.
//   notificationCount number
//   onBellClick     fn
//   onSearchClick   fn
//   onProfileClick  fn
//   onLogoClick     fn
//   onTutorialClick fn     — if provided AND isHome, shows a help icon that replays onboarding.
//   avatarUrl       string | null
//   initial         string — fallback avatar letter
export default function TopBar({
  title = "",
  isHome = false,
  notificationCount = 0,
  onBellClick,
  onSearchClick,
  onProfileClick,
  onLogoClick,
  onTutorialClick,
  avatarUrl,
  initial = "",
}) {
  return (
    <div style={{
      background: "#162D50",
      padding: "1rem 1.5rem",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottom: isHome ? "2px solid #02C39A" : "1px solid #2A4A6B",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", minWidth: 0 }}>
        <h1
          onClick={() => { if (typeof onLogoClick === "function") onLogoClick(); }}
          style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0, letterSpacing: "-0.02em", cursor: "pointer", flexShrink: 0 }}
        >
          Huddle
        </h1>
        {isHome && (
          <span style={{ color: "#8AAEC8", fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: "1.05rem", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Parents connecting, so their kids can too
          </span>
        )}
        {!isHome && title && (
          <span style={{ color: "#8AAEC8", fontSize: "1rem", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Tutorial replay (Home only) — a quiet help affordance so anyone who
            tapped through onboarding too fast can watch it again. */}
        {isHome && typeof onTutorialClick === "function" && (
          <button onClick={() => onTutorialClick()}
            aria-label="How Huddle works"
            title="How Huddle works"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", display: "inline-flex", alignItems: "center" }}>
            <Icon name="help_outline" size={22} color="#8AAEC8" />
          </button>
        )}

        {/* Global search */}
        <button onClick={() => { if (typeof onSearchClick === "function") onSearchClick(); }}
          aria-label="Search"
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px 6px", display: "inline-flex", alignItems: "center" }}>
          <Icon name="search" size={22} color="#8AAEC8" />
        </button>

        {/* Notifications bell + count */}
        <button onClick={() => { if (typeof onBellClick === "function") onBellClick(); }}
          aria-label="Notifications"
          style={{ background: "transparent", border: "none", cursor: "pointer", position: "relative", padding: "4px 6px", display: "inline-flex", alignItems: "center" }}>
          <Icon name="notifications" size={22} color="#8AAEC8" />
          {notificationCount > 0 && (
            <span style={{ position: "absolute", top: 0, right: 0, background: "#E05A5A", color: "#FFFFFF", fontSize: "0.6rem", fontWeight: "700", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {notificationCount}
            </span>
          )}
        </button>

        {/* Profile avatar */}
        {avatarUrl ? (
          <img src={avatarUrl} alt="Profile" onClick={() => { if (typeof onProfileClick === "function") onProfileClick(); }}
            style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "2px solid #02C39A" }} />
        ) : (
          <div onClick={() => { if (typeof onProfileClick === "function") onProfileClick(); }}
            style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", border: "2px solid #02C39A" }}>
            {initial}
          </div>
        )}
      </div>
    </div>
  );
}