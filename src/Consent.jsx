import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./supabase";
import { TERMS_OF_SERVICE, PRIVACY_POLICY, TERMS_VERSION, PRIVACY_VERSION } from "./legal";

export default function Consent({ session, onConsented }) {
  const [view, setView] = useState("main");
  const [isEligible, setIsEligible] = useState(false);   // parent/guardian + 18+
  const [agreesToLegal, setAgreesToLegal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allChecked = isEligible && agreesToLegal;

  const submitConsent = async () => {
    setLoading(true);
    setError("");
    try {
      // Ensure a parents row exists BEFORE writing consent records.
      // parent_consents has a foreign key to parents, so the parent must
      // exist first. The name is filled in later during profile setup.
      const { error: parentErr } = await supabase.from("parents").upsert(
        { id: session.user.id },
        { onConflict: "id", ignoreDuplicates: true }
      );
      if (parentErr && !parentErr.message.includes("duplicate")) throw parentErr;

      const { error: tosErr } = await supabase.from("parent_consents").insert({
        parent_id: session.user.id,
        document_type: "terms_of_service",
        document_version: TERMS_VERSION,
        user_agent: navigator.userAgent,
      });
      if (tosErr && !tosErr.message.includes("duplicate")) throw tosErr;

      const { error: privErr } = await supabase.from("parent_consents").insert({
        parent_id: session.user.id,
        document_type: "privacy_policy",
        document_version: PRIVACY_VERSION,
        user_agent: navigator.userAgent,
      });
      if (privErr && !privErr.message.includes("duplicate")) throw privErr;

      onConsented();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // ---- Document viewer (opened via the inline links; reading is optional) ----
  if (view === "terms" || view === "privacy") {
    const doc = view === "terms" ? TERMS_OF_SERVICE : PRIVACY_POLICY;
    const title = view === "terms" ? "Terms of Service" : "Privacy Policy";
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B", position: "sticky", top: 0, zIndex: 10 }}>
          <button onClick={() => setView("main")} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>{title}</h1>
          <div style={{ width: "60px" }} />
        </div>
        <div style={{ padding: "1.5rem", maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ color: "#FFFFFF", fontSize: "0.9rem", lineHeight: "1.6" }}>
            <ReactMarkdown>{doc}</ReactMarkdown>
          </div>
          <div style={{ padding: "2rem 0", textAlign: "center" }}>
            <button onClick={() => setView("main")}
              style={{ padding: "0.85rem 2rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              Done →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "460px" }}>

        <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem", textAlign: "center" }}>Welcome to Huddle</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.95rem", margin: "0 0 2rem", textAlign: "center", lineHeight: "1.5" }}>
          Just two quick confirmations and you're in.
        </p>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", border: "1px solid #2A4A6B", marginBottom: "1.25rem" }}>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer", marginBottom: "1.1rem" }}>
            <input type="checkbox" checked={isEligible} onChange={(e) => setIsEligible(e.target.checked)}
              style={{ marginTop: "2px", width: "20px", height: "20px", accentColor: "#02C39A", cursor: "pointer", flexShrink: 0 }} />
            <span style={{ color: "#FFFFFF", fontSize: "0.9rem", lineHeight: "1.5" }}>
              I'm a parent or legal guardian of a school-aged child, and I'm 18 or older.
            </span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
            <input type="checkbox" checked={agreesToLegal} onChange={(e) => setAgreesToLegal(e.target.checked)}
              style={{ marginTop: "2px", width: "20px", height: "20px", accentColor: "#02C39A", cursor: "pointer", flexShrink: 0 }} />
            <span style={{ color: "#FFFFFF", fontSize: "0.9rem", lineHeight: "1.5" }}>
              I agree to Huddle's{" "}
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); setView("terms"); }}
                style={{ color: "#02C39A", textDecoration: "underline", cursor: "pointer" }}>Terms of Service</span>
              {" "}and{" "}
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); setView("privacy"); }}
                style={{ color: "#02C39A", textDecoration: "underline", cursor: "pointer" }}>Privacy Policy</span>.
            </span>
          </label>

        </div>

        <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 1.25rem", textAlign: "center", lineHeight: "1.5" }}>
          Tap either document above to read it in full any time.
        </p>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem", textAlign: "center" }}>{error}</p>}

        <button onClick={submitConsent} disabled={!allChecked || loading}
          style={{ width: "100%", padding: "0.95rem", borderRadius: "10px", border: "none",
            background: allChecked ? "#02C39A" : "#2A4A6B", color: "#0F2044",
            fontSize: "1rem", fontWeight: "600", cursor: allChecked ? "pointer" : "not-allowed", marginBottom: "1rem",
            transition: "background 0.2s" }}>
          {loading ? "Saving..." : "Agree and continue →"}
        </button>

        <button onClick={signOut}
          style={{ width: "100%", padding: "0.6rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer" }}>
          Cancel and sign out
        </button>
      </div>
    </div>
  );
}