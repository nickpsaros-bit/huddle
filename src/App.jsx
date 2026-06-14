import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Profile from "./Profile";
import Home from "./Home";
import NavBar from "./NavBar";
import ProfileScreen from "./ProfileScreen";
import Search from "./Search";
import Inbox from "./Inbox";
import Network from "./Network";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [showInbox, setShowInbox] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        checkProfile(session.user.id);
        fetchNotificationCount(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) {
          checkProfile(session.user.id);
          fetchNotificationCount(session.user.id);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkProfile = async (userId) => {
    // Profile is complete if: parent has name AND is in a household AND has at least 1 classroom
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

  const fetchNotificationCount = async (userId) => {
    const { data } = await supabase
      .from("connections")
      .select("id")
      .eq("recipient_id", userId)
      .eq("status", "pending");
    setNotificationCount(data ? data.length : 0);
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

  if (!hasProfile) {
    return <Profile session={session} onComplete={() => setHasProfile(true)} />;
  }

  if (showInbox) {
    return <Inbox session={session} onBack={() => { setShowInbox(false); fetchNotificationCount(session.user.id); }} />;
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