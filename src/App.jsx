import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Auth from "./Auth";
import Consent from "./Consent";
import Profile from "./Profile";
import Home from "./Home";
import NavBar from "./NavBar";
import ProfileScreen from "./ProfileScreen";
import Settings from "./Settings.jsx";
import Search from "./Search";
import Inbox from "./Inbox";
import Network from "./Network";
import Playdates from "./Playdates";
import InviteLanding from "./InviteLanding";
import { TERMS_VERSION, PRIVACY_VERSION } from "./legal";

const INVITE_KEY = "huddle_pending_invite_token";
const INVITE_EMAIL_KEY = "huddle_invite_email";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasConsented, setHasConsented] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [playdateBadge, setPlaydateBadge] = useState(0);
  const [playdateHalo, setPlaydateHalo] = useState(null);

  // Invite handling.
  const [inviteToken, setInviteToken] = useState(null);
  const [arrivedViaInvite, setArrivedViaInvite] = useState(false);
  const [dismissedInviteLanding, setDismissedInviteLanding] = useState(false);

  useEffect(() => {
    const path = window.location.pathname || "";
    const params = new URLSearchParams(window.location.search);
    const queryToken = params.get("invite");
    const pathMatch = path.match(/^\/invite\/([A-Za-z0-9]+)/);

    let token = null;
    if (queryToken) token = queryToken;
    else if (pathMatch && pathMatch[1]) token = pathMatch[1];

    if (token) {
      localStorage.setItem(INVITE_KEY, token);
      setInviteToken(token);
      setArrivedViaInvite(true);
      window.history.replaceState({}, "", "/");
    } else {
      const stored = localStorage.getItem(INVITE_KEY);
      if (stored) setInviteToken(stored);
    }
  }, []);

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

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) fetchCounts(session.user.id);
        });
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, []);

  useEffect(() => {
    if (session && hasProfile) {
      consumeInvite(session.user.id, session.user.email).then(() => fetchCounts(session.user.id));
    }
  }, [session, hasProfile]);

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
const checkProfile = async (userId) => {
    // 1) Read the parents row. CRITICAL: distinguish a FAILED read (error) from a
    //    genuinely-absent profile. A failed read must NOT dump an existing user
    //    into the signup flow (that's what happened during the RLS incident).
    const { data: parentData, error: parentErr } = await supabase
      .from("parents")
      .select("id, name")
      .eq("id", userId)
      .maybeSingle();

    if (parentErr) {
      // Read failed (RLS, network, transient). Do NOT conclude "new user."
      // Leave hasProfile unchanged and retry shortly.
      console.warn("checkProfile: parents read failed, will retry:", parentErr.message);
      setTimeout(() => checkProfile(userId), 1500);
      return;
    }

    // Query succeeded and there's truly no profile row → genuinely new user.
    if (!parentData || !parentData.name) {
      setHasProfile(false);
      return;
    }

    // 2) Household check — same error-vs-absent distinction.
    const { data: hm, error: hmErr } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", userId)
      .maybeSingle();

    if (hmErr) {
      console.warn("checkProfile: household read failed, will retry:", hmErr.message);
      setTimeout(() => checkProfile(userId), 1500);
      return;
    }
    if (!hm) {
      setHasProfile(false);
      return;
    }

    // 3) Classroom membership check.
    const { data: memberships, error: cmErr } = await supabase
      .from("classroom_members")
      .select("id")
      .eq("household_id", hm.household_id)
      .limit(1);

    if (cmErr) {
      console.warn("checkProfile: classroom read failed, will retry:", cmErr.message);
      setTimeout(() => checkProfile(userId), 1500);
      return;
    }

    setHasProfile(memberships && memberships.length > 0);
  };

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

  const consumeInvite = async (userId, userEmail) => {
    try {
      let invite = null;

      if (userEmail) {
        const { data: byEmail } = await supabase
          .from("invites")
          .select("*")
          .eq("invited_email", userEmail.toLowerCase())
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (byEmail) invite = byEmail;
      }

      if (!invite) {
        const token = localStorage.getItem(INVITE_KEY);
        if (token) {
          const { data: byToken } = await supabase
            .from("invites")
            .select("*")
            .eq("token", token)
            .maybeSingle();
          if (byToken) invite = byToken;
        }
      }

      if (!invite || invite.status !== "pending" || new Date(invite.expires_at).getTime() < Date.now()) {
        localStorage.removeItem(INVITE_KEY);
        localStorage.removeItem(INVITE_EMAIL_KEY);
        setInviteToken(null);
        return;
      }

      if (invite.inviter_id === userId) {
        localStorage.removeItem(INVITE_KEY);
        localStorage.removeItem(INVITE_EMAIL_KEY);
        setInviteToken(null);
        return;
      }

      const { data: existing } = await supabase
        .from("connections")
        .select("id")
        .or(`and(requester_id.eq.${invite.inviter_id},recipient_id.eq.${userId}),and(requester_id.eq.${userId},recipient_id.eq.${invite.inviter_id})`);

      if (!existing || existing.length === 0) {
        await supabase.from("connections").insert({
          requester_id: invite.inviter_id,
          recipient_id: userId,
          status: "accepted",
        });

        try {
          const { data: me } = await supabase.from("parents").select("name").eq("id", userId).single();
          const nm = me?.name ? me.name.trim().split(/\s+/) : ["A parent"];
          const label = nm.length === 1 ? nm[0] : `${nm[0]} ${nm[nm.length - 1].charAt(0)}.`;
          await supabase.from("notifications").insert({
            recipient_id: invite.inviter_id,
            type: "invite_accepted",
            title: "Your invite was accepted 🎉",
            body: `${label} joined Huddle from your invite. You're now connected!`,
          });
        } catch (e) { /* best-effort */ }
      }

      await supabase.from("invites")
        .update({ status: "accepted", accepted_by: userId, accepted_at: new Date().toISOString() })
        .eq("id", invite.id);

      localStorage.removeItem(INVITE_KEY);
      localStorage.removeItem(INVITE_EMAIL_KEY);
      setInviteToken(null);
    } catch (err) {
      localStorage.removeItem(INVITE_KEY);
      localStorage.removeItem(INVITE_EMAIL_KEY);
      setInviteToken(null);
    }
  };

  // Bell = pending requests + unread notifications. Playdate badge + halo.
  const fetchCounts = async (userId) => {
    const { data: myHh } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", userId)
      .maybeSingle();

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

    const { data: unreadNotifs } = await supabase
      .from("notifications")
      .select("id")
      .eq("recipient_id", userId)
      .eq("read", false);
    bell += unreadNotifs ? unreadNotifs.length : 0;

    setNotificationCount(bell);

    if (!myHh) {
      setPlaydateBadge(0);
      setPlaydateHalo(null);
      return;
    }

    const nowMs = Date.now();

    // ---- Playdate badge: count invites still awaiting MY reply ----
    let unrepliedCount = 0;

    // ---- Playdate halo: reflect the SOONEST upcoming playdate's status ----
    // (confirmed = teal/green, pending = amber, none = no halo).
    // Gather all my upcoming playdates (hosting OR invited and not declined),
    // pick the soonest, and use its lifecycle status.
    const upcoming = []; // { date, status }

    const { data: myInv } = await supabase
      .from("playdate_invites")
      .select("rsvp, playdates(proposed_date, organizer_household_id, status)")
      .eq("household_id", myHh.household_id);

    for (const inv of (myInv || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.organizer_household_id === myHh.household_id) continue; // hosting handled below
      if (new Date(pd.proposed_date).getTime() < nowMs) continue;
      if (inv.rsvp === "invited") unrepliedCount++;
      if (inv.rsvp === "no") continue; // declined → not "my" upcoming playdate
      upcoming.push({ date: new Date(pd.proposed_date).getTime(), status: pd.status });
    }

    const { data: hosting } = await supabase
      .from("playdates")
      .select("proposed_date, status")
      .eq("organizer_household_id", myHh.household_id)
      .gte("proposed_date", new Date(nowMs).toISOString());

    for (const pd of (hosting || [])) {
      upcoming.push({ date: new Date(pd.proposed_date).getTime(), status: pd.status });
    }

    setPlaydateBadge(unrepliedCount);

    // Pick the soonest upcoming playdate that isn't cancelled.
    const live = upcoming
      .filter((u) => u.status !== "cancelled")
      .sort((a, b) => a.date - b.date);

    if (live.length === 0) {
      setPlaydateHalo(null);
    } else {
      const soonest = live[0];
      setPlaydateHalo(soonest.status === "confirmed" ? "teal" : "amber");
    }
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

  if (!session && arrivedViaInvite && inviteToken && !dismissedInviteLanding) {
    return (
      <InviteLanding
        token={inviteToken}
        onJoin={() => setDismissedInviteLanding(true)}
      />
    );
  }

  if (!session) {
    return <Auth onAuth={() => {}} />;
  }

  if (!hasConsented) {
    return <Consent session={session} onConsented={() => setHasConsented(true)} />;
  }

  if (!hasProfile) {
    return <Profile session={session} onComplete={() => { setHasProfile(true); fetchCounts(session.user.id); }} />;
  }

  if (showInbox) {
    return <Inbox session={session} onBack={() => { setShowInbox(false); fetchCounts(session.user.id); checkProfile(session.user.id); }} />;
  }

  if (showSettings) {
    return <Settings session={session} onBack={() => setShowSettings(false)} />;
  }

  let screen;
  if (activeTab === "home") {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} onPlaydateCreated={() => { setActiveTab("playdates"); fetchCounts(session.user.id); }} onGoToNetwork={() => setActiveTab("network")} onGoToPlaydates={() => setActiveTab("playdates")} />;
  } else if (activeTab === "search") {
    screen = <Search session={session} />;
  } else if (activeTab === "network") {
    screen = <Network session={session} />;
  } else if (activeTab === "playdates") {
    screen = <Playdates session={session} onChanged={() => fetchCounts(session.user.id)} />;
  } else if (activeTab === "profile") {
    screen = <ProfileScreen session={session} onBack={() => setActiveTab("home")} onOpenSettings={() => setShowSettings(true)} />;
  } else {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} onPlaydateCreated={() => { setActiveTab("playdates"); fetchCounts(session.user.id); }} onGoToNetwork={() => setActiveTab("network")} onGoToPlaydates={() => setActiveTab("playdates")} />;
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
}