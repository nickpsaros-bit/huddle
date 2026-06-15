# Huddle Codebase Snapshot

Updated: June 14, 2026


---

## File: src/main.jsx

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

---

## File: src/App.jsx

```jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Consent from "./Consent";
import Profile from "./Profile";
import Home from "./Home";
import NavBar from "./NavBar";
import ProfileScreen from "./ProfileScreen";
import Search from "./Search";
import Inbox from "./Inbox";
import Network from "./Network";
import Playdates from "./Playdates";
import { TERMS_VERSION, PRIVACY_VERSION } from "./legal";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasConsented, setHasConsented] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [showInbox, setShowInbox] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [playdateBadge, setPlaydateBadge] = useState(0);
  const [playdateHalo, setPlaydateHalo] = useState(null); // "amber" | "teal" | null

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        checkConsent(session.user.id);
        checkProfile(session.user.id);
        fetchCounts(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) {
          checkConsent(session.user.id);
          checkProfile(session.user.id);
          fetchCounts(session.user.id);
        } else {
          setHasConsented(false);
          setHasProfile(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkConsent = async (userId) => {
    const { data } = await supabase
      .from("parent_consents")
      .select("document_type, document_version")
      .eq("parent_id", userId);

    const hasTerms = (data || []).some(c => c.document_type === "terms_of_service" && c.document_version === TERMS_VERSION);
    const hasPrivacy = (data || []).some(c => c.document_type === "privacy_policy" && c.document_version === PRIVACY_VERSION);

    setHasConsented(hasTerms && hasPrivacy);
  };

  const checkProfile = async (userId) => {
    const { data: parentData } = await supabase
      .from("parents")
      .select("id, name")
      .eq("id", userId)
      .single();

    if (!parentData || !parentData.name) {
      setHasProfile(false);
      return;
    }

    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", userId)
      .single();

    if (!hm) {
      setHasProfile(false);
      return;
    }

    const { data: memberships } = await supabase
      .from("classroom_members")
      .select("id")
      .eq("household_id", hm.household_id)
      .limit(1);

    setHasProfile(memberships && memberships.length > 0);
  };

  // Bell = people/communications. Playdate badge = un-RSVP'd invites.
  // Halo: amber if ANY live (upcoming, non-declined) invite — mine or, when I
  //   host, any guest's — is "maybe" or unanswered. Teal if there's a confirmed
  //   "going" and no maybes/unanswered. Null if nothing live.
  const fetchCounts = async (userId) => {
    const { data: myHh } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", userId)
      .maybeSingle();

    // --- Bell count ---
    const { data: conns } = await supabase
      .from("connections")
      .select("id")
      .eq("recipient_id", userId)
      .eq("status", "pending");
    let bell = conns ? conns.length : 0;

    if (myHh) {
      const { data: joins } = await supabase
        .from("household_join_requests")
        .select("id")
        .eq("target_household_id", myHh.household_id)
        .eq("status", "pending");
      bell += joins ? joins.length : 0;
    }
    setNotificationCount(bell);

    if (!myHh) {
      setPlaydateBadge(0);
      setPlaydateHalo(null);
      return;
    }

    const nowMs = Date.now();
    let hasMaybeOrUnanswered = false;
    let hasGoing = false;
    let unrepliedCount = 0;

    // Invites TO my household.
    const { data: myInv } = await supabase
      .from("playdate_invites")
      .select("rsvp, playdates(proposed_date, organizer_household_id)")
      .eq("household_id", myHh.household_id);

    for (const inv of (myInv || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.organizer_household_id === myHh.household_id) continue; // hosting handled below
      if (new Date(pd.proposed_date).getTime() < nowMs) continue; // past
      if (inv.rsvp === "invited") { hasMaybeOrUnanswered = true; unrepliedCount++; }
      else if (inv.rsvp === "maybe") { hasMaybeOrUnanswered = true; }
      else if (inv.rsvp === "yes") { hasGoing = true; }
    }

    // Playdates I HOST (future) — inspect each guest's RSVP.
    const { data: hosting } = await supabase
      .from("playdates")
      .select("id, proposed_date")
      .eq("organizer_household_id", myHh.household_id)
      .gte("proposed_date", new Date(nowMs).toISOString());

    for (const pd of (hosting || [])) {
      const { data: invs } = await supabase
        .from("playdate_invites")
        .select("rsvp")
        .eq("playdate_id", pd.id);
      const list = invs || [];
      const anyMaybeOrUnanswered = list.some((i) => i.rsvp === "maybe" || i.rsvp === "invited");
      const anyGoing = list.some((i) => i.rsvp === "yes");
      if (anyMaybeOrUnanswered) hasMaybeOrUnanswered = true;
      if (anyGoing) hasGoing = true;
    }

    setPlaydateBadge(unrepliedCount);
    setPlaydateHalo(hasMaybeOrUnanswered ? "amber" : (hasGoing ? "teal" : null));
  };

  const handleNavigate = (tabId) => {
    setActiveTab(tabId);
    if (tabId === "playdates" && session) {
      setTimeout(() => fetchCounts(session.user.id), 1500);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.5rem" }}>Huddle</p>
      </div>
    );
  }

  if (!session) {
    return <Auth onAuth={() => {}} />;
  }

  if (!hasConsented) {
    return <Consent session={session} onConsented={() => setHasConsented(true)} />;
  }

  if (!hasProfile) {
    return <Profile session={session} onComplete={() => setHasProfile(true)} />;
  }

  if (showInbox) {
    return <Inbox session={session} onBack={() => { setShowInbox(false); fetchCounts(session.user.id); checkProfile(session.user.id); }} />;
  }

  let screen;
  if (activeTab === "home") {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} />;
  } else if (activeTab === "search") {
    screen = <Search session={session} />;
  } else if (activeTab === "network") {
    screen = <Network session={session} />;
  } else if (activeTab === "playdates") {
    screen = <Playdates session={session} onChanged={() => fetchCounts(session.user.id)} />;
  } else if (activeTab === "profile") {
    screen = <ProfileScreen session={session} onBack={() => setActiveTab("home")} />;
  } else {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} />;
  }

  return (
    <div>
      <div style={{ paddingBottom: "70px" }}>
        {screen}
      </div>
      <NavBar
        active={activeTab}
        onNavigate={handleNavigate}
        badges={{ playdates: playdateBadge }}
        halos={{ playdates: playdateHalo }}
      />
    </div>
  );
}```

---

## File: src/supabase.js

```jsx
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fhhnmxrqklgwsjffkcex.supabase.co'
const supabaseKey = 'sb_publishable_q8G8GHAQIWUNHVnqrHdgiw_HN4vJOGV'

export const supabase = createClient(supabaseUrl, supabaseKey)
```

---

## File: src/Auth.jsx

```jsx
import { useState } from "react";
import { supabase } from "./supabase";

export default function Auth({ onAuth }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      }
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
  };

  const sendLink = async () => {
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      }
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0F2044", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "2rem", fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "3rem", fontWeight: "700", margin: "0 0 0.5rem" }}>
        Huddle
      </h1>
      <p style={{ color: "#B0C4D8", fontSize: "1rem", margin: "0 0 3rem" }}>
        The social app for school families
      </p>

      <div style={{ background: "#162D50", borderRadius: "16px", padding: "2rem", width: "100%", maxWidth: "400px" }}>
        {!sent ? (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 1.5rem" }}>Welcome</h2>

            {/* Google Sign In */}
            <button
              onClick={signInWithGoogle}
              disabled={googleLoading}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: "10px",
                border: "1px solid #2A4A6B", background: "#FFFFFF",
                color: "#1F1F1F", fontSize: "1rem", fontWeight: "500",
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: "10px", marginBottom: "1rem"
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              {googleLoading ? "Signing in..." : "Continue with Google"}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
              <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
              <span style={{ color: "#607080", fontSize: "0.8rem" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
            </div>

            {/* Email */}
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1rem" }}>
              Continue with email
            </p>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendLink()}
              style={inputStyle}
            />
            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}
            <button onClick={sendLink} disabled={loading || !email}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: "10px",
                border: "none", background: loading ? "#028090" : "#02C39A",
                color: "#0F2044", fontSize: "1rem", fontWeight: "600",
                cursor: loading ? "not-allowed" : "pointer"
              }}>
              {loading ? "Sending..." : "Send magic link →"}
            </button>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <p style={{ fontSize: "3rem", margin: "0 0 1rem" }}>📬</p>
              <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.75rem" }}>Check your email</h2>
              <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem", lineHeight: "1.6" }}>
                We sent a magic link to <strong style={{ color: "#FFFFFF" }}>{email}</strong>.
                Tap the link in your email to sign in.
              </p>
              <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>
                Didn't get it? Check your spam folder.
              </p>
            </div>
            <button onClick={() => { setSent(false); setEmail(""); }}
              style={{
                width: "100%", padding: "0.85rem", borderRadius: "10px",
                border: "1px solid #2A4A6B", background: "transparent",
                color: "#8AAEC8", fontSize: "1rem", fontWeight: "600",
                cursor: "pointer", marginTop: "1.5rem"
              }}>
              ← Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}```

---

## File: src/Consent.jsx

