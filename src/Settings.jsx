import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./supabase";
import Button from "./Button";
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from "./legal";
import Icon from "./Icon";
import { getMyBlockedList, unblockParent } from "./blocks";

export default function Settings({ session, onBack }) {
  const [parent, setParent] = useState(null);
  const [consents, setConsents] = useState([]);
  const [view, setView] = useState("main"); // "main" | "terms" | "privacy" | "adminBugs" | "blocked"
  const [blockedList, setBlockedList] = useState([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [message, setMessage] = useState("");

  // ---- Discoverability (school-wide visibility toggle) ----
  const [discoverable, setDiscoverable] = useState(true);
  const [discoverBusy, setDiscoverBusy] = useState(false);

  // Notification preferences.
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyCreationCal, setNotifyCreationCal] = useState(true);
  const [notifBusy, setNotifBusy] = useState(false);

  // ---- Passkeys / Face ID ----
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState("");

  // ---- Report a problem ----
  const [bugOpen, setBugOpen] = useState(false);
  const [bugText, setBugText] = useState("");
  const [bugScreen, setBugScreen] = useState("");
  const [bugBusy, setBugBusy] = useState(false);

  // ---- Admin: bug reports list ----
  const [adminBugs, setAdminBugs] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminBusyId, setAdminBusyId] = useState(null);

  useEffect(() => {
    fetchParent();
    fetchConsents();
    loadPasskeys();
  }, []);

  const fetchParent = async () => {
    const { data } = await supabase
      .from("parents")
      .select("id, name, is_admin, created_at, discoverable, notify_in_app, notify_email, notify_creation_calendar")
      .eq("id", session.user.id)
      .single();
    setParent(data);
    if (data && typeof data.discoverable === "boolean") setDiscoverable(data.discoverable);
    if (data && typeof data.notify_in_app === "boolean") setNotifyInApp(data.notify_in_app);
    if (data && typeof data.notify_email === "boolean") setNotifyEmail(data.notify_email);
    if (data && typeof data.notify_creation_calendar === "boolean") setNotifyCreationCal(data.notify_creation_calendar);
  };

  const toggleDiscoverable = async () => {
    const next = !discoverable;
    setDiscoverable(next); // optimistic
    setDiscoverBusy(true);
    try {
      const { error } = await supabase
        .from("parents")
        .update({ discoverable: next })
        .eq("id", session.user.id);
      if (error) throw error;
    } catch (e) {
      setDiscoverable(!next); // revert on failure
      setMessage("Couldn't update that setting. Try again.");
      setTimeout(() => setMessage(""), 3000);
    }
    setDiscoverBusy(false);
  };

  const updateNotifyPref = async (field, next, setter, prev) => {
    setter(next); // optimistic
    setNotifBusy(true);
    try {
      const { error } = await supabase
        .from("parents")
        .update({ [field]: next })
        .eq("id", session.user.id);
      if (error) throw error;
    } catch (e) {
      setter(prev); // revert
      setMessage("Couldn't update that setting. Try again.");
      setTimeout(() => setMessage(""), 3000);
    }
    setNotifBusy(false);
  };

  const fetchConsents = async () => {
    const { data } = await supabase
      .from("parent_consents")
      .select("*")
      .eq("parent_id", session.user.id)
      .order("consented_at", { ascending: false });
    setConsents(data || []);
  };

  // ---- Passkeys ----
  const loadPasskeys = async () => {
    try {
      const { data, error } = await supabase.auth.passkey.list();
      if (!error && Array.isArray(data)) setPasskeys(data);
    } catch (e) {
      // not enabled / unsupported — leave empty
    }
  };

  const addPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyMsg("");
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) {
        const code = error.code || "";
        if (code === "webauthn_credential_exists") {
          setPasskeyMsg("This device already has Face ID sign-in set up. 👍");
        } else if (error.name === "NotAllowedError" || /cancel/i.test(error.message || "")) {
          setPasskeyMsg("");
        } else {
          setPasskeyMsg(error.message || "Couldn't set up Face ID on this device.");
        }
      } else {
        setPasskeyMsg("Face ID sign-in is on for this device. ✅");
        loadPasskeys();
      }
    } catch (e) {
      setPasskeyMsg("This device or browser doesn't support Face ID sign-in.");
    }
    setPasskeyBusy(false);
  };

  const removePasskey = async (passkeyId) => {
    setPasskeyBusy(true);
    setPasskeyMsg("");
    try {
      await supabase.auth.passkey.delete({ passkeyId });
      setPasskeyMsg("Removed.");
      loadPasskeys();
    } catch (e) {
      setPasskeyMsg("Couldn't remove that passkey. Try again.");
    }
    setPasskeyBusy(false);
  };

  // ---- Report a problem ----
  const submitBug = async () => {
    if (!bugText.trim()) return;
    setBugBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.from("bug_reports").insert({
        reporter_parent_id: session.user.id,
        description: bugText.trim(),
        screen: bugScreen.trim() || null,
        user_agent: (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : null,
        status: "new",
      });
      if (error) throw error;
      setBugText("");
      setBugScreen("");
      setBugOpen(false);
      setMessage("Thanks — your report was sent. 🙏");
      setTimeout(() => setMessage(""), 4000);
    } catch (err) {
      setMessage("Couldn't send report: " + err.message);
    }
    setBugBusy(false);
  };

  // ---- Admin bug list ----
  const loadAdminBugs = async () => {
    setAdminLoading(true);
    try {
      const { data } = await supabase
        .from("bug_reports")
        .select("id, description, screen, status, created_at, reporter_parent_id, parents:reporter_parent_id(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      setAdminBugs(data || []);
    } catch (e) {
      setAdminBugs([]);
    }
    setAdminLoading(false);
  };

  const setBugStatus = async (id, status) => {
    setAdminBusyId(id);
    try {
      await supabase.from("bug_reports").update({ status }).eq("id", id);
      setAdminBugs((list) => list.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (e) {
      // best-effort
    }
    setAdminBusyId(null);
  };

  const openAdminBugs = async () => {
    setView("adminBugs");
    await loadAdminBugs();
  };

  // ---- Admin: safety reports ----
  const [adminReports, setAdminReports] = useState([]);
  const loadAdminReports = async () => {
    setAdminLoading(true);
    try {
      const { data } = await supabase
        .from("safety_reports")
        .select("id, category, details, also_blocked, status, created_at, reporter:reporter_parent_id(name), reported:reported_parent_id(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      setAdminReports(data || []);
    } catch (e) {
      setAdminReports([]);
    }
    setAdminLoading(false);
  };

  const setReportStatus = async (id, status) => {
    setAdminBusyId(id);
    try {
      await supabase.from("safety_reports").update({ status }).eq("id", id);
      setAdminReports((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e) { /* best-effort */ }
    setAdminBusyId(null);
  };

  const openAdminReports = async () => {
    setView("adminReports");
    await loadAdminReports();
  };

  const REPORT_CAT_LABELS = {
    harassment: "Harassment or bullying",
    inappropriate: "Inappropriate behavior",
    spam_scam: "Spam or scam",
    child_safety: "Child safety concern",
    other: "Other",
  };

  const openBlocked = async () => {
    setView("blocked");
    setBlockedLoading(true);
    const list = await getMyBlockedList(session.user.id);
    setBlockedList(list);
    setBlockedLoading(false);
  };

  const doUnblock = async (parentId, name) => {
    const res = await unblockParent(session.user.id, parentId);
    if (res.ok) {
      setBlockedList((prev) => prev.filter((b) => b.parentId !== parentId));
      setMessage(`${name} has been unblocked.`);
      setTimeout(() => setMessage(""), 3000);
    } else {
      setMessage("Couldn't unblock, please try again.");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const tosConsent = consents.find((c) => c.document_type === "terms_of_service");
  const privacyConsent = consents.find((c) => c.document_type === "privacy_policy");

  const headerBar = (title, backTo) => (
    <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B", position: "sticky", top: 0, zIndex: 10 }}>
      <button onClick={backTo} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}><Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back</button>
      <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>{title}</h1>
      <div style={{ width: "60px" }} />
    </div>
  );

  // ---- Legal doc viewer (light "paper" document styling) ----
  if (view === "terms" || view === "privacy") {
    const doc = view === "terms" ? TERMS_OF_SERVICE : PRIVACY_POLICY;
    const title = view === "terms" ? "Terms of Service" : "Privacy Policy";

    // Pull the effective date + version lines out of the markdown so we can show
    // them in a styled document header, and render the rest as the body.
    const effMatch = doc.match(/\*\*Effective date:\*\*\s*(.+)/);
    const verMatch = doc.match(/\*\*Version:\*\*\s*(.+)/);
    const effective = effMatch ? effMatch[1].trim() : "";
    const version = verMatch ? verMatch[1].trim() : "";
    // Body = everything after the first horizontal rule, so the title/date/version
    // (which we render in the styled header) aren't duplicated.
    const body = doc.includes("\n---\n") ? doc.split("\n---\n").slice(1).join("\n---\n") : doc;

    // Markdown → styled "document" elements (serif, generous spacing, dark on white).
    const mdComponents = {
      h1: (props) => <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.5rem", fontWeight: 700, color: "#1A1A2E", margin: "1.75rem 0 0.75rem", lineHeight: 1.3 }} {...props} />,
      h2: (props) => <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.15rem", fontWeight: 700, color: "#1A1A2E", margin: "1.75rem 0 0.6rem", lineHeight: 1.35 }} {...props} />,
      h3: (props) => <h3 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1rem", fontWeight: 700, color: "#1A1A2E", margin: "1.25rem 0 0.5rem" }} {...props} />,
      p: (props) => <p style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "#33333D", margin: "0 0 1rem" }} {...props} />,
      ul: (props) => <ul style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "#33333D", margin: "0 0 1rem", paddingLeft: "1.25rem" }} {...props} />,
      ol: (props) => <ol style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "#33333D", margin: "0 0 1rem", paddingLeft: "1.25rem" }} {...props} />,
      li: (props) => <li style={{ margin: "0 0 0.4rem" }} {...props} />,
      strong: (props) => <strong style={{ color: "#1A1A2E", fontWeight: 700 }} {...props} />,
      em: (props) => <em style={{ color: "#6B6B7B" }} {...props} />,
      a: (props) => <a style={{ color: "#0F6FFF", textDecoration: "none" }} {...props} />,
      hr: () => <hr style={{ border: "none", borderTop: "1px solid #E2E2EA", margin: "1.75rem 0" }} />,
      blockquote: (props) => <blockquote style={{ background: "#F2F6FF", border: "1px solid #D6E4FF", borderRadius: "10px", padding: "0.85rem 1rem", margin: "0 0 1.25rem", fontSize: "0.9rem", color: "#2A3A5C" }} {...props} />,
    };

    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
        {headerBar(title, () => setView("main"))}
        <div style={{ padding: "1.25rem", maxWidth: "720px", margin: "0 auto" }}>
          {/* The "paper" */}
          <div style={{ background: "#FFFFFF", borderRadius: "14px", boxShadow: "0 8px 30px rgba(0,0,0,0.25)", overflow: "hidden" }}>
            {/* Document header */}
            <div style={{ padding: "2rem 1.75rem 1.25rem", borderBottom: "1px solid #E2E2EA" }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.75rem", fontWeight: 700, color: "#1A1A2E", margin: "0 0 0.75rem", lineHeight: 1.2 }}>{title}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {effective && (
                  <span style={{ fontSize: "0.72rem", color: "#6B6B7B", background: "#F4F4F7", border: "1px solid #E2E2EA", borderRadius: "999px", padding: "0.25rem 0.7rem" }}>
                    Effective {effective}
                  </span>
                )}
                {version && (
                  <span style={{ fontSize: "0.72rem", color: "#6B6B7B", background: "#F4F4F7", border: "1px solid #E2E2EA", borderRadius: "999px", padding: "0.25rem 0.7rem" }}>
                    Version {version}
                  </span>
                )}
              </div>
            </div>
            {/* Document body */}
            <div style={{ padding: "1.5rem 1.75rem 2rem" }}>
              <ReactMarkdown components={mdComponents}>{body}</ReactMarkdown>
            </div>
          </div>
          <p style={{ textAlign: "center", color: "#607080", fontSize: "0.72rem", margin: "1rem 0 0" }}>
            Huddle · huddlefamilies.com
          </p>
        </div>
      </div>
    );
  }

  // ---- Admin: bug reports ----
  if (view === "adminBugs") {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        {headerBar("Bug Reports", () => setView("main"))}
        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          {adminLoading ? (
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Loading...</p>
          ) : adminBugs.length === 0 ? (
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>No bug reports yet. 🎉</p>
          ) : (
            adminBugs.map((b) => {
              const statusColor = b.status === "resolved" ? "#02C39A" : b.status === "reviewing" ? "#F59E0B" : "#8AAEC8";
              return (
                <div key={b.id} style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", padding: "1rem 1.25rem", marginBottom: "0.85rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <span style={{ color: statusColor, fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.05em", textTransform: "uppercase" }}>{b.status}</span>
                    <span style={{ color: "#607080", fontSize: "0.72rem" }}>{b.created_at ? new Date(b.created_at).toLocaleString() : ""}</span>
                  </div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 0.5rem", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>{b.description}</p>
                  <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.75rem" }}>
                    {b.parents?.name ? `From ${b.parents.name}` : "From a user"}{b.screen ? ` · on ${b.screen}` : ""}
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {["new", "reviewing", "resolved"].map((s) => (
                      <button key={s} onClick={() => setBugStatus(b.id, s)} disabled={adminBusyId === b.id || b.status === s}
                        style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", border: `1px solid ${b.status === s ? "#02C39A" : "#2A4A6B"}`, background: b.status === s ? "#0F3D2E" : "transparent", color: b.status === s ? "#02C39A" : "#8AAEC8", fontSize: "0.78rem", fontWeight: "600", cursor: b.status === s ? "default" : "pointer", minHeight: "40px", textTransform: "capitalize" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ---- Blocked families viewer ----
  if (view === "blocked") {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        {headerBar("Blocked families", () => setView("main"))}
        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          {message && (
            <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "10px", padding: "0.7rem 1rem", marginBottom: "1rem" }}>
              <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>{message}</p>
            </div>
          )}
          <p style={{ color: "#607080", fontSize: "0.82rem", lineHeight: "1.5", margin: "0 0 1.25rem" }}>
            Blocked families can't see you or invite you on Huddle, and you won't see them. They aren't told they've been blocked. You can unblock anyone here.
          </p>
          {blockedLoading ? (
            <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
          ) : blockedList.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
              <p style={{ margin: "0 0 0.75rem" }}><Icon name="block" size={40} color="#3E5A7F" /></p>
              <p style={{ color: "#607080", fontSize: "0.85rem" }}>You haven't blocked anyone.</p>
            </div>
          ) : (
            blockedList.map((b) => (
              <div key={b.parentId} style={{ display: "flex", alignItems: "center", gap: "12px", background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.75rem 1rem", marginBottom: "0.6rem" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "#028090", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontWeight: "600", flexShrink: 0 }}>
                  {b.photo_url ? <img src={b.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (b.name?.charAt(0) || "?")}
                </div>
                <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: 0, flex: 1 }}>{b.name}</p>
                <button onClick={() => doUnblock(b.parentId, b.name)}
                  style={{ padding: "0.45rem 0.9rem", borderRadius: "10px", border: "1px solid #02C39A", background: "transparent", color: "#02C39A", fontSize: "0.82rem", fontWeight: "600", cursor: "pointer" }}>
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ---- Admin: safety reports viewer ----
  if (view === "adminReports") {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        {headerBar("Safety Reports", () => setView("main"))}
        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          {adminLoading ? (
            <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
          ) : adminReports.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
              <p style={{ margin: "0 0 0.75rem" }}><Icon name="shield" size={40} color="#3E5A7F" /></p>
              <p style={{ color: "#607080", fontSize: "0.85rem" }}>No safety reports.</p>
            </div>
          ) : (
            adminReports.map((r) => (
              <div key={r.id} style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "1rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                  <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "600", margin: 0 }}>
                    {REPORT_CAT_LABELS[r.category] || r.category}
                  </p>
                  <span style={{ color: r.status === "new" ? "#E39A9A" : r.status === "actioned" ? "#02C39A" : "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", flexShrink: 0 }}>
                    {(r.status || "new").toUpperCase()}
                  </span>
                </div>
                <p style={{ color: "#8AAEC8", fontSize: "0.82rem", margin: "0 0 4px" }}>
                  {r.reported?.name || "Someone"} reported by {r.reporter?.name || "someone"}{r.also_blocked ? " · also blocked" : ""}
                </p>
                {r.details && (
                  <p style={{ color: "#B8CCE0", fontSize: "0.85rem", margin: "6px 0", fontStyle: "italic", lineHeight: "1.5" }}>"{r.details}"</p>
                )}
                <p style={{ color: "#607080", fontSize: "0.72rem", margin: "0 0 10px" }}>{new Date(r.created_at).toLocaleString()}</p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {["reviewing", "actioned", "dismissed"].map((st) => (
                    <button key={st} disabled={adminBusyId === r.id} onClick={() => setReportStatus(r.id, st)}
                      style={{ padding: "0.4rem 0.75rem", borderRadius: "8px", border: `1px solid ${r.status === st ? "#02C39A" : "#2A4A6B"}`, background: r.status === st ? "#12352C" : "transparent", color: r.status === st ? "#02C39A" : "#8AAEC8", fontSize: "0.75rem", fontWeight: "600", cursor: "pointer" }}>
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ---- Main settings ----
  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
      {headerBar("Settings", onBack)}

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {/* FASTER SIGN-IN */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>FASTER SIGN-IN</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem", overflow: "hidden" }}>
          <div style={{ padding: "1.25rem", borderBottom: passkeys.length > 0 ? "1px solid #2A4A6B" : "none" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.25rem" }}>🔐 Face ID / Touch ID</p>
            <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 0.85rem", lineHeight: "1.4" }}>
              Turn on Face ID for this device to sign back in with a tap — no email link needed next time.
            </p>
            <Button variant="secondary" onClick={addPasskey} disabled={passkeyBusy}
              style={{ background: "#0F3D2E", border: "1px solid #02C39A", color: "#02C39A" }}>
              {passkeyBusy ? "Setting up..." : "Set up Face ID on this device"}
            </Button>
            {passkeyMsg && <p style={{ color: "#8AAEC8", fontSize: "0.78rem", margin: "0.6rem 0 0" }}>{passkeyMsg}</p>}
          </div>
          {passkeys.map((pk) => (
            <div key={pk.id} style={{ padding: "0.85rem 1.25rem", borderTop: "1px solid #2A4A6B", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: "0 0 2px" }}>{pk.friendly_name || "Passkey"}</p>
                <p style={{ color: "#607080", fontSize: "0.72rem", margin: 0 }}>
                  Added {pk.created_at ? new Date(pk.created_at).toLocaleDateString() : ""}
                </p>
              </div>
              <button onClick={() => removePasskey(pk.id)} disabled={passkeyBusy}
                style={{ background: "transparent", border: "none", color: "#F87171", fontSize: "0.8rem", cursor: "pointer", minHeight: "44px" }}>
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* ACCOUNT */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>ACCOUNT</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 4px", letterSpacing: "0.05em" }}>EMAIL</p>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>{session.user.email}</p>
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 4px", letterSpacing: "0.05em" }}>MEMBER SINCE</p>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>
              {parent?.created_at ? new Date(parent.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}
            </p>
          </div>
        </div>

        {/* NOTIFICATIONS */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>NOTIFICATIONS</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem", padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.35rem" }}>In-app notifications</p>
              <p style={{ color: "#607080", fontSize: "0.78rem", margin: 0, lineHeight: "1.5" }}>
                Show the notification bell for connection requests, playdate and birthday RSVPs, and reminders. When off, you won't see bell alerts inside the app.
              </p>
            </div>
            <button onClick={() => updateNotifyPref("notify_in_app", !notifyInApp, setNotifyInApp, notifyInApp)} disabled={notifBusy} aria-label="Toggle in-app notifications"
              style={{ flexShrink: 0, width: "52px", height: "32px", borderRadius: "16px", border: "none", cursor: notifBusy ? "default" : "pointer", background: notifyInApp ? "#02C39A" : "#2A4A6B", position: "relative", transition: "background 0.2s", padding: 0, marginTop: "2px" }}>
              <span style={{ position: "absolute", top: "3px", left: notifyInApp ? "23px" : "3px", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </button>
          </div>

          <div style={{ height: "1px", background: "#2A4A6B", margin: "1.1rem 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.35rem" }}>Email notifications</p>
              <p style={{ color: "#607080", fontSize: "0.78rem", margin: 0, lineHeight: "1.5" }}>
                Get emails for RSVPs and event updates, including calendar (.ics) invites you can add to your calendar. When off, Huddle won't email you or send calendar invites.
              </p>
            </div>
            <button onClick={() => updateNotifyPref("notify_email", !notifyEmail, setNotifyEmail, notifyEmail)} disabled={notifBusy} aria-label="Toggle email notifications"
              style={{ flexShrink: 0, width: "52px", height: "32px", borderRadius: "16px", border: "none", cursor: notifBusy ? "default" : "pointer", background: notifyEmail ? "#02C39A" : "#2A4A6B", position: "relative", transition: "background 0.2s", padding: 0, marginTop: "2px" }}>
              <span style={{ position: "absolute", top: "3px", left: notifyEmail ? "23px" : "3px", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid #2A4A6B" }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.35rem" }}>Calendar invite when I create an event</p>
              <p style={{ color: "#607080", fontSize: "0.78rem", margin: 0, lineHeight: "1.5" }}>
                Email me a calendar invite when I set up a playdate or birthday, so it blocks my calendar right away. Turn off if you'd rather not get one each time you create an event.
              </p>
            </div>
            <button onClick={() => updateNotifyPref("notify_creation_calendar", !notifyCreationCal, setNotifyCreationCal, notifyCreationCal)} disabled={notifBusy} aria-label="Toggle creation calendar email"
              style={{ flexShrink: 0, width: "52px", height: "32px", borderRadius: "16px", border: "none", cursor: notifBusy ? "default" : "pointer", background: notifyCreationCal ? "#02C39A" : "#2A4A6B", position: "relative", transition: "background 0.2s", padding: 0, marginTop: "2px" }}>
              <span style={{ position: "absolute", top: "3px", left: notifyCreationCal ? "23px" : "3px", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </button>
          </div>
        </div>

        {/* PRIVACY */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>PRIVACY</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem", padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.35rem" }}>Let other parents at my school find me</p>
              <p style={{ color: "#607080", fontSize: "0.78rem", margin: 0, lineHeight: "1.5" }}>
                When on, parents at your school can find you by browsing classrooms. When off, only parents in your own classrooms, people you're already connected with, and anyone who searches your exact email can find you.
              </p>
            </div>
            {/* Toggle switch */}
            <button onClick={toggleDiscoverable} disabled={discoverBusy} aria-label="Toggle discoverability"
              style={{ flexShrink: 0, width: "52px", height: "32px", borderRadius: "16px", border: "none", cursor: discoverBusy ? "default" : "pointer", background: discoverable ? "#02C39A" : "#2A4A6B", position: "relative", transition: "background 0.2s", padding: 0, marginTop: "2px" }}>
              <span style={{ position: "absolute", top: "3px", left: discoverable ? "23px" : "3px", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </button>
          </div>
        </div>

        {/* REPORT A PROBLEM */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>HELP</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem", overflow: "hidden" }}>
          {!bugOpen ? (
            <div onClick={() => setBugOpen(true)}
              style={{ padding: "1rem 1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>🐞 Report a problem</p>
                <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>Found a bug or something off? Let us know.</p>
              </div>
              <Icon name="chevron_right" size={22} color="#02C39A" />
            </div>
          ) : (
            <div style={{ padding: "1.25rem" }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.75rem" }}>Report a problem</p>
              <textarea
                placeholder="What happened? The more detail, the easier it is for us to fix."
                value={bugText}
                onChange={(e) => setBugText(e.target.value)}
                rows={4}
                style={{ width: "100%", padding: "0.7rem 0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "0.75rem", resize: "vertical", fontFamily: "inherit" }} />
              <input type="text" placeholder="What screen were you on? (optional)" value={bugScreen}
                onChange={(e) => setBugScreen(e.target.value)}
                style={{ width: "100%", padding: "0.7rem 0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "0.85rem" }} />
              <div style={{ display: "flex", gap: "8px" }}>
                <Button variant="secondary" onClick={() => { setBugOpen(false); setBugText(""); setBugScreen(""); }} style={{ flex: 1 }}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={submitBug} disabled={!bugText.trim() || bugBusy}
                  style={{ flex: 2, background: bugText.trim() ? "#02C39A" : "#2A4A6B" }}>
                  {bugBusy ? "Sending..." : "Send report"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ADMIN (only visible to admins) */}
        {parent?.is_admin && (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>ADMIN</p>
            <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem" }}>
              <div onClick={openAdminBugs}
                style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>📋 Bug Reports</p>
                  <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>Review what users have reported</p>
                </div>
                <Icon name="chevron_right" size={22} color="#02C39A" />
              </div>
              <div onClick={openAdminReports}
                style={{ padding: "1rem 1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>🛡️ Safety Reports</p>
                  <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>Review reports about people</p>
                </div>
                <Icon name="chevron_right" size={22} color="#02C39A" />
              </div>
            </div>
          </>
        )}

        {/* LEGAL */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>SAFETY</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem" }}>
          <div onClick={openBlocked}
            style={{ padding: "1rem 1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Blocked families</p>
              <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>Manage who you've blocked</p>
            </div>
            <Icon name="chevron_right" size={22} color="#02C39A" />
          </div>
        </div>

        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>LEGAL</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1.5rem" }}>
          <div onClick={() => setView("terms")}
            style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Terms of Service</p>
              <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                {tosConsent
                  ? `v${tosConsent.document_version} · agreed ${new Date(tosConsent.consented_at).toLocaleDateString()}`
                  : "Not yet agreed"}
              </p>
            </div>
            <Icon name="chevron_right" size={22} color="#02C39A" />
          </div>
          <div onClick={() => setView("privacy")}
            style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Privacy Policy</p>
              <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                {privacyConsent
                  ? `v${privacyConsent.document_version} · agreed ${new Date(privacyConsent.consented_at).toLocaleDateString()}`
                  : "Not yet agreed"}
              </p>
            </div>
            <Icon name="chevron_right" size={22} color="#02C39A" />
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 4px" }}>Request data deletion</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
              Email <span style={{ color: "#02C39A" }}>admin@huddlefamilies.com</span> to request account and data deletion
            </p>
          </div>
        </div>

        <Button fullWidth variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}