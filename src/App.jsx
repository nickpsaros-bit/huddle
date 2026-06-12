import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Profile from "./Profile";

const DEMO_MODE = false;

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);

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

  if (loading && !DEMO_MODE) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#0F2044",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif"
      }}>
        <p style={{ color: "#02C39A", fontSize: "1.5rem" }}>Huddle</p>
      </div>
    );
  }

  if (!session && !DEMO_MODE) {
    return <Auth onAuth={() => {}} />;
  }

  if (DEMO_MODE || !hasProfile) {
    return (
      <Profile
        session={{ user: { id: "00000000-0000-0000-0000-000000000000" } }}
        onComplete={() => setHasProfile(true)}
      />
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0F2044",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "3rem", fontWeight: "700", margin: "0 0 1rem" }}>
        Huddle
      </h1>
      <p style={{ color: "#FFFFFF", fontSize: "1.1rem" }}>
        Welcome to Huddle! 👋
      </p>
      <p style={{ color: "#8AAEC8", fontSize: "0.9rem", marginTop: "0.5rem" }}>
        Your classroom is ready.
      </p>
    </div>
  );
}