```jsx
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./supabase";
import { TERMS_OF_SERVICE, PRIVACY_POLICY, TERMS_VERSION, PRIVACY_VERSION } from "./legal";

export default function Consent({ session, onConsented }) {
  const [view, setView] = useState("main");
  const [isAdult, setIsAdult] = useState(false);
  const [isParent, setIsParent] = useState(false);
  const [agreesToLegal, setAgreesToLegal] = useState(false);
  const [hasScrolledTerms, setHasScrolledTerms] = useState(false);
  const [hasScrolledPrivacy, setHasScrolledPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allChecked = isAdult && isParent && agreesToLegal;
  const hasReadBoth = hasScrolledTerms && hasScrolledPrivacy;

  const markAsRead = (doc) => {
    if (doc === "terms") setHasScrolledTerms(true);
    if (doc === "privacy") setHasScrolledPrivacy(true);
    setView("main");
  };

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
            <button onClick={() => markAsRead(view)}
              style={{ padding: "0.85rem 2rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              I've read this →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "500px" }}>

        <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem", textAlign: "center" }}>Welcome to Huddle</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.95rem", margin: "0 0 2rem", textAlign: "center" }}>Before we get started, please review and agree to the following.</p>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", border: "1px solid #2A4A6B", marginBottom: "1.5rem" }}>
          <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 1rem" }}>📄 Please read these documents</p>

          <div onClick={() => setView("terms")}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem", background: "#0F2044", borderRadius: "10px", border: "1px solid #2A4A6B", cursor: "pointer", marginBottom: "0.75rem" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Terms of Service</p>
              <p style={{ color: hasScrolledTerms ? "#02C39A" : "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                {hasScrolledTerms ? "✓ Read" : "Tap to read"}
              </p>
            </div>
            <span style={{ color: "#02C39A", fontSize: "1.2rem" }}>→</span>
          </div>

          <div onClick={() => setView("privacy")}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem", background: "#0F2044", borderRadius: "10px", border: "1px solid #2A4A6B", cursor: "pointer" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Privacy Policy</p>
              <p style={{ color: hasScrolledPrivacy ? "#02C39A" : "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                {hasScrolledPrivacy ? "✓ Read" : "Tap to read"}
              </p>
            </div>
            <span style={{ color: "#02C39A", fontSize: "1.2rem" }}>→</span>
          </div>
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", border: "1px solid #2A4A6B", marginBottom: "1.5rem" }}>
          <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 1rem" }}>✓ Confirm to continue</p>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: "0.75rem" }}>
            <input type="checkbox" checked={isAdult} onChange={(e) => setIsAdult(e.target.checked)}
              style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: "#02C39A", cursor: "pointer" }} />
            <span style={{ color: "#FFFFFF", fontSize: "0.85rem", lineHeight: "1.4" }}>I am 18 years or older</span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: "0.75rem" }}>
            <input type="checkbox" checked={isParent} onChange={(e) => setIsParent(e.target.checked)}
              style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: "#02C39A", cursor: "pointer" }} />
            <span style={{ color: "#FFFFFF", fontSize: "0.85rem", lineHeight: "1.4" }}>I am a parent or legal guardian of a school-aged child</span>
          </label>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: hasReadBoth ? "pointer" : "not-allowed", opacity: hasReadBoth ? 1 : 0.5 }}>
            <input type="checkbox" checked={agreesToLegal} disabled={!hasReadBoth}
              onChange={(e) => setAgreesToLegal(e.target.checked)}
              style={{ marginTop: "3px", width: "18px", height: "18px", accentColor: "#02C39A", cursor: hasReadBoth ? "pointer" : "not-allowed" }} />
            <span style={{ color: "#FFFFFF", fontSize: "0.85rem", lineHeight: "1.4" }}>
              I have read and agree to the Terms of Service and Privacy Policy
              {!hasReadBoth && <span style={{ color: "#F59E0B", fontSize: "0.75rem", display: "block", marginTop: "2px" }}>Please open both documents first</span>}
            </span>
          </label>
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem", textAlign: "center" }}>{error}</p>}

        <button onClick={submitConsent} disabled={!allChecked || loading}
          style={{ width: "100%", padding: "0.95rem", borderRadius: "10px", border: "none",
            background: allChecked ? "#02C39A" : "#2A4A6B", color: "#0F2044",
            fontSize: "1rem", fontWeight: "600", cursor: allChecked ? "pointer" : "not-allowed", marginBottom: "1rem" }}>
          {loading ? "Saving..." : "Agree and Continue →"}
        </button>

        <button onClick={signOut}
          style={{ width: "100%", padding: "0.6rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer" }}>
          Cancel and sign out
        </button>
      </div>
    </div>
  );
}```

---

## File: src/Profile.jsx

```jsx
import { useState } from "react";
import { supabase } from "./supabase";

export default function Profile({ session, onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: parent info
  const [parentName, setParentName] = useState("");

  // Step 2: classroom info
  const [grade, setGrade] = useState("");
  const [teacher, setTeacher] = useState("");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolResults, setSchoolResults] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [teacherResults, setTeacherResults] = useState([]);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  const searchSchools = async (query) => {
    setSchoolSearch(query);
    setSelectedSchool(null);
    setTeacherResults([]);
    setTeacher("");
    if (query.length < 2) { setSchoolResults([]); setShowSchoolDropdown(false); return; }
    const { data } = await supabase.from("schools").select("*").ilike("name", `%${query}%`).limit(5);
    setSchoolResults(data || []);
    setShowSchoolDropdown(true);
  };

  const selectSchool = async (school) => {
    setSelectedSchool(school);
    setSchoolSearch(school.name);
    setShowSchoolDropdown(false);
    const { data } = await supabase.from("classrooms").select("teacher_name").eq("school_id", school.id).limit(20);
    const unique = [...new Set((data || []).map(c => c.teacher_name))];
    setTeacherResults(unique);
  };

  const teacherMismatch = teacherResults.length > 0 && teacher &&
    !teacherResults.find(t => t.toLowerCase() === teacher.toLowerCase());

  const saveStep1 = async () => {
    setLoading(true);
    setError("");
    try {
      const { error: parentErr } = await supabase.from("parents").upsert({
        id: session.user.id,
        name: parentName,
      });
      if (parentErr) throw parentErr;
      setStep(2);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const saveStep2 = async () => {
    setLoading(true);
    setError("");
    try {
      // School: existing or new
      let school;
      if (selectedSchool) {
        school = selectedSchool;
      } else {
        const code = schoolSearch.toUpperCase().replace(/\s+/g, "").slice(0, 10) + Date.now().toString().slice(-4);
        const { data: newSchool, error: schoolErr } = await supabase.from("schools")
          .insert({ name: schoolSearch, activation_code: code })
          .select().single();
        if (schoolErr) throw schoolErr;
        school = newSchool;
      }

      const currentYear = new Date().getFullYear();
      const schoolYear = `${currentYear}-${currentYear + 1}`;

      // Classroom: existing or new
      let classroom;
      const { data: existing } = await supabase.from("classrooms").select()
        .eq("school_id", school.id)
        .eq("teacher_name", teacher)
        .eq("school_year", schoolYear)
        .maybeSingle();
      if (existing) {
        classroom = existing;
      } else {
        const { data: newClassroom, error: classroomErr } = await supabase.from("classrooms")
          .insert({ school_id: school.id, teacher_name: teacher, grade: grades.indexOf(grade), school_year: schoolYear })
          .select().single();
        if (classroomErr) throw classroomErr;
        classroom = newClassroom;
      }

      // Create own household
      const { data: household, error: hhErr } = await supabase
        .from("households")
        .insert({})
        .select()
        .single();
      if (hhErr) throw hhErr;

      const { error: memberErr } = await supabase
        .from("household_members")
        .insert({
          household_id: household.id,
          parent_id: session.user.id,
          role: "primary",
        });
      if (memberErr) throw memberErr;

      const { error: cmErr } = await supabase.from("classroom_members").insert({
        household_id: household.id,
        classroom_id: classroom.id,
        school_year: schoolYear,
      });
      if (cmErr && !cmErr.message.includes("duplicate")) throw cmErr;

      onComplete();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "440px" }}>

        <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem", textAlign: "center" }}>Huddle</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 2rem", textAlign: "center" }}>The social app for school families</p>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "2rem", justifyContent: "center" }}>
          {[1, 2].map(n => (
            <div key={n} style={{
              width: step >= n ? "32px" : "8px",
              height: "8px",
              borderRadius: "4px",
              background: step >= n ? "#02C39A" : "#2A4A6B",
              transition: "all 0.3s"
            }} />
          ))}
        </div>

        {/* Step 1: Parent info */}
        {step === 1 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Welcome!</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Let's get to know you. What's your name?</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Your full name</label>
            <input type="text" placeholder="Jane Smith" value={parentName}
              onChange={(e) => setParentName(e.target.value)} style={inputStyle} />

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={saveStep1} disabled={!parentName || loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
                background: !parentName ? "#2A4A6B" : "#02C39A", color: "#0F2044",
                fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginTop: "0.5rem" }}>
              {loading ? "Saving..." : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 2: Classroom info */}
        {step === 2 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Add a classroom</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Tell us about your child's classroom. You can add more later.</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text" placeholder="Start typing school name..." value={schoolSearch}
                onChange={(e) => searchSchools(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
              {showSchoolDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10 }}>
                  {schoolResults.map(school => (
                    <div key={school.id} onClick={() => selectSchool(school)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      🏫 {school.name}
                    </div>
                  ))}
                  <div onClick={() => { setSelectedSchool(null); setShowSchoolDropdown(false); }}
                    style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem" }}>
                    + Add "{schoolSearch}" as a new school
                  </div>
                </div>
              )}
            </div>

            {selectedSchool && (
              <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
                <span style={{ color: "#02C39A", fontSize: "0.85rem" }}>✓ {selectedSchool.name}</span>
              </div>
            )}

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text"
                placeholder={teacherResults.length > 0 ? "Select or type teacher name..." : "Mrs. Johnson"}
                value={teacher}
                onChange={(e) => { setTeacher(e.target.value); setShowTeacherDropdown(e.target.value.length > 0); }}
                onFocus={() => { if (teacherResults.length > 0) setShowTeacherDropdown(true); }}
                style={{ ...inputStyle, marginBottom: 0, borderColor: teacherMismatch ? "#854F0B" : "#2A4A6B" }} />
              {showTeacherDropdown && teacherResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
                  {teacherResults.filter(t => t.toLowerCase().includes(teacher.toLowerCase())).map(t => (
                    <div key={t} onClick={() => { setTeacher(t); setShowTeacherDropdown(false); }}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      📚 {t}
                    </div>
                  ))}
                  {teacherMismatch && (
                    <div onClick={() => setShowTeacherDropdown(false)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem", borderTop: "1px solid #2A4A6B" }}>
                      + Add "{teacher}" as a new teacher
                    </div>
                  )}
                </div>
              )}
            </div>

            {teacherMismatch && (
              <div style={{ background: "#3D1F0A", border: "1px solid #854F0B", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem", marginTop: "-0.5rem" }}>
                <p style={{ color: "#F59E0B", fontSize: "0.8rem", margin: 0 }}>
                  ⚠️ This teacher isn't in our system yet. Double-check spelling or select from the list above.
                </p>
              </div>
            )}

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={saveStep2} disabled={!grade || !schoolSearch || !teacher || loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
                background: (!grade || !schoolSearch || !teacher) ? "#2A4A6B" : "#02C39A",
                color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              {loading ? "Saving..." : "Finish setup →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}```

---

## File: src/Home.jsx

```jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ProfileScreen from "./ProfileScreen";
import PlaydateRequest from "./PlaydateRequest";

export default function Home({ session, notificationCount, onBellClick }) {
  const [parent, setParent] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [classmates, setClassmates] = useState({});
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [addingClassroom, setAddingClassroom] = useState(false);
  const [newGrade, setNewGrade] = useState("");
  const [newTeacher, setNewTeacher] = useState("");
  const [newSchoolSearch, setNewSchoolSearch] = useState("");
  const [newSchoolResults, setNewSchoolResults] = useState([]);
  const [newSelectedSchool, setNewSelectedSchool] = useState(null);
  const [newTeacherResults, setNewTeacherResults] = useState([]);
  const [showNewSchoolDropdown, setShowNewSchoolDropdown] = useState(false);
  const [showNewTeacherDropdown, setShowNewTeacherDropdown] = useState(false);
  const [savingMembership, setSavingMembership] = useState(false);
  const [membershipError, setMembershipError] = useState("");
  const [householdBusy, setHouseholdBusy] = useState(false);

  // Find-a-household-member flow
  const [findingMember, setFindingMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberCandidates, setMemberCandidates] = useState([]);
  const [linkMessage, setLinkMessage] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  useEffect(() => { fetchData(); }, []);

  // Privacy-safe short name: "Nick Psaros" -> "Nick P."
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const fetchData = async () => {
    setLoading(true);

    const { data: parentData } = await supabase
      .from("parents")
      .select("*")
      .eq("id", session.user.id)
      .single();
    setParent(parentData);

    const { data: householdMember } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("parent_id", session.user.id)
      .single();

    if (!householdMember) {
      setLoading(false);
      return;
    }

    const hhId = householdMember.household_id;
    setHouseholdId(hhId);
    setMyRole(householdMember.role);

    const { data: members } = await supabase
      .from("household_members")
      .select("id, parent_id, role, joined_at, parents(id, name, photo_url)")
      .eq("household_id", hhId)
      .order("joined_at", { ascending: true });
    setHouseholdMembers(members || []);

    const { data: membershipData } = await supabase
      .from("classroom_members")
      .select("*, classrooms(id, teacher_name, grade, school_year, schools(id, name))")
      .eq("household_id", hhId);
    setMemberships(membershipData || []);

    const classmatesMap = {};
    for (const m of (membershipData || [])) {
      const { data: otherMembers } = await supabase
        .from("classroom_members")
        .select("*, households(id, household_members(parent_id, parents(id, name, photo_url)))")
        .eq("classroom_id", m.classroom_id)
        .eq("school_year", m.school_year)
        .neq("household_id", hhId);
      classmatesMap[m.id] = otherMembers || [];
    }
    setClassmates(classmatesMap);

    setLoading(false);
  };

  // Search parents who share a classroom with me (excludes my own household).
  // Returns candidates as { parentId, name, photo_url, householdId }.
  const runMemberSearch = async (query) => {
    setMemberSearch(query);
    if (query.trim().length < 2) { setMemberCandidates([]); return; }

    // My classroom IDs.
    const classroomIds = memberships.map((m) => m.classroom_id);
    if (classroomIds.length === 0) { setMemberCandidates([]); return; }

    // Other households in those classrooms.
    const { data: cms } = await supabase
      .from("classroom_members")
      .select("household_id")
      .in("classroom_id", classroomIds)
      .neq("household_id", householdId);

    const otherHouseholdIds = [...new Set((cms || []).map((c) => c.household_id))];
    if (otherHouseholdIds.length === 0) { setMemberCandidates([]); return; }

    // Parents in those households.
    const { data: hms } = await supabase
      .from("household_members")
      .select("parent_id, household_id, parents(id, name, photo_url)")
      .in("household_id", otherHouseholdIds);

    const q = query.trim().toLowerCase();
    const seen = new Set();
    const candidates = [];
    (hms || []).forEach((h) => {
      const p = h.parents;
      if (!p) return;
      if (seen.has(p.id)) return;
      if (!p.name || !p.name.toLowerCase().includes(q)) return;
      seen.add(p.id);
      candidates.push({ parentId: p.id, name: p.name, photo_url: p.photo_url, householdId: h.household_id });
    });
    setMemberCandidates(candidates);
  };

  const askToLink = async (candidate) => {
    setLinkBusy(true);
    setLinkMessage("");
    try {
      // Use the household_join_requests table: I'm requesting to join THEIR household.
      const { error } = await supabase.from("household_join_requests").insert({
        requesting_parent_id: session.user.id,
        target_household_id: candidate.householdId,
      });
      if (error) {
        if (error.message.includes("duplicate") || error.message.includes("one_pending")) {
          setLinkMessage("You already have a pending request.");
        } else {
          throw error;
        }
      } else {
        setLinkMessage(`Request sent to ${shortName(candidate.name)}'s household. They'll approve from their notifications.`);
        setMemberCandidates([]);
        setMemberSearch("");
      }
    } catch (err) {
      setLinkMessage("Error: " + err.message);
    }
    setLinkBusy(false);
  };

  const removeMember = async (memberRow) => {
    setHouseholdBusy(true);
    try {
      const leavingParentId = memberRow.parent_id;
      const wasPrimary = memberRow.role === "primary";

      const { error: delErr } = await supabase
        .from("household_members")
        .delete()
        .eq("id", memberRow.id);
      if (delErr) throw delErr;

      const { data: remaining } = await supabase
        .from("household_members")
        .select("id, parent_id, role, joined_at")
        .eq("household_id", householdId)
        .order("joined_at", { ascending: true });

      if (!remaining || remaining.length === 0) {
        await supabase.from("classroom_members").delete().eq("household_id", householdId);
        await supabase.from("households").delete().eq("id", householdId);
      } else if (wasPrimary && !remaining.some((m) => m.role === "primary")) {
        await supabase
          .from("household_members")
          .update({ role: "primary" })
          .eq("id", remaining[0].id);
      }

      if (leavingParentId === session.user.id) {
        window.location.reload();
        return;
      }

      fetchData();
    } catch (err) {
      alert("Error: " + err.message);
    }
    setHouseholdBusy(false);
  };

  const confirmRemoveOther = (memberRow) => {
    const nm = shortName(memberRow.parents?.name);
    if (window.confirm(`Remove ${nm} from your household? They'll need to set up their own household.`)) {
      removeMember(memberRow);
    }
  };

  const confirmLeave = () => {
    const me = householdMembers.find((m) => m.parent_id === session.user.id);
    if (!me) return;
    if (window.confirm("Leave this household? You'll need to set up your own household afterward.")) {
      removeMember(me);
    }
  };

  const searchNewSchools = async (query) => {
    setNewSchoolSearch(query);
    setNewSelectedSchool(null);
    setNewTeacherResults([]);
    setNewTeacher("");
    if (query.length < 2) { setNewSchoolResults([]); setShowNewSchoolDropdown(false); return; }
    const { data } = await supabase.from("schools").select("*").ilike("name", `%${query}%`).limit(5);
    setNewSchoolResults(data || []);
    setShowNewSchoolDropdown(true);
  };

  const selectNewSchool = async (school) => {
    setNewSelectedSchool(school);
    setNewSchoolSearch(school.name);
    setShowNewSchoolDropdown(false);
    const { data } = await supabase.from("classrooms").select("teacher_name").eq("school_id", school.id).limit(20);
    const unique = [...new Set((data || []).map(c => c.teacher_name))];
    setNewTeacherResults(unique);
  };

  const newTeacherMismatch = newTeacherResults.length > 0 && newTeacher &&
    !newTeacherResults.find(t => t.toLowerCase() === newTeacher.toLowerCase());

  const saveNewClassroom = async () => {
    setSavingMembership(true);
    setMembershipError("");
    try {
      let school;
      if (newSelectedSchool) {
        school = newSelectedSchool;
      } else {
        const code = newSchoolSearch.toUpperCase().replace(/\s+/g, "").slice(0, 10) + Date.now().toString().slice(-4);
        const { data: newSchool, error: schoolErr } = await supabase.from("schools")
          .insert({ name: newSchoolSearch, activation_code: code }).select().single();
        if (schoolErr) throw schoolErr;
        school = newSchool;
      }

      const currentYear = new Date().getFullYear();
      const schoolYear = `${currentYear}-${currentYear + 1}`;
      let classroom;
      const { data: existingClassroom } = await supabase.from("classrooms").select()
        .eq("school_id", school.id).eq("teacher_name", newTeacher).eq("school_year", schoolYear).maybeSingle();
      if (existingClassroom) {
        classroom = existingClassroom;
      } else {
        const { data: newClassroom, error: classroomErr } = await supabase.from("classrooms")
          .insert({ school_id: school.id, teacher_name: newTeacher, grade: grades.indexOf(newGrade), school_year: schoolYear })
          .select().single();
        if (classroomErr) throw classroomErr;
        classroom = newClassroom;
      }

      const { error: memberErr } = await supabase.from("classroom_members").insert({
        household_id: householdId,
        classroom_id: classroom.id,
        school_year: schoolYear,
      });
      if (memberErr && !memberErr.message.includes("duplicate")) throw memberErr;

      setAddingClassroom(false);
      setNewGrade(""); setNewTeacher("");
      setNewSchoolSearch(""); setNewSelectedSchool(null); setNewTeacherResults([]);
      fetchData();
    } catch (err) { setMembershipError(err.message); }
    setSavingMembership(false);
  };

  const leaveClassroom = async (membershipRow) => {
    const label = `${membershipRow.classrooms?.teacher_name} · ${getGradeLabel(membershipRow.classrooms?.grade)}`;
    if (!window.confirm(`Remove your household from ${label}?`)) return;
    setHouseholdBusy(true);
    try {
      const { error } = await supabase
        .from("classroom_members")
        .delete()
        .eq("id", membershipRow.id);
      if (error) throw error;
      fetchData();
    } catch (err) {
      alert("Error: " + err.message);
    }
    setHouseholdBusy(false);
  };

  const getGradeLabel = (gradeNum) => grades[gradeNum] || "Unknown grade";

  const membershipsBySchool = memberships.reduce((acc, m) => {
    const schoolName = m.classrooms?.schools?.name || "Unknown School";
    const schoolKey = schoolName.toLowerCase().replace(/\s+/g, "-");
    if (!acc[schoolKey]) acc[schoolKey] = { name: schoolName, classrooms: [] };
    acc[schoolKey].classrooms.push(m);
    return acc;
  }, {});

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  const overlay = {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.7)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem"
  };

  const modalBox = {
    background: "#162D50", borderRadius: "16px", padding: "2rem",
    width: "100%", maxWidth: "400px", maxHeight: "90vh", overflowY: "auto"
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  if (showProfile) return <ProfileScreen session={session} onBack={() => setShowProfile(false)} />;
  if (requestingPlaydate) {
    return (
      <PlaydateRequest session={session} recipient={requestingPlaydate}
        onBack={() => setRequestingPlaydate(null)} onSent={() => setRequestingPlaydate(null)} />
    );
  }

  const isPrimary = myRole === "primary";

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0 }}>Huddle</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={onBellClick}
            style={{ background: "transparent", border: "none", cursor: "pointer", position: "relative", padding: "4px 8px", fontSize: "1.3rem" }}>
            🔔
            {notificationCount > 0 && (
              <span style={{
                position: "absolute", top: 0, right: 0,
                background: "#E05A5A", color: "#FFFFFF",
                fontSize: "0.6rem", fontWeight: "700",
                borderRadius: "50%", width: "16px", height: "16px",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                {notificationCount}
              </span>
            )}
          </button>
          <span onClick={() => setShowProfile(true)} style={{ color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer", textDecoration: "underline" }}>
            Hi, {parent?.name?.split(" ")[0]}!
          </span>
          {parent?.photo_url && (
            <img src={parent.photo_url} alt="Profile" onClick={() => setShowProfile(true)}
              style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "2px solid #02C39A" }} />
          )}
        </div>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* YOUR HOUSEHOLD */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>YOUR HOUSEHOLD</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem", overflow: "hidden" }}>
          {householdMembers.map((m, idx) => {
            const isMe = m.parent_id === session.user.id;
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1rem", borderBottom: idx < householdMembers.length - 1 ? "1px solid #2A4A6B" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                    {m.parents?.photo_url ? (
                      <img src={m.parents.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : m.parents?.name?.charAt(0) || "?"}
                  </div>
                  <div>
                    <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 2px" }}>
                      {isMe ? "You" : shortName(m.parents?.name)}
                      {m.role === "primary" && <span style={{ color: "#02C39A", fontSize: "0.7rem", marginLeft: "8px" }}>PRIMARY</span>}
                    </p>
                    <p style={{ color: "#607080", fontSize: "0.75rem", margin: 0 }}>{m.role === "primary" ? "Primary parent" : "Co-parent"}</p>
                  </div>
                </div>
                {isMe ? (
                  householdMembers.length > 1 ? (
                    <button onClick={confirmLeave} disabled={householdBusy}
                      style={{ background: "transparent", border: "1px solid #F87171", color: "#F87171", padding: "0.4rem 0.75rem", borderRadius: "8px", fontSize: "0.75rem", cursor: "pointer" }}>
                      Leave
                    </button>
                  ) : <div style={{ width: "60px" }} />
                ) : isPrimary ? (
                  <button onClick={() => confirmRemoveOther(m)} disabled={householdBusy}
                    style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", padding: "0.4rem 0.75rem", borderRadius: "8px", fontSize: "0.75rem", cursor: "pointer" }}>
                    Remove
                  </button>
                ) : <div style={{ width: "60px" }} />}
              </div>
            );
          })}
          <div onClick={() => { setFindingMember(true); setLinkMessage(""); setMemberSearch(""); setMemberCandidates([]); }}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", cursor: "pointer", borderTop: "1px dashed #2A4A6B" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "1px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", color: "#607080", fontSize: "1rem" }}>+</div>
            <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Find a household member</p>
          </div>
        </div>

        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 1rem", letterSpacing: "0.05em" }}>YOUR CLASSROOMS</p>

        {Object.entries(membershipsBySchool).map(([schoolKey, school]) => (
          <div key={schoolKey} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", background: "#1A3A5C", borderRadius: "10px 10px 0 0", borderBottom: "2px solid #02C39A" }}>
              <span style={{ fontSize: "1.2rem" }}>🏫</span>
              <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "600", margin: 0 }}>{school.name}</p>
            </div>
            <div style={{ background: "#162D50", borderRadius: "0 0 12px 12px", border: "1px solid #2A4A6B", borderTop: "none", overflow: "hidden" }}>
              {school.classrooms.map((m, idx) => {
                const otherFamilies = classmates[m.id] || [];
                return (
                  <div key={m.id} style={{ borderBottom: idx < school.classrooms.length - 1 ? "1px solid #2A4A6B" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "0.75rem 1rem", background: "#0F2A45" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "1rem" }}>📚</span>
                        <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0, fontWeight: "500" }}>
                          {m.classrooms?.teacher_name} · {getGradeLabel(m.classrooms?.grade)}
                        </p>
                      </div>
                      <button onClick={() => leaveClassroom(m)} disabled={householdBusy}
                        style={{ background: "transparent", border: "none", color: "#607080", fontSize: "0.75rem", cursor: "pointer", padding: "2px 6px" }}>
                        Remove
                      </button>
                    </div>
                    <div style={{ padding: "0.75rem 1rem" }}>
                      <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.5rem" }}>
                        {otherFamilies.length} other {otherFamilies.length === 1 ? "family" : "families"} in this class
                      </p>
                      {otherFamilies.length === 0 && (
                        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0, fontStyle: "italic" }}>
                          Share Huddle with other parents to get started!
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              <div onClick={() => setAddingClassroom(true)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", cursor: "pointer", borderTop: "1px dashed #2A4A6B" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "1px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", color: "#607080", fontSize: "1rem" }}>+</div>
                <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Add another classroom</p>
              </div>
            </div>
          </div>
        ))}

        {memberships.length === 0 && (
          <div onClick={() => setAddingClassroom(true)} style={{ background: "#162D50", borderRadius: "12px", padding: "1.5rem", border: "1px dashed #2A4A6B", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", gap: "8px", marginBottom: "1.5rem" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "50%", border: "2px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", color: "#2A4A6B" }}>+</div>
            <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Add your first classroom</p>
          </div>
        )}

        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1rem 0 0.75rem", letterSpacing: "0.05em" }}>PARENTS IN YOUR CLASSROOMS</p>

        {Object.values(classmates).flat().length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>👋</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No other parents yet</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Share Huddle to get other families to join!</p>
          </div>
        ) : (
          Object.values(classmates).flat().map((cm) => {
            const household = cm.households;
            const members = household?.household_members || [];
            return members.map((hm) => (
              <div key={`${cm.id}-${hm.parent_id}`} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0, overflow: "hidden" }}>
                    {hm.parents?.photo_url ? (
                      <img src={hm.parents.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : hm.parents?.name?.charAt(0) || "?"}
                  </div>
                  <div>
                    <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(hm.parents?.name)}</p>
                    <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Parent in this classroom</p>
                  </div>
                </div>
                <button onClick={() => setRequestingPlaydate(hm.parents)}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                  Huddle →
                </button>
              </div>
            ));
          })
        )}
      </div>

      {/* Find a household member modal */}
      {findingMember && (
        <div style={overlay}>
          <div style={modalBox}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Find a household member</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
              Search for a parent already in Huddle who shares a classroom with you. They'll approve from their notifications, then you'll share a household.
            </p>

            <input type="text" placeholder="Search by name..." value={memberSearch}
              onChange={(e) => runMemberSearch(e.target.value)} style={inputStyle} />

            {linkMessage && (
              <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "8px", padding: "0.6rem 0.85rem", marginBottom: "1rem" }}>
                <p style={{ color: "#02C39A", fontSize: "0.8rem", margin: 0 }}>{linkMessage}</p>
              </div>
            )}

            {memberCandidates.map((c) => (
              <div key={c.parentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0F2A45", borderRadius: "10px", padding: "0.6rem 0.85rem", marginBottom: "8px", border: "1px solid #2A4A6B" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                    {c.photo_url ? <img src={c.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : c.name?.charAt(0) || "?"}
                  </div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>{shortName(c.name)}</p>
                </div>
                <button onClick={() => askToLink(c)} disabled={linkBusy}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.4rem 0.75rem", borderRadius: "8px", fontSize: "0.8rem", fontWeight: "600", cursor: "pointer" }}>
                  Ask to link
                </button>
              </div>
            ))}

            {memberSearch.trim().length >= 2 && memberCandidates.length === 0 && !linkMessage && (
              <p style={{ color: "#607080", fontSize: "0.85rem", margin: "0 0 1rem" }}>No matching parents in your classrooms.</p>
            )}

            <button onClick={() => setFindingMember(false)}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer", marginTop: "0.5rem" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Add classroom modal */}
      {addingClassroom && (
        <div style={overlay}>
          <div style={modalBox}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>Add a classroom</h2>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)} style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text" placeholder="Start typing school name..." value={newSchoolSearch}
                onChange={(e) => searchNewSchools(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
              {showNewSchoolDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10 }}>
                  {newSchoolResults.map(school => (
                    <div key={school.id} onClick={() => selectNewSchool(school)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      🏫 {school.name}
                    </div>
                  ))}
                  <div onClick={() => { setNewSelectedSchool(null); setShowNewSchoolDropdown(false); }}
                    style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem" }}>
                    + Add "{newSchoolSearch}" as a new school
                  </div>
                </div>
              )}
            </div>

            {newSelectedSchool && (
              <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
                <span style={{ color: "#02C39A", fontSize: "0.85rem" }}>✓ {newSelectedSchool.name}</span>
              </div>
            )}

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text"
                placeholder={newTeacherResults.length > 0 ? "Select or type teacher name..." : "Mrs. Johnson"}
                value={newTeacher}
                onChange={(e) => { setNewTeacher(e.target.value); setShowNewTeacherDropdown(e.target.value.length > 0); }}
                onFocus={() => { if (newTeacherResults.length > 0) setShowNewTeacherDropdown(true); }}
                style={{ ...inputStyle, marginBottom: 0, borderColor: newTeacherMismatch ? "#854F0B" : "#2A4A6B" }} />
              {showNewTeacherDropdown && newTeacherResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
                  {newTeacherResults.filter(t => t.toLowerCase().includes(newTeacher.toLowerCase())).map(teacher => (
                    <div key={teacher} onClick={() => { setNewTeacher(teacher); setShowNewTeacherDropdown(false); }}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      📚 {teacher}
                    </div>
                  ))}
                  {newTeacherMismatch && (
                    <div onClick={() => setShowNewTeacherDropdown(false)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem", borderTop: "1px solid #2A4A6B" }}>
                      + Add "{newTeacher}" as a new teacher
                    </div>
                  )}
                </div>
              )}
            </div>

            {newTeacherMismatch && (
              <div style={{ background: "#3D1F0A", border: "1px solid #854F0B", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem", marginTop: "-0.5rem" }}>
                <p style={{ color: "#F59E0B", fontSize: "0.8rem", margin: 0 }}>
                  ⚠️ This teacher isn't in our system yet. Double-check spelling or select from the list above.
                </p>
              </div>
            )}

            {membershipError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{membershipError}</p>}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setAddingClassroom(false)} style={{ flex: 1, padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={saveNewClassroom} disabled={!newGrade || !newSchoolSearch || !newTeacher || savingMembership}
                style={{ flex: 2, padding: "0.85rem", borderRadius: "10px", border: "none", background: (!newGrade || !newSchoolSearch || !newTeacher) ? "#2A4A6B" : "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
                {savingMembership ? "Saving..." : "Add classroom →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}```

---

## File: src/ProfileScreen.jsx

```jsx
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./supabase";
import { TERMS_OF_SERVICE, PRIVACY_POLICY, TERMS_VERSION, PRIVACY_VERSION } from "./legal";

export default function ProfileScreen({ session, onBack }) {
  const [parent, setParent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [consents, setConsents] = useState([]);
  const [view, setView] = useState("main");

  useEffect(() => {
    fetchProfile();
    fetchConsents();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("parents")
      .select("*")
      .eq("id", session.user.id)
      .single();
    setParent(data);
    setNewName(data?.name || "");
    setLoading(false);
  };

  const fetchConsents = async () => {
    const { data } = await supabase
      .from("parent_consents")
      .select("*")
      .eq("parent_id", session.user.id)
      .order("consented_at", { ascending: false });
    setConsents(data || []);
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `${session.user.id}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("parents").update({ photo_url: cacheBustedUrl }).eq("id", session.user.id);
      setMessage("Photo updated!");
      fetchProfile();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setUploading(false);
  };

  const saveName = async () => {
    await supabase.from("parents").update({ name: newName }).eq("id", session.user.id);
    setEditing(false);
    setMessage("Name updated!");
    fetchProfile();
    setTimeout(() => setMessage(""), 3000);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const tosConsent = consents.find(c => c.document_type === "terms_of_service");
  const privacyConsent = consents.find(c => c.document_type === "privacy_policy");

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
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Profile</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "2rem" }}>
          <div onClick={() => document.getElementById("photo-upload").click()}
            style={{ width: "120px", height: "120px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", fontWeight: "600", color: "#FFFFFF", cursor: "pointer", overflow: "hidden", border: "3px solid #02C39A", position: "relative", marginBottom: "0.75rem" }}>
            {parent?.photo_url ? (
              <img src={parent.photo_url} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              parent?.name?.charAt(0) || "?"
            )}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", padding: "4px 0", textAlign: "center", fontSize: "0.65rem", color: "#FFFFFF" }}>
              {uploading ? "Uploading..." : "Tap to change"}
            </div>
          </div>
          <input id="photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={uploadPhoto} />

          {editing ? (
            <div style={{ width: "100%", maxWidth: "300px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "1rem", textAlign: "center", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                <button onClick={() => { setEditing(false); setNewName(parent?.name || ""); }}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer" }}>
                  Cancel
                </button>
                <button onClick={saveName}
                  style={{ flex: 2, padding: "0.5rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <p style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: 0 }}>{parent?.name}</p>
              <button onClick={() => setEditing(true)}
                style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.7rem", cursor: "pointer" }}>
                Edit
              </button>
            </div>
          )}
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 4px", letterSpacing: "0.05em" }}>EMAIL</p>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>{session.user.email}</p>
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 4px", letterSpacing: "0.05em" }}>MEMBER SINCE</p>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>
              {new Date(parent?.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          </div>
        </div>

        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 0.75rem", letterSpacing: "0.05em" }}>LEGAL</p>

        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem" }}>
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
          style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #F87171", background: "transparent", color: "#F87171", fontSize: "1rem", cursor: "pointer", marginTop: "1rem" }}>
          Sign out
        </button>
      </div>
    </div>
  );
}```

---

## File: src/NavBar.jsx

```jsx
export default function NavBar(props) {
  const active = props.active;
  const onNavigate = props.onNavigate;
  const badges = props.badges || {};
  const halos = props.halos || {};

  const tabs = [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "search", label: "Search", icon: "🔍" },
    { id: "network", label: "Network", icon: "🤝" },
    { id: "playdates", label: "Playdates", icon: "📅" },
    { id: "profile", label: "Profile", icon: "👤" },
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
              <span style={{ position: "relative", zIndex: 1 }}>{tab.icon}</span>
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
}```

---

## File: src/Search.jsx

```jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Search({ session }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mySchoolIds, setMySchoolIds] = useState([]);
  const [myHouseholdId, setMyHouseholdId] = useState(null);
  const [connections, setConnections] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchMyData();
  }, []);

  // Privacy-safe short name: "Nick Psaros" -> "Nick P."
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const fetchMyData = async () => {
    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .single();

    if (!hm) return;
    setMyHouseholdId(hm.household_id);

    const { data: memberships } = await supabase
      .from("classroom_members")
      .select("classrooms(school_id)")
      .eq("household_id", hm.household_id);

    const schoolIds = [...new Set((memberships || []).map(m => m.classrooms?.school_id).filter(Boolean))];
    setMySchoolIds(schoolIds);

    const { data: conns } = await supabase
      .from("connections")
      .select("*")
      .or(`requester_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`);
    setConnections(conns || []);
  };

  const search = async (q) => {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);

    const { data: parents } = await supabase
      .from("parents")
      .select("*")
      .ilike("name", "%" + q + "%")
      .neq("id", session.user.id)
      .limit(20);

    if (!parents || parents.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    const enriched = [];
    for (const parent of parents) {
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", parent.id)
        .single();
      if (!hm) continue;

      const { data: memberships } = await supabase
        .from("classroom_members")
        .select("classrooms(teacher_name, grade, schools(id, name))")
        .eq("household_id", hm.household_id);

      const sharedClassrooms = (memberships || []).filter(m =>
        mySchoolIds.includes(m.classrooms?.schools?.id)
      );

      if (sharedClassrooms.length > 0) {
        enriched.push({
          ...parent,
          classrooms: sharedClassrooms,
        });
      }
    }

    setResults(enriched);
    setLoading(false);
  };

  const getConnectionStatus = (parentId) => {
    const conn = connections.find(c =>
      (c.requester_id === session.user.id && c.recipient_id === parentId) ||
      (c.recipient_id === session.user.id && c.requester_id === parentId)
    );
    if (!conn) return null;
    return {
      status: conn.status,
      isRequester: conn.requester_id === session.user.id
    };
  };

  const sendRequest = async (recipientId) => {
    const { error } = await supabase.from("connections").insert({
      requester_id: session.user.id,
      recipient_id: recipientId,
      status: "pending"
    });
    if (!error) {
      setMessage("Connection request sent!");
      fetchMyData();
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const acceptRequest = async (requesterId) => {
    await supabase.from("connections")
      .update({ status: "accepted" })
      .eq("requester_id", requesterId)
      .eq("recipient_id", session.user.id);
    fetchMyData();
    setMessage("Connection accepted!");
    setTimeout(() => setMessage(""), 3000);
  };

  const grades = ["K","1st","2nd","3rd","4th","5th","6th"];

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: "0 0 1rem" }}>Find Parents</h1>
        <input
          type="text"
          placeholder="Search by parent name..."
          value={query}
          onChange={(e) => search(e.target.value)}
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            borderRadius: "10px",
            border: "1px solid #2A4A6B",
            background: "#0F2044",
            color: "#FFFFFF",
            fontSize: "1rem",
            boxSizing: "border-box"
          }}
        />
      </div>

      <div style={{ padding: "1rem 1.5rem", maxWidth: "600px", margin: "0 auto"}}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {loading && (
          <p style={{ color: "#607080", fontSize: "0.9rem", textAlign: "center", padding: "2rem" }}>Searching...</p>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>🔍</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>No parents found</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Try searching by a different name</p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>👋</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>Find parents at your school</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Type a name to search</p>
          </div>
        )}

        {results.map((parent) => {
          const conn = getConnectionStatus(parent.id);
          const classroomLabel = (parent.classrooms || []).map(c =>
            `${c.classrooms?.teacher_name} (${grades[c.classrooms?.grade] || "?"})`
          ).join(", ");

          return (
            <div key={parent.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent:"center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                  {parent.photo_url ? (
                    <img src={parent.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    parent.name ? parent.name.charAt(0) : "?"
                  )}
                </div>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(parent.name)}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>{classroomLabel || "Same school"}</p>
                </div>
              </div>

              {!conn && (
                <button
                  onClick={() => sendRequest(parent.id)}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
                  Connect
                </button>
              )}
              {conn && conn.status === "pending" && conn.isRequester && (
                <span style={{ color: "#607080", fontSize: "0.8rem", flexShrink: 0 }}>Pending...</span>
              )}
              {conn && conn.status === "pending" && !conn.isRequester && (
                <button
                  onClick={() => acceptRequest(parent.id)}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
                  Accept
                </button>
              )}
              {conn && conn.status === "accepted" && (
                <span style={{ color: "#02C39A", fontSize: "0.8rem", flexShrink: 0 }}>✓ Connected</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}```

---

## File: src/Network.jsx

```jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Network({ session }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    setLoading(true);
    const userId = session.user.id;

    // Get all accepted connections where user is either requester or recipient
    const { data } = await supabase
      .from("connections")
      .select(`
        *,
        requester:parents!connections_requester_id_fkey(*),
        recipient:parents!connections_recipient_id_fkey(*)
      `)
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq("status", "accepted");

    // Map each connection to "the other person"
    const network = (data || []).map(conn => {
      const isRequester = conn.requester_id === userId;
      return {
        connectionId: conn.id,
        person: isRequester ? conn.recipient : conn.requester,
        connectedSince: conn.created_at,
      };
    });

    // For each connection, find their household and classrooms
    for (const conn of network) {
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", conn.person.id)
        .single();

      if (hm) {
        const { data: memberships } = await supabase
          .from("classroom_members")
          .select("*, classrooms(teacher_name, grade, schools(name))")
          .eq("household_id", hm.household_id);
        conn.classrooms = memberships || [];

        // Also get other household members (co-parents)
        const { data: coParents } = await supabase
          .from("household_members")
          .select("parents(id, name, photo_url)")
          .eq("household_id", hm.household_id)
          .neq("parent_id", conn.person.id);
        conn.coParents = (coParents || []).map(c => c.parents).filter(Boolean);
      } else {
        conn.classrooms = [];
        conn.coParents = [];
      }
    }

    setConnections(network);
    setLoading(false);
  };

  const removeConnection = async (connectionId) => {
    if (!window.confirm("Remove this connection?")) return;
    await supabase.from("connections").delete().eq("id", connectionId);
    fetchConnections();
  };

  const grades = ["K","1st","2nd","3rd","4th","5th","6th"];

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Your Network</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "4px 0 0" }}>
          {connections.length} {connections.length === 1 ? "connection" : "connections"}
        </p>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : connections.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🤝</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No connections yet</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Use Search to find other parents at your school</p>
          </div>
        ) : (
          connections.map((conn) => (
            <div key={conn.connectionId} style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "12px", border: "1px solid #2A4A6B" }}>

              {/* Primary person */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                  {conn.person?.photo_url ? (
                    <img src={conn.person.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    conn.person?.name?.charAt(0) || "?"
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>{conn.person?.name}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Connected</p>
                </div>
                <button onClick={() => removeConnection(conn.connectionId)}
                  style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", padding: "0.4rem 0.75rem", borderRadius: "8px", fontSize: "0.75rem", cursor: "pointer" }}>
                  Remove
                </button>
              </div>

              {/* Co-parents in their household */}
              {conn.coParents.length > 0 && (
                <div style={{ background: "#0F2A45", borderRadius: "10px", padding: "0.75rem 1rem", border: "1px solid #2A4A6B", marginBottom: conn.classrooms.length > 0 ? "0.5rem" : 0 }}>
                  <p style={{ color: "#8AAEC8", fontSize: "0.7rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>CO-PARENTS</p>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {conn.coParents.map((cp) => (
                      <div key={cp.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", overflow: "hidden", border: "2px solid #02C39A" }}>
                          {cp.photo_url ? (
                            <img src={cp.photo_url} alt={cp.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : <span style={{ color: "#FFFFFF" }}>{cp.name?.charAt(0) || "?"}</span>}
                        </div>
                        <p style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: 0 }}>{cp.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Classrooms */}
              {conn.classrooms.length > 0 && (
                <div style={{ background: "#0F2A45", borderRadius: "10px", padding: "0.75rem 1rem", border: "1px solid #2A4A6B" }}>
                  <p style={{ color: "#8AAEC8", fontSize: "0.7rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>CLASSROOMS</p>
                  {conn.classrooms.map((c, idx) => (
                    <p key={idx} style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: idx > 0 ? "4px 0 0" : 0 }}>
                      🏫 {c.classrooms?.schools?.name} · {c.classrooms?.teacher_name} · {grades[c.classrooms?.grade] || "?"}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}```

---

## File: src/Inbox.jsx

```jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Inbox({ session, onBack }) {
  const [connectionRequests, setConnectionRequests] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchRequests(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const fetchRequests = async () => {
    setLoading(true);

    const { data: conns } = await supabase
      .from("connections")
      .select("*, requester:parents!connections_requester_id_fkey(*)")
      .eq("recipient_id", session.user.id)
      .eq("status", "pending");
    setConnectionRequests(conns || []);

    const { data: myHh } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .maybeSingle();

    if (myHh) {
      const { data: joins } = await supabase
        .from("household_join_requests")
        .select("*, requester:parents!household_join_requests_requesting_parent_id_fkey(id, name, photo_url)")
        .eq("target_household_id", myHh.household_id)
        .eq("status", "pending");
      setJoinRequests(joins || []);
    } else {
      setJoinRequests([]);
    }

    setLoading(false);
  };

  const accept = async (connectionId) => {
    await supabase.from("connections")
      .update({ status: "accepted" })
      .eq("id", connectionId);
    setMessage("Connection accepted!");
    fetchRequests();
    setTimeout(() => setMessage(""), 3000);
  };

  const decline = async (connectionId) => {
    await supabase.from("connections")
      .delete()
      .eq("id", connectionId);
    setMessage("Request declined");
    fetchRequests();
    setTimeout(() => setMessage(""), 3000);
  };

  const approveJoin = async (req) => {
    setMessage("");
    try {
      const requesterId = req.requesting_parent_id;

      // 1. My (approver's) household — the destination.
      const { data: myHh, error: hhErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .single();
      if (hhErr) throw hhErr;
      const destHouseholdId = myHh.household_id;

      // 2. Requester's current household + their role there.
      const { data: theirMembership } = await supabase
        .from("household_members")
        .select("id, household_id, role")
        .eq("parent_id", requesterId)
        .maybeSingle();

      const oldHouseholdId = theirMembership?.household_id || null;

      // Guard: if they're somehow already in my household, just mark approved.
      if (oldHouseholdId === destHouseholdId) {
        await supabase.from("household_join_requests")
          .update({ status: "approved", resolved_at: new Date().toISOString() })
          .eq("id", req.id);
        setMessage(`${shortName(req.requester?.name)} is already in your household.`);
        fetchRequests();
        return;
      }

      // 3. Move the requester's old household's classroom memberships into mine
      //    (union — skip any my household already has).
      if (oldHouseholdId) {
        const { data: oldCms } = await supabase
          .from("classroom_members")
          .select("classroom_id, school_year")
          .eq("household_id", oldHouseholdId);

        const { data: myCms } = await supabase
          .from("classroom_members")
          .select("classroom_id")
          .eq("household_id", destHouseholdId);
        const haveClassroom = new Set((myCms || []).map((c) => c.classroom_id));

        for (const c of (oldCms || [])) {
          if (!haveClassroom.has(c.classroom_id)) {
            await supabase.from("classroom_members").insert({
              household_id: destHouseholdId,
              classroom_id: c.classroom_id,
              school_year: c.school_year,
            });
            haveClassroom.add(c.classroom_id);
          }
        }
      }

      // 4. Remove the requester from their old household.
      if (theirMembership) {
        await supabase.from("household_members").delete().eq("id", theirMembership.id);

        // 5. Clean up their old household: delete if empty, else promote if needed.
        const { data: remaining } = await supabase
          .from("household_members")
          .select("id, role, joined_at")
          .eq("household_id", oldHouseholdId)
          .order("joined_at", { ascending: true });

        if (!remaining || remaining.length === 0) {
          await supabase.from("classroom_members").delete().eq("household_id", oldHouseholdId);
          await supabase.from("households").delete().eq("id", oldHouseholdId);
        } else if (theirMembership.role === "primary" && !remaining.some((m) => m.role === "primary")) {
          await supabase.from("household_members")
            .update({ role: "primary" })
            .eq("id", remaining[0].id);
        }
      }

      // 6. Add the requester to my household as co-parent.
      const { error: memberErr } = await supabase
        .from("household_members")
        .insert({
          household_id: destHouseholdId,
          parent_id: requesterId,
          role: "co_parent",
        });
      if (memberErr && !memberErr.message.includes("duplicate")) throw memberErr;

      // 7. Mark the request approved.
      await supabase.from("household_join_requests")
        .update({ status: "approved", resolved_at: new Date().toISOString() })
        .eq("id", req.id);

      setMessage(`${shortName(req.requester?.name)} is now part of your household!`);
      fetchRequests();
      setTimeout(() => setMessage(""), 4000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
  };

  const declineJoin = async (req) => {
    await supabase
      .from("household_join_requests")
      .update({ status: "declined", resolved_at: new Date().toISOString() })
      .eq("id", req.id);
    setMessage("Link request declined");
    fetchRequests();
    setTimeout(() => setMessage(""), 3000);
  };

  const nothingPending = connectionRequests.length === 0 && joinRequests.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Notifications</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : nothingPending ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🔔</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No new notifications</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>You're all caught up!</p>
          </div>
        ) : (
          <>
            {joinRequests.length > 0 && (
              <>
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>HOUSEHOLD LINK REQUESTS</p>
                {joinRequests.map((req) => (
                  <div key={req.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                        {req.requester?.photo_url ? (
                          <img src={req.requester.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          req.requester?.name?.charAt(0) || "?"
                        )}
                      </div>
                      <div>
                        <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(req.requester?.name)}</p>
                        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>wants to join your household</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => declineJoin(req)} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
                        Decline
                      </button>
                      <button onClick={() => approveJoin(req)} style={{ flex: 2, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer" }}>
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {connectionRequests.length > 0 && (
              <>
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: joinRequests.length > 0 ? "1.5rem 0 0.75rem" : "0 0 0.75rem", letterSpacing: "0.05em" }}>CONNECTION REQUESTS</p>
                {connectionRequests.map((req) => (
                  <div key={req.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                        {req.requester?.photo_url ? (
                          <img src={req.requester.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          req.requester?.name?.charAt(0) || "?"
                        )}
                      </div>
                      <div>
                        <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(req.requester?.name)}</p>
                        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>wants to connect with you</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => decline(req.id)} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
                        Decline
                      </button>
                      <button onClick={() => accept(req.id)} style={{ flex: 2, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer" }}>
                        Accept
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}```

---

## File: src/Playdates.jsx

```jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Playdates({ session, onChanged }) {
  const [householdId, setHouseholdId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A family";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const householdLabel = async (hhId) => {
    const { data } = await supabase
      .from("household_members")
      .select("parents(name)")
      .eq("household_id", hhId);
    const names = (data || []).map((m) => m.parents?.name).filter(Boolean);
    if (names.length === 0) return "A family";
    return names.map(shortName).join(" & ");
  };

  const householdInitial = async (hhId) => {
    const { data } = await supabase
      .from("household_members")
      .select("parents(name)")
      .eq("household_id", hhId)
      .limit(1);
    const nm = data?.[0]?.parents?.name;
    return nm ? nm.charAt(0).toUpperCase() : "?";
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const fetchData = async () => {
    setLoading(true);

    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .maybeSingle();

    if (!hm) { setLoading(false); return; }
    const hhId = hm.household_id;
    setHouseholdId(hhId);

    const all = [];

    const { data: hosting } = await supabase
      .from("playdates")
      .select("*")
      .eq("organizer_household_id", hhId);

    for (const pd of (hosting || [])) {
      const { data: invites } = await supabase
        .from("playdate_invites")
        .select("*")
        .eq("playdate_id", pd.id);
      const roster = [];
      for (const inv of (invites || [])) {
        roster.push({
          ...inv,
          label: await householdLabel(inv.household_id),
          initial: await householdInitial(inv.household_id),
        });
      }
      all.push({
        kind: "hosting",
        playdate: pd,
        roster,
        goingCount: roster.filter((r) => r.rsvp === "yes").length,
      });
    }

    const { data: myInvites } = await supabase
      .from("playdate_invites")
      .select("*, playdates(*)")
      .eq("household_id", hhId);

    for (const inv of (myInvites || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.organizer_household_id === hhId) continue;
      const organizerLabel = await householdLabel(pd.organizer_household_id);
      all.push({ kind: "invited", playdate: pd, invite: inv, organizerLabel });
    }

    setItems(all);
    setLoading(false);
  };

  const respond = async (inviteId, rsvp) => {
    setBusy(true);
    try {
      await supabase
        .from("playdate_invites")
        .update({ rsvp, responded_at: new Date().toISOString() })
        .eq("id", inviteId);
      setMessage(rsvp === "yes" ? "You're going!" : rsvp === "maybe" ? "Marked as maybe" : "Can't make it");
      await fetchData();
      if (typeof onChanged === "function") onChanged();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBusy(false);
  };

  // Remove a dead hosted playdate (all guests declined). Deletes invites + playdate.
  const removeDeadPlaydate = async (playdateId) => {
    if (!window.confirm("Remove this playdate? Everyone declined, so it'll be deleted.")) return;
    setBusy(true);
    try {
      await supabase.from("playdate_invites").delete().eq("playdate_id", playdateId);
      await supabase.from("playdates").delete().eq("id", playdateId);
      setMessage("Playdate removed");
      await fetchData();
      if (typeof onChanged === "function") onChanged();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBusy(false);
  };

  const rsvpColor = (rsvp) =>
    rsvp === "yes" ? "#02C39A" : rsvp === "maybe" ? "#F59E0B" : rsvp === "no" ? "#F87171" : "#607080";
  const rsvpLabel = (rsvp) =>
    rsvp === "yes" ? "Going" : rsvp === "maybe" ? "Maybe" : rsvp === "no" ? "Declined" : "Invited";

  const hostBadge = (roster, dim) => {
    if (dim) return { text: "Hosted", bg: "#1A3A5C", color: "#8AAEC8" };
    if (!roster || roster.length === 0) return { text: "No guests yet", bg: "#1A3A5C", color: "#8AAEC8" };
    const going = roster.filter((r) => r.rsvp === "yes").length;
    if (going > 0) return { text: `${going} going`, bg: "#0F3D2E", color: "#02C39A" };
    const anyOpen = roster.some((r) => r.rsvp === "invited" || r.rsvp === "maybe");
    if (anyOpen) return { text: "Pending", bg: "#1A3A5C", color: "#8AAEC8" };
    return { text: "Declined", bg: "#3D1515", color: "#F87171" };
  };

  // A hosted playdate is "dead" if it has guests and ALL of them declined.
  const isDead = (roster) =>
    roster && roster.length > 0 && roster.every((r) => r.rsvp === "no");

  const now = Date.now();
  const isPast = (it) => new Date(it.playdate.proposed_date).getTime() < now;

  const visible = items.filter((it) => !(it.kind === "invited" && it.invite.rsvp === "no"));

  const needsAttention = visible
    .filter((it) => !isPast(it) && it.kind === "invited" && it.invite.rsvp === "invited")
    .sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));

  const upcoming = visible
    .filter((it) => !isPast(it) && !(it.kind === "invited" && it.invite.rsvp === "invited"))
    .sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));

  const past = visible
    .filter((it) => isPast(it))
    .sort((a, b) => new Date(b.playdate.proposed_date) - new Date(a.playdate.proposed_date));

  const card = (dim) => ({
    background: dim ? "#13233F" : "#162D50",
    borderRadius: "12px",
    padding: "1.1rem 1.25rem",
    marginBottom: "12px",
    border: "1px solid #2A4A6B",
    opacity: dim ? 0.6 : 1,
  });
  const sectionLabel = { color: "#8AAEC8", fontSize: "0.8rem", letterSpacing: "0.05em", margin: "0 0 0.75rem" };
  const metaRow = { color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 4px" };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  const nothing = needsAttention.length === 0 && upcoming.length === 0 && past.length === 0;

  const renderCard = (it, dim) => {
    const pd = it.playdate;
    if (it.kind === "invited") {
      const needsReply = it.invite.rsvp === "invited";
      return (
        <div key={`inv-${it.invite.id}`} style={card(dim)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: 0 }}>{it.organizerLabel} invited you</p>
            {!dim && needsReply ? (
              <span style={{ fontSize: "0.65rem", background: "#3D1F0A", color: "#F59E0B", padding: "3px 9px", borderRadius: "8px", whiteSpace: "nowrap", border: "1px solid #854F0B" }}>Needs reply</span>
            ) : (
              <span style={{ fontSize: "0.7rem", color: rsvpColor(it.invite.rsvp), fontWeight: "600", whiteSpace: "nowrap" }}>{rsvpLabel(it.invite.rsvp)}</span>
            )}
          </div>
          <p style={{ ...metaRow, color: dim ? "#8AAEC8" : "#02C39A" }}>📅 {fmtDate(pd.proposed_date)}</p>
          <p style={metaRow}>📍 {pd.location_name}{pd.location_address ? ` — ${pd.location_address}` : ""}</p>
          {pd.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "0.5rem 0 0", fontStyle: "italic" }}>"{pd.note}"</p>}

          {!dim && (
            <div style={{ display: "flex", gap: "8px", marginTop: "1rem" }}>
              <button onClick={() => respond(it.invite.id, "yes")} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "none", background: it.invite.rsvp === "yes" ? "#02C39A" : "#0F3D2E", color: it.invite.rsvp === "yes" ? "#0F2044" : "#02C39A", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                Going
              </button>
              <button onClick={() => respond(it.invite.id, "maybe")} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #854F0B", background: it.invite.rsvp === "maybe" ? "#854F0B" : "transparent", color: "#F59E0B", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                Maybe
              </button>
              <button onClick={() => respond(it.invite.id, "no")} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#F87171", fontSize: "0.85rem", cursor: "pointer" }}>
                Can't go
              </button>
            </div>
          )}
        </div>
      );
    }

    // hosting card
    const badge = hostBadge(it.roster, dim);
    const dead = !dim && isDead(it.roster);
    return (
      <div key={`host-${pd.id}`} style={card(dim)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <p style={{ color: dim ? "#8AAEC8" : "#02C39A", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>📅 {fmtDate(pd.proposed_date)}</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>📍 {pd.location_name}{pd.location_address ? ` — ${pd.location_address}` : ""}</p>
          </div>
          <span style={{ fontSize: "0.65rem", background: badge.bg, color: badge.color, padding: "3px 9px", borderRadius: "8px", whiteSpace: "nowrap" }}>
            {badge.text}
          </span>
        </div>

        {pd.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "6px 0 12px", fontStyle: "italic" }}>"{pd.note}"</p>}

        <div style={{ borderTop: "1px solid #2A4A6B", paddingTop: "0.75rem", marginTop: pd.note ? 0 : "0.75rem" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.7rem", letterSpacing: "0.05em", margin: "0 0 0.6rem" }}>GUEST LIST</p>
          {it.roster.length === 0 && (
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0, fontStyle: "italic" }}>No families invited yet.</p>
          )}
          {it.roster.map((inv) => (
            <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0 }}>
                  {inv.initial}
                </div>
                <span style={{ color: "#FFFFFF", fontSize: "0.85rem" }}>{inv.label}</span>
              </div>
              <span style={{ color: rsvpColor(inv.rsvp), fontSize: "0.8rem", fontWeight: "500" }}>{rsvpLabel(inv.rsvp)}</span>
            </div>
          ))}
        </div>

        {dead && (
          <button onClick={() => removeDeadPlaydate(pd.id)} disabled={busy}
            style={{ width: "100%", marginTop: "0.85rem", padding: "0.6rem", borderRadius: "8px", border: "1px solid #F87171", background: "transparent", color: "#F87171", fontSize: "0.85rem", cursor: "pointer" }}>
            Remove playdate
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Playdates</h1>
        {(needsAttention.length + upcoming.length) > 0 && (
          <span style={{ color: "#607080", fontSize: "0.8rem" }}>{needsAttention.length + upcoming.length} upcoming</span>
        )}
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {nothing && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>📅</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No playdates yet</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Tap "Huddle →" next to a parent on your Home screen to set one up.</p>
          </div>
        )}

        {needsAttention.length > 0 && (
          <>
            <p style={sectionLabel}>NEEDS YOUR REPLY</p>
            {needsAttention.map((it) => renderCard(it, false))}
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <p style={{ ...sectionLabel, marginTop: needsAttention.length > 0 ? "1.5rem" : 0 }}>UPCOMING</p>
            {upcoming.map((it) => renderCard(it, false))}
          </>
        )}

        {past.length > 0 && (
          <>
            <p style={{ ...sectionLabel, marginTop: (needsAttention.length + upcoming.length) > 0 ? "1.5rem" : 0, color: "#607080" }}>PAST</p>
            {past.map((it) => renderCard(it, true))}
          </>
        )}
      </div>
    </div>
  );
}```

---

## File: src/PlaydateRequest.jsx

```jsx
import { useState } from "react";
import { supabase } from "./supabase";

export default function PlaydateRequest({ session, recipient, onBack, onSent }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const locations = [
    { name: "Local Park", address: "Nearby park" },
    { name: "School Playground", address: "School grounds" },
    { name: "Community Center", address: "Community center" },
    { name: "Our House", address: "My home" },
    { name: "Their House", address: "Their home" },
    { name: "Custom location", address: "" },
  ];

  const sendRequest = async () => {
    if (!date || !time || !locationName) {
      setError("Please fill in date, time and location");
      return;
    }
    setLoading(true);
    setError("");

    let createdPlaydateId = null;
    try {
      // My household (the organizer).
      const { data: myHm, error: myErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .single();
      if (myErr) throw myErr;

      // The recipient's household (the first invitee).
      const { data: theirHm, error: theirErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", recipient.id)
        .single();
      if (theirErr) throw theirErr;

      if (theirHm.household_id === myHm.household_id) {
        setError("That parent is in your own household.");
        setLoading(false);
        return;
      }

      const proposedDate = new Date(`${date}T${time}`).toISOString();

      // Create the playdate event.
      const { data: playdate, error: pdErr } = await supabase
        .from("playdates")
        .insert({
          organizer_household_id: myHm.household_id,
          organizer_parent_id: session.user.id,
          proposed_date: proposedDate,
          location_name: locationName,
          location_address: locationAddress,
          note: note || null,
          status: "pending",
        })
        .select()
        .single();
      if (pdErr) throw pdErr;
      createdPlaydateId = playdate.id;

      // Invite the recipient's household. If this fails, roll back the playdate.
      const { error: invErr } = await supabase
        .from("playdate_invites")
        .insert({
          playdate_id: playdate.id,
          household_id: theirHm.household_id,
          invited_by_household_id: myHm.household_id,
          rsvp: "invited",
        });
      if (invErr) throw invErr;

      onSent();
    } catch (err) {
      // Roll back an orphaned playdate so we never leave a guest-less event.
      if (createdPlaydateId) {
        await supabase.from("playdates").delete().eq("id", createdPlaydateId);
      }
      setError(err.message);
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  const shortName = (fullName) => {
    if (!fullName) return "this family";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Request a Playdate</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>

        {/* Recipient card */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
            {recipient.photo_url ? (
              <img src={recipient.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              recipient.name?.charAt(0) || "?"
            )}
          </div>
          <div>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(recipient.name)}'s family</p>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Sending a playdate invite</p>
          </div>
        </div>

        {/* Date & Time */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>DATE & TIME</p>
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            style={inputStyle}
          />
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Location */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>LOCATION</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1rem" }}>
            {locations.map((loc) => (
              <button
                key={loc.name}
                onClick={() => { setLocationName(loc.name); setLocationAddress(loc.address); }}
                style={{
                  padding: "0.6rem", borderRadius: "8px", border: "1px solid",
                  borderColor: locationName === loc.name ? "#02C39A" : "#2A4A6B",
                  background: locationName === loc.name ? "#0F3D2E" : "transparent",
                  color: locationName === loc.name ? "#02C39A" : "#8AAEC8",
                  fontSize: "0.8rem", cursor: "pointer", textAlign: "left"
                }}
              >
                {loc.name}
              </button>
            ))}
          </div>
          {locationName === "Custom location" && (
            <>
              <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Location name</label>
              <input type="text" placeholder="e.g. Howarth Park" onChange={(e) => setLocationName(e.target.value)} style={inputStyle} />
              <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Address</label>
              <input type="text" placeholder="Full address" onChange={(e) => setLocationAddress(e.target.value)} style={inputStyle} />
            </>
          )}
        </div>

        {/* Note */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>ADD A NOTE (optional)</p>
          <textarea
            placeholder="e.g. Our kids seem to get along great!"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none", marginBottom: 0 }}
          />
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

        <button
          onClick={sendRequest}
          disabled={loading}
          style={{
            width: "100%", padding: "0.85rem", borderRadius: "10px",
            border: "none", background: loading ? "#028090" : "#02C39A",
            color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Sending..." : "Send playdate invite →"}
        </button>

      </div>
    </div>
  );
}```

---

## File: src/legal.js

```jsx
// Legal documents for Huddle
// When you update these, bump the VERSION number to trigger re-consent.

export const TERMS_VERSION = "1.0.0";
export const PRIVACY_VERSION = "1.0.0";

export const TERMS_OF_SERVICE = `# Terms of Service

**Effective date:** June 14, 2026
**Version:** 1.0.0

These Terms of Service ("Terms") govern your use of Huddle, available at huddlefamilies.com (the "Service"). By using Huddle, you agree to these Terms. If you do not agree, do not use Huddle.

---

## 1. Who can use Huddle

To use Huddle, you must:

- Be at least 18 years old
- Be a parent or legal guardian of a school-aged child
- Provide accurate information about yourself

Huddle is intended **only for adult parents and guardians**. Huddle is not for children. You may not create an account on behalf of a minor or pretend to be a minor.

## 2. Your account

You are responsible for:

- Maintaining the confidentiality of your account
- All activity that happens under your account
- Providing accurate, current information
- Notifying us immediately if you suspect unauthorized use

You may not impersonate another person, create accounts under false pretenses, or use Huddle to deceive other parents about your identity or your role at a school.

## 3. How you can use Huddle

You agree to use Huddle only for its intended purpose: connecting with other adult parents and guardians at your child's school to coordinate playdates, school-related communication, and family social activities.

You will **not**:

- Post or share content about other people's children without their parents' permission
- Share photos, names, or personal information about any minor
- Harass, threaten, or abuse other users
- Use Huddle to solicit, scam, sell to, or market to other users
- Misrepresent your affiliation with a school or classroom
- Attempt to access another user's account
- Reverse engineer, decompile, or scrape the Service
- Use Huddle to violate any law or anyone else's rights
- Upload viruses, malware, or harmful code
- Use Huddle for any commercial purpose without our written consent

## 4. Content you share

You retain ownership of the content you upload (such as your profile photo and messages). By using Huddle, you grant us a limited license to host, display, and transmit that content as needed to operate the Service.

You are solely responsible for your content. Do not upload anything you don't have the right to share.

We may remove content that violates these Terms or that we believe is harmful, unsafe, or inappropriate, at our discretion.

## 5. Other users

Huddle connects you with other parents. We do **not** verify the identity of users or screen for background checks. You are responsible for your own safety and judgment when interacting with other users.

Do not share sensitive personal information with people you do not know in person. Use the same caution you would use on any other social network.

If another user makes you feel unsafe or behaves inappropriately, you can disconnect from them in the Network screen and report them to us at the email below.

## 6. Safety and child welfare

Huddle takes child safety seriously. If you ever witness or suspect any activity on Huddle that could harm a child — including grooming, predatory behavior, attempts to identify or contact children, or sharing of inappropriate content about minors — report it immediately to admin@huddlefamilies.com and to local law enforcement.

We will cooperate fully with law enforcement and may suspend or terminate accounts at any time, without notice, if we believe a user poses a risk to child safety.

## 7. Service availability

Huddle is provided "as is" and "as available." We do not guarantee that the Service will be uninterrupted, error-free, or secure. We may modify, suspend, or discontinue any part of the Service at any time without notice.

## 8. Disclaimers

To the fullest extent permitted by law:

- Huddle is provided without warranties of any kind, express or implied
- We do not guarantee any specific outcome from using the Service
- We are not responsible for the actions, content, or conduct of other users
- We do not endorse or verify any school, classroom, or user

You use Huddle at your own risk.

## 9. Limitation of liability

To the fullest extent permitted by law, Huddle and its operators are not liable for any indirect, incidental, consequential, special, or punitive damages arising out of or related to your use of the Service. Our total liability to you for any claim is limited to the amount you have paid us in the past 12 months, or $50, whichever is greater.

## 10. Indemnification

You agree to indemnify and hold harmless Huddle and its operators from any claims, damages, or expenses arising from your use of the Service, your violation of these Terms, or your violation of any rights of another person.

## 11. Termination

You can stop using Huddle and delete your account at any time. We can suspend or terminate your account at any time, with or without notice, if we believe you have violated these Terms or pose a risk to other users or to the Service.

## 12. Changes to these Terms

We may update these Terms from time to time. If we make material changes, we will notify you through the Service or by email. Continued use of Huddle after the changes means you accept the updated Terms.

## 13. Governing law

These Terms are governed by the laws of the State of California, without regard to conflict of laws principles. Any disputes will be resolved in the state or federal courts located in California.

## 14. Contact

If you have questions about these Terms, contact:

**Huddle**
Email: admin@huddlefamilies.com

---

*These Terms are provided for transparency and are not a substitute for legal advice.*`;

export const PRIVACY_POLICY = `# Privacy Policy

**Effective date:** June 14, 2026
**Version:** 1.0.0

This Privacy Policy describes how Huddle ("we," "us," or "our") collects, uses, and shares information when you use the Huddle service at huddlefamilies.com (the "Service").

By using Huddle, you agree to this Privacy Policy.

---

## 1. Who Huddle is for

Huddle is a social network for **adult parents and guardians** to connect with other adult parents and guardians at their child's school. You must be 18 years or older and a parent or legal guardian of a school-aged child to use Huddle.

Huddle does not collect, store, or knowingly process any personal information from children under the age of 13.

If we learn that we have collected personal information from a child under 13, we will delete that information promptly.

## 2. What we collect

When you sign up and use Huddle, we collect:

- **Your name** (as you enter it)
- **Your email address** (used to sign in and send notifications)
- **Your profile photo** (optional, uploaded by you)
- **Your school affiliation** — the name of the school, the name of the classroom teacher, and the grade level you self-identify as a parent in
- **Your connections** — the list of other Huddle users you have connected with
- **Your messages and playdate requests** — content you send through Huddle to other connected parents
- **Basic technical data** — IP address, browser type, device information, and session timestamps, used for security and service reliability

We **do not** collect names, photos, or any identifying information about minor children. Children are never users of Huddle and are never represented as records in our system.

## 3. How we use your information

We use your information to:

- Provide and maintain the Huddle service
- Help you find and connect with other parents at your child's school
- Send you notifications about connection requests, messages, and other parents' actions you've opted into
- Improve and develop the Service
- Protect the security and integrity of the Service
- Comply with legal obligations

## 4. How we share your information

We share information **only** in these limited ways:

- **With other parents you've connected with** — your name, photo, and classroom affiliation are visible to parents in your same classroom and to parents you've accepted a connection with
- **With service providers** — we use Supabase (database and authentication), Vercel (hosting), and Resend (email delivery) to operate the Service. These providers are bound by their own privacy obligations and only process data on our behalf
- **For legal reasons** — if required by law, court order, or to protect rights, safety, or property
- **In a business transfer** — if Huddle is acquired, your information may be transferred to the new owner, subject to this Privacy Policy

We **do not** sell your personal information. We **do not** share your information with advertisers.

## 5. Data retention

We minimize data retention by design:

- **Playdate messages** — automatically deleted 24 hours after the scheduled playdate
- **General messages** — automatically deleted after 30 days from the last message (configurable by user)
- **Account data after deletion** — permanently removed within 30 days of account deletion
- **Profile data** — retained as long as your account is active

We believe in data minimization. The less we keep, the less risk to you.

## 6. Your choices and rights

You can:

- **Update your profile** at any time through the Profile screen
- **Disconnect from another parent** at any time through your Network screen
- **Delete your account** by contacting us at the email below. When you delete your account, we will permanently remove your profile, photo, messages, and connections within 30 days
- **Request a copy** of the data we hold about you
- **Object** to certain uses of your data

If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA), including the right to know, the right to delete, the right to correct, and the right to opt out of any sale or sharing of your personal information (we do not sell or share for advertising).

## 7. Data security

We use industry-standard security practices to protect your information, including encrypted connections (HTTPS), secure authentication, and access controls. However, no online service is completely secure. You use Huddle at your own risk.

## 8. Children's privacy

As stated above, Huddle is for adults 18 and older. We do not knowingly collect information from anyone under 13. If you believe a child has provided us information, please contact us and we will delete it.

## 9. Changes to this policy

We may update this Privacy Policy from time to time. If we make material changes, we will notify you through the Service or by email. Continued use of Huddle after changes means you accept the updated policy.

## 10. Contact us

If you have questions or concerns about this Privacy Policy or your information, please contact:

**Huddle**
Email: admin@huddlefamilies.com

---

*This policy is provided for transparency and is not legal advice.*`;```
