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
import RolloverPrompt from "./RolloverPrompt";
import Journey from "./Journey";
import Birthdays from "./Birthdays";
import { shouldPromptRollover, currentSchoolYear, earliestStartMonth } from "./schoolYear";
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
  const [showProfile, setShowProfile] = useState(false);
  const [showJourney, setShowJourney] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [myAvatarUrl, setMyAvatarUrl] = useState(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [playdateBadge, setPlaydateBadge] = useState(0);
  const [playdateHalo, setPlaydateHalo] = useState(null);

  // Invite handling.
  const [inviteToken, setInviteToken] = useState(null);
  const [arrivedViaInvite, setArrivedViaInvite] = useState(false);
  const [dismissedInviteLanding, setDismissedInviteLanding] = useState(false);

  // Rollover: null = not evaluated / not due; object = prompt data to show.
  const [rolloverData, setRolloverData] = useState(null);
  const [rolloverSnoozed, setRolloverSnoozed] = useState(false); // "don't know yet" for this session

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
      checkRollover(session.user.id);
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
    // Fetch the user's avatar for the top-right profile button (best-effort).
    supabase.from("parents").select("photo_url").eq("id", userId).maybeSingle()
      .then(({ data }) => { if (data) setMyAvatarUrl(data.photo_url || null); });

    // 1) Read the parents row. CRITICAL: distinguish a FAILED read (error) from a
    //    genuinely-absent profile. A failed read must NOT dump an existing user
    //    into the signup flow (that's what happened during the RLS incident).
    const { data: parentData, error: parentErr } = await supabase
      .from("parents")
      .select("id, name")
      .eq("id", userId)
      .maybeSingle();

    if (parentErr) {
      console.warn("checkProfile: parents read failed, will retry:", parentErr.message);
      setTimeout(() => checkProfile(userId), 1500);
      return;
    }

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

  // Decide whether to show the rollover prompt: fetch this household's current
  // classroom memberships + their schools' start months, and check whether we're
  // in rollover season and this parent hasn't rolled over for the current year.
  const checkRollover = async (userId) => {
    try {
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", userId)
        .maybeSingle();
      if (!hm) return;

      const { data: memberships } = await supabase
        .from("classroom_members")
        .select("id, school_year, classrooms(id, teacher_name, grade, school_id, school_year, schools(id, name, school_start_month))")
        .eq("household_id", hm.household_id);
      if (!memberships || memberships.length === 0) return;

      // Earliest school start month across this household's classrooms governs timing.
      const startMonths = memberships
        .map((m) => m.classrooms?.schools?.school_start_month)
        .filter((n) => typeof n === "number");
      const startMonth = earliestStartMonth(startMonths);

      // Only consider LAST-year memberships for rollover (don't re-prompt on rows
      // already at the current year).
      const curYear = currentSchoolYear(startMonth);
      const currentMemberships = memberships.filter((m) => m.school_year === curYear);
      let staleMemberships = memberships.filter((m) => m.school_year !== curYear);
      if (staleMemberships.length === 0) return; // already all current

      // Exclude stale classrooms the parent has ALREADY rolled up: if there's a
      // current-year membership at the same school + one grade higher, treat this
      // stale row as resolved (they moved that class up) and don't re-prompt it.
      // This lets a partial rollover ("don't know yet" on one) re-prompt ONLY the
      // still-unresolved classrooms.
      staleMemberships = staleMemberships.filter((m) => {
        const c = m.classrooms || {};
        const schoolId = c.schools?.id || c.school_id;
        const nextGrade = (typeof c.grade === "number" ? c.grade : -99) + 1;
        const alreadyRolled = currentMemberships.some((cm) => {
          const cc = cm.classrooms || {};
          const cSchoolId = cc.schools?.id || cc.school_id;
          return cSchoolId === schoolId && cc.grade === nextGrade;
        });
        return !alreadyRolled;
      });
      if (staleMemberships.length === 0) return; // everything stale has been resolved

      // Read the parent's rolled_over_year.
      const { data: prow } = await supabase
        .from("parents")
        .select("rolled_over_year")
        .eq("id", userId)
        .maybeSingle();
      const rolledOverYear = prow?.rolled_over_year || null;

      if (shouldPromptRollover(rolledOverYear, startMonth)) {
        setRolloverData({
          householdId: hm.household_id,
          currentYear: curYear,
          memberships: staleMemberships,
        });
      }
    } catch (e) {
      // Rollover prompt is best-effort; never block the app.
    }
  };

  const consumeInvite = async (userId, userEmail) => {
    try {
      // Atomic redemption via SECURITY DEFINER RPC: looks up the invite by the
      // stored token (falls back to the user's email inside the function),
      // validates, creates the inviter<->me connection, notifies the inviter,
      // marks the invite accepted. Clients no longer touch the invites table.
      const token = localStorage.getItem(INVITE_KEY) || "";
      await supabase.rpc("redeem_invite", { p_token: token });
    } catch (err) {
      // Best-effort — a failed redemption shouldn't block entering the app.
    } finally {
      localStorage.removeItem(INVITE_KEY);
      localStorage.removeItem(INVITE_EMAIL_KEY);
      setInviteToken(null);
    }
  };

  // Bell = pending requests + unread notifications. Playdate badge + halo.
  const fetchCounts = async (userId) => {
    // Respect the in-app notification preference: if off, the bell stays empty.
    const { data: prefRow } = await supabase
      .from("parents")
      .select("notify_in_app")
      .eq("id", userId)
      .maybeSingle();
    const inAppOn = !prefRow || prefRow.notify_in_app !== false;
    if (!inAppOn) {
      setNotificationCount(0);
    }

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

    setNotificationCount(inAppOn ? bell : 0);

    if (!myHh) {
      setPlaydateBadge(0);
      setPlaydateHalo(null);
      return;
    }

    const nowMs = Date.now();

    let unrepliedCount = 0;
    const upcoming = []; // { date, status }

    const { data: myInv } = await supabase
      .from("playdate_invites")
      .select("rsvp, playdates(proposed_date, organizer_household_id, status, event_type)")
      .eq("household_id", myHh.household_id);

    for (const inv of (myInv || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.event_type === "birthday") continue; // birthdays counted in the Birthdays tab
      if (pd.organizer_household_id === myHh.household_id) continue;
      if (new Date(pd.proposed_date).getTime() < nowMs) continue;
      if (inv.rsvp === "invited") unrepliedCount++;
      if (inv.rsvp === "no") continue;
      upcoming.push({ date: new Date(pd.proposed_date).getTime(), status: pd.status });
    }

    const { data: hosting } = await supabase
      .from("playdates")
      .select("proposed_date, status, event_type")
      .eq("organizer_household_id", myHh.household_id)
      .gte("proposed_date", new Date(nowMs).toISOString());

    for (const pd of (hosting || [])) {
      if (pd.event_type === "birthday") continue; // birthdays counted in the Birthdays tab
      upcoming.push({ date: new Date(pd.proposed_date).getTime(), status: pd.status });
    }

    const live = upcoming
      .filter((u) => u.status !== "cancelled")
      .sort((a, b) => a.date - b.date);

    // Badge = all active upcoming playdates (scheduled-but-not-confirmed and
    // confirmed alike). Halo removed in favor of this clearer count.
    setPlaydateBadge(live.length);
    setPlaydateHalo(null);
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

  if (rolloverData && !rolloverSnoozed) {
    return (
      <RolloverPrompt
        session={session}
        householdId={rolloverData.householdId}
        currentYear={rolloverData.currentYear}
        memberships={rolloverData.memberships}
        onDone={() => { setRolloverData(null); checkProfile(session.user.id); fetchCounts(session.user.id); }}
        onRemindLater={() => setRolloverSnoozed(true)}
      />
    );
  }

  if (showInbox) {
    return <Inbox session={session} onBack={() => { setShowInbox(false); fetchCounts(session.user.id); checkProfile(session.user.id); }} />;
  }

  if (showSettings) {
    return <Settings session={session} onBack={() => setShowSettings(false)} />;
  }

  if (showProfile) {
    return <ProfileScreen session={session} onBack={() => { setShowProfile(false); fetchCounts(session.user.id); }} onOpenSettings={() => { setShowProfile(false); setShowSettings(true); }} />;
  }

  if (showJourney) {
    return <Journey session={session} onBack={() => setShowJourney(false)} />;
  }

  if (showSearch) {
    return <Search session={session} avatarUrl={myAvatarUrl} onProfileClick={() => setShowProfile(true)} onBack={() => setShowSearch(false)} />;
  }

  let screen;
  if (activeTab === "home") {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} onPlaydateCreated={() => { setActiveTab("playdates"); fetchCounts(session.user.id); }} onGoToNetwork={() => setActiveTab("network")} onGoToPlaydates={() => setActiveTab("playdates")} avatarUrl={myAvatarUrl} onProfileClick={() => setShowProfile(true)} onOpenJourney={() => setShowJourney(true)} onSearchClick={() => setShowSearch(true)} />;
  } else if (activeTab === "network") {
    screen = <Network session={session} avatarUrl={myAvatarUrl} onProfileClick={() => setShowProfile(true)} onSearchClick={() => setShowSearch(true)} onBellClick={() => setShowInbox(true)} notificationCount={notificationCount} />;
  } else if (activeTab === "playdates") {
    screen = <Playdates session={session} onChanged={() => fetchCounts(session.user.id)} avatarUrl={myAvatarUrl} onProfileClick={() => setShowProfile(true)} onSearchClick={() => setShowSearch(true)} onBellClick={() => setShowInbox(true)} notificationCount={notificationCount} />;
  } else if (activeTab === "birthdays") {
    screen = <Birthdays session={session} onChanged={() => fetchCounts(session.user.id)} avatarUrl={myAvatarUrl} onProfileClick={() => setShowProfile(true)} onSearchClick={() => setShowSearch(true)} onBellClick={() => setShowInbox(true)} notificationCount={notificationCount} />;
  } else {
    screen = <Home session={session} notificationCount={notificationCount} onBellClick={() => setShowInbox(true)} onPlaydateCreated={() => { setActiveTab("playdates"); fetchCounts(session.user.id); }} onGoToNetwork={() => setActiveTab("network")} onGoToPlaydates={() => setActiveTab("playdates")} avatarUrl={myAvatarUrl} onProfileClick={() => setShowProfile(true)} onSearchClick={() => setShowSearch(true)} />;
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