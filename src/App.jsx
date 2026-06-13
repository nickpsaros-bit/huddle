import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Profile from "./Profile";
import Home from "./Home";
import NavBar from "./NavBar";
import ProfileScreen from "./ProfileScreen";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [activeTab, setActiveTab] = useState("home");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) checkProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) checkProfile(session.user.id);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkProfile = async (userId) => {
    const { data } = await supabase
      .from("parents")
      .select("id, name")
      .eq("id", userId)
      .single();
    if (data?.name) setHasProfile(true);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.5rem" }}>Huddle</p>
      </div>
    );
  }

  if (!session) return <Auth onAuth={() => {}} />;
  if (!hasProfile) return <Profile session={session} onComplete={() => setHasProfile(true)} />;

  const renderScreen = () => {
    switch (activeTab) {
      case "home":
        return <Home session={session} />;
      case "playdates":
        return (
          <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>📅</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Playdates</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Coming soon — request a playdate from your classroom!</p>
          </div>
        );
      case "messages":
        return (
          <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>💬</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Messages</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Coming soon — chat with other parents!</p>
          </div>
        );
      case "profile":
        return <ProfileScreen session={session} onBack={() => setActiveTab("home")} />;
      default:
        return <Home session={session} />;
    }
  };

  return (
    <div>
      <div style={{ paddingBottom: "70px" }}>
        {renderScreen()}
      </div>
      <NavBar active={activeTab} onNavigate={setActiveTab} />
    </div>
  );
}