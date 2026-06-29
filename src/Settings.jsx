import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./supabase";
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from "./legal";

export default function Settings({ session, onBack }) {
  const [parent, setParent] = useState(null);
  const [consents, setConsents] = useState([]);
  const [view, setView] = useState("main"); // "main" | "terms" | "privacy" | "adminBugs"
  const [message, setMessage] = useState("");

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
      .select("id, name, is_admin, created_at")
      .eq("id", session.user.id)
      .single();
    setParent(data);
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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const tosConsent = consents.find((c) => c.document_type === "terms_of_service");
  const privacyConsent = consents.find((c) => c.document_type === "privacy_policy");

  const headerBar = (title, backTo) => (
    <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B", position: "sticky", top: 0, zIndex: 10 }}>
      <button onClick={backTo} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
      <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>{title}</h1>
      <div style={{ width: "60px" }} />
    </div>
  );

  // ---- Legal doc viewer ----
  if (view === "terms" || view === "privacy") {
    const doc = view === "terms" ? TERMS_OF_SERVICE : PRIVACY_POLICY;
    const title = view === "terms" ? "Terms of Service" : "Privacy Policy";
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
        {headerBar(title, () => setView("main"))}
        <div style={{ padding: "1.5rem", maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ color: "#FFFFFF", fontSize: "0.9rem", lineHeight: "1.6" }}>
            <ReactMarkdown>{doc}</ReactMarkdown>
          </div>
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
            <button onClick={addPasskey} disabled={passkeyBusy}
              style={{ padding: "0.7rem 1rem", borderRadius: "10px", border: "1px solid #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", minHeight: "44px" }}>
              {passkeyBusy ? "Setting up..." : "Set up Face ID on this device"}
            </button>
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
              <span style={{ color: "#02C39A", fontSize: "1.1rem" }}>→</span>
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
                <button onClick={() => { setBugOpen(false); setBugText(""); setBugScreen(""); }}
                  style={{ flex: 1, padding: "0.75rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer", minHeight: "44px" }}>
                  Cancel
                </button>
                <button onClick={submitBug} disabled={!bugText.trim() || bugBusy}
                  style={{ flex: 2, padding: "0.75rem", borderRadius: "10px", border: "none", background: bugText.trim() ? "#02C39A" : "#2A4A6B", color: "#0F2044", fontSize: "0.9rem", fontWeight: "600", cursor: bugText.trim() ? "pointer" : "default", minHeight: "44px" }}>
                  {bugBusy ? "Sending..." : "Send report"}
                </button>
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
                style={{ padding: "1rem 1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>📋 Bug Reports</p>
                  <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>Review what users have reported</p>
                </div>
                <span style={{ color: "#02C39A", fontSize: "1.1rem" }}>→</span>
              </div>
            </div>
          </>
        )}

        {/* LEGAL */}
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
            <span style={{ color: "#02C39A", fontSize: "1.1rem" }}>→</span>
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
            <span style={{ color: "#02C39A", fontSize: "1.1rem" }}>→</span>
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 4px" }}>Request data deletion</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
              Email <span style={{ color: "#02C39A" }}>admin@huddlefamilies.com</span> to request account and data deletion
            </p>
          </div>
        </div>

        <button onClick={signOut}
          style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #F87171", background: "transparent", color: "#F87171", fontSize: "1rem", cursor: "pointer" }}>
          Sign out
        </button>
      </div>
    </div>
  );
}