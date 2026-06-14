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
import { TERMS_VERSION, PRIVACY_VERSION } from "./legal";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasConsented, setHasConsented] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [pendingJoinRequest, setPendingJoinRequest] = useState(null);
  const [activeTab, setActiveTab] = useState("home");
  const [showInbox, setShowInbox] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        checkConsent(session.user.id);
        checkProfile(session.user.id);
        fetchNotificationCount(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) {
          checkConsent(session.user.id);
          checkProfile(session.user.id);
          fetchNotificationCount(session.user.id);
        } else {
          setHasConsented(false);
          setHasProfile(false);
          setPendingJoinRequest(null);
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
      setPendingJoinRequest(null);
      return;
    }

    // Already in a household with at least one classroom? Then they're set up.
    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", userId)
      .single();

    if (hm) {
      const { data: memberships } = await supabase
        .from("classroom_members")
        .select("id")
        .eq("household_id", hm.household_id)
        .limit(1);

      if (memberships && memberships.length > 0) {
        setPendingJoinRequest(null);
        setHasProfile(true);
        return;
      }
    }

    // Not in a set-up household. Are they waiting on a join request?
    const { data: pending } = await supabase
      .from("household_join_requests")
      .select("id, target_household_id, households!household_join_requests_target_household_id_fkey(id, household_members(parents(name)))")
      .eq("requesting_parent_id", userId)
      .eq("status", "pending")
      .maybeSingle();

    if (pending) {
      // Build a privacy-safe label for the household they asked to join.
      const names = (pending.households?.household_members || [])
        .map((m) => m.parents?.name)
        .filter(Boolean);
      setPendingJoinRequest({ id: pending.id, names });
      setHasProfile(false);
      return;
    }

    // No household, no pending request → send them through signup.
    setPendingJoinRequest(null);
    setHasProfile(false);
  };

  const fetchNotificationCount = async (userId) => {
    // Pending connection requests where I'm the recipient.
    const { data: conns } = await supabase
      .from("connections")
      .select("id")
      .eq("recipient_id", userId)
      .eq("status", "pending");

    // Pending household-join requests targeting a household I'm in.
    let joinCount = 0;
    const { data: myHh } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", userId)
      .maybeSingle();

    if (myHh) {
      const { data: joins } = await supabase
        .from("household_join_requests")
        .select("id")
        .eq("target_household_id", myHh.household_id)
        .eq("status", "pending");
      joinCount = joins ? joins.length : 0;
    }

    setNotificationCount((conns ? conns.length : 0) + joinCount);
  };

  // Privacy-safe short name: "Nick Psaros" -> "Nick P."
  const shortName = (fullName) => {
    if (!fullName) return "this family";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const cancelJoinRequest = async () => {
    if (!pendingJoinRequest) return;
    await supabase
      .from("household_join_requests")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", pendingJoinRequest.id);
    setPendingJoinRequest(null);
    // Falls through to the Profile signup flow on next render.
  };

  const handleNavigate = (tabId) => {
    setActiveTab(tabId);
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

  // Waiting on a co-parent / household approval.
  if (pendingJoinRequest) {
    const label = pendingJoinRequest.names.length
      ? pendingJoinRequest.names.map(shortName).join(" & ")
      : "this family";
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
        <div style={{ width: "100%", maxWidth: "440px", textAlign: "center" }}>
          <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 2rem" }}>Huddle</h1>
          <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>⏳</p>
          <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Waiting for approval</h2>
          <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem", lineHeight: "1.5" }}>
            You've asked to join {label}'s household. Once they approve, you'll share their classrooms and connections automatically.
          </p>
          <button onClick={() => checkProfile(session.user.id)}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem" }}>
            Check again
          </button>
          <button onClick={cancelJoinRequest}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.95rem", cursor: "pointer" }}>
            Cancel & set up my own household instead
          </button>
        </div>
      </div>
    );
  }

  if (!hasProfile) {
    return <Profile session={session} onComplete={() => setHasProfile(true)} />;
  }

  if (showInbox) {
    return <Inbox session={session} onBack={() => { setShowInbox(false); fetchNotificationCount(session.user.id); checkProfile(session.user.id); }} />;
  }

  let screen;
  if (activeTab === "home") {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} />;
  } else if (activeTab === "search") {
    screen = <Search session={session} />;
  } else if (activeTab === "network") {
    screen = <Network session={session} />;
  } else if (activeTab === "playdates") {
    screen = (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>📅</p>
        <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Playdates</p>
        <p style={{ color: "#607080", fontSize: "0.9rem" }}>Coming soon!</p>
      </div>
    );
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
      <NavBar active={activeTab} onNavigate={handleNavigate} />
    </div>
  );
}