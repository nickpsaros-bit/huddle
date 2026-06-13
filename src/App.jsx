import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Profile from "./Profile";
import Home from "./Home";

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

  if (loading) {
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

  if (!session) {
    return <Auth onAuth={() => {}} />;
  }

  if (!hasProfile) {
    return (
      <Profile
        session={session}
        onComplete={() => setHasProfile(true)}
      />
    );
  }

  return <Home session={session} />;
}