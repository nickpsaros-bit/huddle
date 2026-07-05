import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import PlaydateRequest from "./PlaydateRequest";
import Button from "./Button";
import { currentSchoolYear, earliestStartMonth } from "./schoolYear";
import InviteFamily from "./InviteFamily";
import ConfirmModal from "./ConfirmModal";
import Icon from "./Icon";
import { getHiddenParentIds } from "./blocks";
import TopBar from "./TopBar";

export default function Home({ session, notificationCount, onBellClick, onPlaydateCreated, onGoToPlaydates, onGoToNetwork, avatarUrl, onProfileClick, onOpenJourney, onSearchClick }) {
  const [parent, setParent] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [classmates, setClassmates] = useState({});
  const [petsByHousehold, setPetsByHousehold] = useState({});
  const [nextPlaydate, setNextPlaydate] = useState(null);
  const [statConnections, setStatConnections] = useState(0);
  const [connectedIds, setConnectedIds] = useState(new Set());   // parent ids I'm connected to
  const [pendingIds, setPendingIds] = useState(new Set());       // parent ids with a pending request (either direction)
  const [connectBusy, setConnectBusy] = useState(null);          // parent id currently connecting
  const [statUpcoming, setStatUpcoming] = useState(0);
  const [loading, setLoading] = useState(true);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [requestEventType, setRequestEventType] = useState("playdate");
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [addingClassroom, setAddingClassroom] = useState(false);
  const [scopedSchool, setScopedSchool] = useState(null);
  const [gradeConflict, setGradeConflict] = useState(null);
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
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [drillMessage, setDrillMessage] = useState("");
  const [upcomingBirthdays, setUpcomingBirthdays] = useState([]);
  const [wishedIds, setWishedIds] = useState({}); // birthday.id -> true after wishing
  const [wishBusy, setWishBusy] = useState(null);
  const [statBirthdaysMonth, setStatBirthdaysMonth] = useState(0);
  const [monthBirthdays, setMonthBirthdays] = useState([]);
  const [showBirthdayList, setShowBirthdayList] = useState(false);
  const [hasUpcomingBirthdayEvent, setHasUpcomingBirthdayEvent] = useState(false);
  const [birthdayEventTag, setBirthdayEventTag] = useState("");  // "🎂 Hosting" | "🎂 Going"

  const grades = ["TK","Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade"];

  useEffect(() => { fetchData(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const getGradeLabel = (gradeNum) => grades[gradeNum] || "Unknown grade";

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const todayLabel = () =>
    new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const fmtPlaydate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const relTime = (iso) => {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const activityStyle = (type) => {
    switch (type) {
      case "playdate_invite": return { icon: "🎉", bg: "#13314F", color: "#8AAEC8" };
      case "playdate_rsvp": return { icon: "✅", bg: "#0F3D2E", color: "#02C39A" };
      case "playdate_cancelled": return { icon: "❌", bg: "#3D1515", color: "#F87171" };
      case "invite_accepted": return { icon: "👋", bg: "#13314F", color: "#8AAEC8" };
      default: return { icon: "🔔", bg: "#13233F", color: "#8AAEC8" };
    }
  };

  const petBadges = (hhId) => {
    const p = petsByHousehold[hhId];
    if (!p) return null;
    const icons = [];
    if (p.has_dog) icons.push("🐕");
    if (p.has_cat) icons.push("🐈");
    if (p.has_horse) icons.push("🐴");
    if (p.has_other) icons.push("🐾");
    if (icons.length === 0) return null;
    return (
      <span style={{ fontSize: "0.85rem", marginLeft: "6px", whiteSpace: "nowrap" }} title={p.has_other && p.other_label ? p.other_label : undefined}>
        {icons.join(" ")}
      </span>
    );
  };

  const fetchData = async () => {
    setLoading(true);

    // These three are independent — run in parallel.
    const [parentRes, hhRes, hidden] = await Promise.all([
      supabase.from("parents").select("*").eq("id", session.user.id).single(),
      supabase.from("household_members").select("household_id, role").eq("parent_id", session.user.id).single(),
      getHiddenParentIds(),
    ]);
    const parentData = parentRes.data;
    const householdMember = hhRes.data;
    setParent(parentData);

    if (!householdMember) {
      setLoading(false);
      return;
    }

    const hhId = householdMember.household_id;
    setHouseholdId(hhId);

    const { data: membershipData } = await supabase
      .from("classroom_members")
      .select("*, classrooms(id, teacher_name, grade, school_year, schools(id, name, school_start_month))")
      .eq("household_id", hhId);
    setMemberships(membershipData || []);

    const classmatesMap = {};
    const otherHouseholdIds = new Set();
    // Run all classroom-roster queries in PARALLEL instead of one-at-a-time.
    const rosterResults = await Promise.all(
      (membershipData || []).map((m) =>
        supabase
          .from("classroom_members")
          .select("*, households(id, household_members(parent_id, parents(id, name, photo_url)))")
          .eq("classroom_id", m.classroom_id)
          .eq("school_year", m.school_year)
          .neq("household_id", hhId)
          .then((res) => ({ m, otherMembers: res.data }))
      )
    );
    for (const { m, otherMembers } of rosterResults) {
      // Hide any household containing a blocked parent (either direction).
      const visibleMembers = (otherMembers || []).filter((cm) => {
        const members = cm.households?.household_members || [];
        return !members.some((mm) => mm.parents?.id && hidden.has(mm.parents.id));
      });
      classmatesMap[m.id] = {
        classroomLabel: `${m.classrooms?.teacher_name} · ${grades[m.classrooms?.grade] || "Unknown grade"}`,
        rows: visibleMembers,
      };
      for (const cm of visibleMembers) {
        if (cm.household_id) otherHouseholdIds.add(cm.household_id);
      }
    }
    setClassmates(classmatesMap);

    if (otherHouseholdIds.size > 0) {
      const { data: prefs } = await supabase
        .from("household_preferences")
        .select("household_id, has_dog, has_cat, has_horse, has_other, other_label")
        .in("household_id", [...otherHouseholdIds]);
      const map = {};
      for (const row of (prefs || [])) map[row.household_id] = row;
      setPetsByHousehold(map);
    }

    // ---- BIRTHDAYS THIS WEEK (my household + classmate/connected households I can see) ----
    try {
      const bdayHouseholdIds = new Set([...otherHouseholdIds, hhId]);
      if (bdayHouseholdIds.size > 0) {
        const { data: bdayRows } = await supabase
          .from("household_birthdays")
          .select("id, household_id, month, day, label")
          .in("household_id", [...bdayHouseholdIds]);

        // Build a household -> family label map from the classmates data we already have.
        const labelByHh = {};
        for (const g of Object.values(classmatesMap)) {
          for (const cm of (g?.rows || [])) {
            const members = cm.households?.household_members || [];
            const names = members
              .map((mm) => mm.parents?.name)
              .filter(Boolean)
              .map((n) => {
                const parts = n.trim().split(/\s+/);
                return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
              });
            if (cm.household_id && names.length > 0) {
              labelByHh[cm.household_id] = names.join(" & ");
            }
          }
        }
        labelByHh[hhId] = "Your family";

        // Days until a given month/day (0 = today, up to 7 ahead).
        const now = new Date();
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysUntil = (m, d) => {
          for (let offset = 0; offset <= 7; offset++) {
            const cand = new Date(todayMidnight);
            cand.setDate(todayMidnight.getDate() + offset);
            if (cand.getMonth() + 1 === m && cand.getDate() === d) return offset;
          }
          return -1;
        };

        const upcoming = [];
        for (const b of (bdayRows || [])) {
          const du = daysUntil(b.month, b.day);
          if (du >= 0) {
            upcoming.push({
              ...b,
              daysUntil: du,
              familyLabel: labelByHh[b.household_id] || (b.household_id === hhId ? "Your family" : "A family in your classroom"),
              isMine: b.household_id === hhId,
            });
          }
        }
        upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
        setUpcomingBirthdays(upcoming);

        // Load which birthdays I've ALREADY wished this year, so "Sent 🎉" persists
        // across refreshes and sessions.
        try {
          const curYear = now.getFullYear();
          const allBdayIds = (bdayRows || []).map((b) => b.id);
          if (allBdayIds.length > 0) {
            const { data: myWishes } = await supabase
              .from("birthday_wishes")
              .select("birthday_id")
              .eq("wisher_id", session.user.id)
              .eq("year", curYear)
              .in("birthday_id", allBdayIds);
            if (myWishes && myWishes.length > 0) {
              const wished = {};
              for (const w of myWishes) wished[w.birthday_id] = true;
              setWishedIds((prev) => ({ ...prev, ...wished }));
            }
          }
        } catch (e) { /* best-effort */ }

        // Rolling 45-day window — visible households' birthdays coming up.
        const WINDOW_DAYS = 45;
        const daysUntilBirthday = (m, d) => {
          const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          let next = new Date(now.getFullYear(), m - 1, d);
          if (next < t) next = new Date(now.getFullYear() + 1, m - 1, d); // wrap to next year
          return Math.round((next - t) / 86400000);
        };
        const upcomingList = (bdayRows || [])
          .map((b) => ({
            ...b,
            _daysUntil: daysUntilBirthday(b.month, b.day),
            familyLabel: labelByHh[b.household_id] || (b.household_id === hhId ? "Your family" : "A family in your classroom"),
            isMine: b.household_id === hhId,
          }))
          .filter((b) => b._daysUntil >= 0 && b._daysUntil <= WINDOW_DAYS)
          .sort((a, b) => a._daysUntil - b._daysUntil);
        setStatBirthdaysMonth(upcomingList.length);
        setMonthBirthdays(upcomingList);
      }
    } catch (e) {
      // Birthdays are a nice-to-have; never block the feed.
    }

    // ---- NEXT PLAYDATE — excludes cancelled so Home agrees with the Playdates screen ----
    try {
      const nowIso = new Date().toISOString();
      const candidates = [];

      const { data: hosting } = await supabase
        .from("playdates")
        .select("*")
        .eq("organizer_household_id", hhId)
        .neq("status", "cancelled")
        .gte("proposed_date", nowIso);
      for (const pd of (hosting || [])) {
        candidates.push({ pd, role: "hosting" });
      }

      const { data: myInvites } = await supabase
        .from("playdate_invites")
        .select("rsvp, playdates(*)")
        .eq("household_id", hhId);
      for (const inv of (myInvites || [])) {
        const pd = inv.playdates;
        if (!pd) continue;
        if (pd.organizer_household_id === hhId) continue;
        if (pd.status === "cancelled") continue;
        if (inv.rsvp === "no") continue;
        if (new Date(pd.proposed_date).toISOString() < nowIso) continue;
        candidates.push({ pd, role: "invited" });
      }

      // Do I have an upcoming BIRTHDAY event I've accepted (RSVP yes) or am hosting?
      let birthdayEvent = false;
      let amHosting = false;
      let amGoing = false;
      for (const inv of (myInvites || [])) {
        const pd = inv.playdates;
        if (!pd) continue;
        if (pd.event_type !== "birthday") continue;
        if (pd.status === "cancelled") continue;
        if (new Date(pd.proposed_date).toISOString() < nowIso) continue;
        const hosting = pd.organizer_household_id === hhId;
        if (hosting) { amHosting = true; birthdayEvent = true; }
        else if (inv.rsvp === "yes") { amGoing = true; birthdayEvent = true; }
      }
      setHasUpcomingBirthdayEvent(birthdayEvent);
      setBirthdayEventTag(amHosting ? "🎂 Hosting" : amGoing ? "🎂 Going" : "");

      candidates.sort((a, b) => new Date(a.pd.proposed_date) - new Date(b.pd.proposed_date));
      setStatUpcoming(candidates.length);
      if (candidates.length > 0) {
        const top = candidates[0];
        let withLabel = { ...top.pd, _role: top.role, _otherLabel: "" };
        if (top.role === "invited") {
          const { data: orgMembers } = await supabase
            .from("household_members")
            .select("parents(name)")
            .eq("household_id", top.pd.organizer_household_id);
          const names = (orgMembers || []).map((m) => m.parents?.name).filter(Boolean).map(shortName);
          withLabel._otherLabel = names.join(" & ");
        } else {
          const { data: invs } = await supabase
            .from("playdate_invites")
            .select("household_id")
            .eq("playdate_id", top.pd.id)
            .limit(1);
          if (invs && invs[0]) {
            const { data: gMembers } = await supabase
              .from("household_members")
              .select("parents(name)")
              .eq("household_id", invs[0].household_id);
            const names = (gMembers || []).map((m) => m.parents?.name).filter(Boolean).map(shortName);
            withLabel._otherLabel = names.join(" & ");
          }
        }
        setNextPlaydate(withLabel);
      } else {
        setNextPlaydate(null);
      }
    } catch (e) {
      setNextPlaydate(null);
    }

    try {
      const { data: conns } = await supabase
        .from("connections")
        .select("requester_id, recipient_id, status")
        .or(`requester_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`);
      const connected = new Set();
      const pending = new Set();
      let acceptedCount = 0;
      for (const c of (conns || [])) {
        const otherId = c.requester_id === session.user.id ? c.recipient_id : c.requester_id;
        if (c.status === "accepted") { connected.add(otherId); acceptedCount++; }
        else if (c.status === "pending") { pending.add(otherId); }
      }
      setConnectedIds(connected);
      setPendingIds(pending);
      setStatConnections(acceptedCount);
    } catch (e) {
      setStatConnections(0);
    }

    setLoading(false);
  };

  const loadTeachersForSchool = async (schoolId) => {
    const { data } = await supabase.from("classrooms").select("teacher_name").eq("school_id", schoolId).limit(50);
    const unique = [...new Set((data || []).map(c => c.teacher_name).filter(Boolean))];
    setNewTeacherResults(unique);
  };

  const openAddClassroomToSchool = async (school) => {
    setScopedSchool({ id: school.id, name: school.name });
    setNewGrade("");
    setNewTeacher("");
    setNewSchoolSearch(school.name);
    setNewSelectedSchool(school);
    setNewSchoolResults([]);
    setShowNewSchoolDropdown(false);
    setShowNewTeacherDropdown(false);
    setMembershipError("");
    setNewTeacherResults([]);
    setGradeConflict(null);
    setAddingClassroom(true);
    await loadTeachersForSchool(school.id);
  };

  const openAddDifferentSchool = () => {
    setScopedSchool(null);
    setNewGrade("");
    setNewTeacher("");
    setNewSchoolSearch("");
    setNewSelectedSchool(null);
    setNewSchoolResults([]);
    setNewTeacherResults([]);
    setShowNewSchoolDropdown(false);
    setShowNewTeacherDropdown(false);
    setMembershipError("");
    setAddingClassroom(true);
  };

  const closeAddClassroom = () => {
    setAddingClassroom(false);
    setScopedSchool(null);
    setGradeConflict(null);
    setNewGrade("");
    setNewTeacher("");
    setNewSchoolSearch("");
    setNewSelectedSchool(null);
    setNewTeacherResults([]);
    setShowNewSchoolDropdown(false);
    setShowNewTeacherDropdown(false);
  };

  const searchNewSchools = async (query) => {
    setNewSchoolSearch(query);
    setNewSelectedSchool(null);
    setNewTeacherResults([]);
    setNewTeacher("");
    if (query.length < 2) { setNewSchoolResults([]); setShowNewSchoolDropdown(false); return; }
    const noise = /\b(elementary|elem|school|academy|the|of|charter|primary|middle|high|k-?8|stem)\b/gi;
    const core = query.toLowerCase().replace(noise, "").replace(/[^a-z0-9 ]/g, "").trim();
    const terms = core.split(/\s+/).filter((t) => t.length >= 2);
    const { data } = await supabase
      .from("schools").select("*")
      .ilike("name", `%${(terms[0] || query).slice(0, 20)}%`).limit(25);
    let ranked = (data || []);
    if (terms.length > 0) {
      ranked = ranked
        .map((s) => ({ s, hits: terms.filter((t) => (s.name || "").toLowerCase().includes(t)).length }))
        .filter((r) => r.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .map((r) => r.s);
    }
    setNewSchoolResults(ranked.slice(0, 6));
    setShowNewSchoolDropdown(true);
  };

  const selectNewSchool = async (school) => {
    setNewSelectedSchool(school);
    setNewSchoolSearch(school.name);
    setShowNewSchoolDropdown(false);
    await loadTeachersForSchool(school.id);
  };

  const normTeacher = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

  const editDistance = (a, b) => {
    a = a || ""; b = b || "";
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  };

  const exactTeacherMatch = (() => {
    const typed = normTeacher(newTeacher);
    if (!typed) return null;
    return newTeacherResults.find((t) => normTeacher(t) === typed) || null;
  })();

  const nearTeacherMatch = (() => {
    const typed = normTeacher(newTeacher);
    if (!typed || exactTeacherMatch) return null;
    let best = null;
    let bestScore = Infinity;
    for (const t of newTeacherResults) {
      const cand = normTeacher(t);
      if (!cand) continue;
      const contains = cand.includes(typed) || typed.includes(cand);
      const dist = editDistance(typed, cand);
      const threshold = Math.max(2, Math.floor(Math.min(typed.length, cand.length) * 0.34));
      if (contains || dist <= threshold) {
        if (dist < bestScore) { bestScore = dist; best = t; }
      }
    }
    return best;
  })();

  const isBrandNewTeacher = newTeacher.trim().length > 0 && !exactTeacherMatch && !nearTeacherMatch;

  // One-tap warm action: notify a family that someone wished them a happy birthday.
  const wishHappyBirthday = async (b) => {
    if (b.isMine || wishBusy) return;
    setWishBusy(b.id);
    try {
      // Who are the parents in that household? (best-effort — notify each.)
      const { data: members } = await supabase
        .from("household_members")
        .select("parent_id")
        .eq("household_id", b.household_id);

      const myFirst = parent?.name ? parent.name.trim().split(/\s+/)[0] : "A family";
      const rows = (members || []).map((m) => ({
        recipient_id: m.parent_id,
        actor_id: session.user.id,
        type: "birthday_wish",
        title: "Someone wished you a happy birthday 🎂",
        body: `${myFirst}'s family sent your family birthday wishes!`,
      }));
      if (rows.length > 0) {
        await supabase.from("notifications").insert(rows);
      }

      // Persist the wish so "Sent 🎉" sticks across refreshes/sessions.
      try {
        await supabase.from("birthday_wishes").insert({
          birthday_id: b.id,
          wisher_id: session.user.id,
          target_household_id: b.household_id,
          year: new Date().getFullYear(),
        });
      } catch (persistErr) {
        // If it's a duplicate (already wished), that's fine — treat as sent.
      }

      setWishedIds((prev) => ({ ...prev, [b.id]: true }));
    } catch (e) {
      // Best-effort.
    }
    setWishBusy(null);
  };

  const commitClassroom = async (school, schoolYear, joinClassroomId, gradeIdx, teacherName) => {
    let classroom = null;
    if (joinClassroomId) {
      classroom = { id: joinClassroomId };
    } else {
      const cleanTeacher = teacherName.trim().replace(/\s+/g, " ");
      const { data: newClassroom, error: classroomErr } = await supabase.from("classrooms")
        .insert({ school_id: school.id, teacher_name: cleanTeacher, grade: gradeIdx, school_year: schoolYear })
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

    setGradeConflict(null);
    closeAddClassroom();
    fetchData();
  };

  const saveNewClassroom = async () => {
    setSavingMembership(true);
    setMembershipError("");
    try {
      let school;
      if (scopedSchool) {
        school = { id: scopedSchool.id, name: scopedSchool.name };
      } else if (newSelectedSchool) {
        school = newSelectedSchool;
      } else {
        const code = newSchoolSearch.toUpperCase().replace(/\s+/g, "").slice(0, 10) + Date.now().toString().slice(-4);
        const { data: newSchool, error: schoolErr } = await supabase.from("schools")
          .insert({ name: newSchoolSearch, activation_code: code }).select().single();
        if (schoolErr) throw schoolErr;
        school = newSchool;
      }

      const schoolYear = currentSchoolYear();
      const gradeIdx = grades.indexOf(newGrade);

      const typedNorm = newTeacher.trim().replace(/\s+/g, " ").toLowerCase();
      const { data: schoolClassrooms } = await supabase.from("classrooms")
        .select("id, teacher_name, grade, school_year")
        .eq("school_id", school.id)
        .eq("school_year", schoolYear);

      const sameTeacher = (schoolClassrooms || []).filter(
        (c) => (c.teacher_name || "").trim().replace(/\s+/g, " ").toLowerCase() === typedNorm
      );

      const exact = sameTeacher.find((c) => c.grade === gradeIdx);
      if (exact) {
        await commitClassroom(school, schoolYear, exact.id, gradeIdx, newTeacher);
        setSavingMembership(false);
        return;
      }

      if (sameTeacher.length > 0) {
        setGradeConflict({
          school,
          schoolYear,
          gradeIdx,
          teacherName: newTeacher.trim().replace(/\s+/g, " "),
          existing: sameTeacher
            .slice()
            .sort((a, b) => a.grade - b.grade)
            .map((c) => ({ id: c.id, grade: c.grade })),
        });
        setSavingMembership(false);
        return;
      }

      await commitClassroom(school, schoolYear, null, gradeIdx, newTeacher);
    } catch (err) { setMembershipError(err.message); }
    setSavingMembership(false);
  };

  const doLeaveClassroom = async (membershipRow) => {
    setHouseholdBusy(true);
    setDrillMessage("");
    try {
      const { error } = await supabase
        .from("classroom_members")
        .delete()
        .eq("id", membershipRow.id);
      if (error) throw error;
      setSelectedClassroom(null);
      fetchData();
    } catch (err) {
      setDrillMessage("Couldn't leave the classroom: " + err.message);
    }
    setHouseholdBusy(false);
  };

  const leaveClassroom = (membershipRow) => {
    const label = `${membershipRow.classrooms?.teacher_name} · ${getGradeLabel(membershipRow.classrooms?.grade)}`;
    setConfirm({
      title: "Leave this classroom?",
      body: `You'll leave ${label} and stop seeing the families in it. You can rejoin anytime.`,
      confirmLabel: "Leave",
      cancelLabel: "Stay",
      tone: "danger",
      onConfirm: () => doLeaveClassroom(membershipRow),
    });
  };

  const connectTo = async (parentId) => {
    if (!parentId || connectBusy) return;
    setConnectBusy(parentId);
    try {
      const { error } = await supabase.from("connections").insert({
        requester_id: session.user.id,
        recipient_id: parentId,
        status: "pending",
      });
      if (!error) {
        setPendingIds((prev) => new Set([...prev, parentId]));
      }
    } catch (e) { /* best-effort */ }
    setConnectBusy(null);
  };

  const familyCardsFor = (membershipRow) => {
    const group = classmates[membershipRow.id];
    const cards = [];
    (group?.rows || []).forEach((cm) => {
      const members = cm.households?.household_members || [];
      members.forEach((hm) => {
        if (!hm.parents) return;
        cards.push({ key: `${cm.id}-${hm.parent_id}`, parents: hm.parents, householdId: cm.household_id });
      });
    });
    return cards;
  };

  // Archive logic: hide last-year classrooms that have been rolled up (a
  // current-year membership exists at the same school, one grade higher).
  // Deferred last-year classrooms (no new-year replacement yet) stay visible.
  const _startMonths = memberships
    .map((m) => m.classrooms?.schools?.school_start_month)
    .filter((n) => typeof n === "number");
  const _startMonth = earliestStartMonth(_startMonths);
  const _curYear = currentSchoolYear(_startMonth);
  const _currentYearMemberships = memberships.filter((m) => m.school_year === _curYear);
  const isSuperseded = (m) => {
    if (m.school_year === _curYear) return false;
    const schoolId = m.classrooms?.schools?.id;
    const nextGrade = (typeof m.classrooms?.grade === "number" ? m.classrooms.grade : -99) + 1;
    return _currentYearMemberships.some(
      (cm) => cm.classrooms?.schools?.id === schoolId && cm.classrooms?.grade === nextGrade
    );
  };
  const visibleMemberships = memberships.filter((m) => !isSuperseded(m));
  const archivedCount = memberships.length - visibleMemberships.length;

  const membershipsBySchool = visibleMemberships.reduce((acc, m) => {
    const schoolName = m.classrooms?.schools?.name || "Unknown School";
    const schoolId = m.classrooms?.schools?.id || null;
    const schoolKey = schoolName.toLowerCase().replace(/\s+/g, "-");
    if (!acc[schoolKey]) acc[schoolKey] = { name: schoolName, id: schoolId, classrooms: [] };
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

  if (requestingPlaydate) {
    return (
      <PlaydateRequest session={session} recipient={requestingPlaydate} eventType={requestEventType}
        onBack={() => { setRequestingPlaydate(null); setRequestEventType("playdate"); }}
        onSent={() => {
          setRequestingPlaydate(null);
          setRequestEventType("playdate");
          if (typeof onPlaydateCreated === "function") onPlaydateCreated();
        }} />
    );
  }

  const headerBar = (
    <TopBar
      isHome
      notificationCount={notificationCount}
      onBellClick={onBellClick}
      onSearchClick={onSearchClick}
      onProfileClick={onProfileClick}
      onLogoClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      avatarUrl={parent?.photo_url}
      initial={parent?.name?.charAt(0) || "?"}
    />
  );

  const addClassroomModal = addingClassroom && (
    <div style={overlay}>
      <div style={modalBox}>
        {gradeConflict ? (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.75rem" }}>
              {gradeConflict.teacherName} already teaches here
            </h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 1rem", lineHeight: "1.5" }}>
              A teacher named “{gradeConflict.teacherName}” is already set up at {gradeConflict.school.name} for{" "}
              {gradeConflict.existing.map((e, i) => (
                <span key={e.id}>
                  <strong style={{ color: "#FFFFFF" }}>{getGradeLabel(e.grade)}</strong>
                  {i < gradeConflict.existing.length - 1 ? (i === gradeConflict.existing.length - 2 ? " and " : ", ") : ""}
                </span>
              ))}
              . You're adding <strong style={{ color: "#FFFFFF" }}>{getGradeLabel(gradeConflict.gradeIdx)}</strong>.
            </p>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
              Is this the same teacher in a different grade, or a different teacher who happens to have the same name?
            </p>

            {membershipError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{membershipError}</p>}

            {gradeConflict.existing.map((e) => (
              <Button key={e.id} fullWidth variant="secondary" disabled={savingMembership}
                onClick={async () => {
                  setSavingMembership(true); setMembershipError("");
                  try { await commitClassroom(gradeConflict.school, gradeConflict.schoolYear, e.id, e.grade, gradeConflict.teacherName); }
                  catch (err) { setMembershipError(err.message); }
                  setSavingMembership(false);
                }}
                style={{ border: "1px solid #02C39A", background: "#0F3D2E", color: "#02C39A", marginBottom: "0.6rem" }}>
                Join {getGradeLabel(e.grade)} — same teacher, existing class
              </Button>
            ))}

            <Button fullWidth variant="secondary" disabled={savingMembership}
              onClick={async () => {
                setSavingMembership(true); setMembershipError("");
                try { await commitClassroom(gradeConflict.school, gradeConflict.schoolYear, null, gradeConflict.gradeIdx, gradeConflict.teacherName); }
                catch (err) { setMembershipError(err.message); }
                setSavingMembership(false);
              }}
              style={{ color: "#FFFFFF", marginBottom: "0.6rem" }}>
              Add {getGradeLabel(gradeConflict.gradeIdx)} anyway
            </Button>

            <button onClick={() => setGradeConflict(null)} disabled={savingMembership}
              style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "none", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer", minHeight: "44px" }}>
              <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back
            </button>
          </>
        ) : (
        <>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>
          {scopedSchool ? "Add a classroom" : "Add a school or classroom"}
        </h2>

        {scopedSchool ? (
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", borderRadius: "10px", background: "#1A3A5C", border: "1px solid #2A4A6B" }}>
              <Icon name="school" size={20} color="#B8CCE0" />
              <span style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500" }}>{scopedSchool.name}</span>
            </div>
          </div>
        ) : (
          <>
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
                      <Icon name="school" size={18} color="#B8CCE0" style={{ verticalAlign: "-3px", marginRight: 4 }} />{school.name}
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
                <span style={{ color: "#02C39A", fontSize: "0.85rem" }}><Icon name="check" size={16} color="#02C39A" style={{ verticalAlign: "-2px", marginRight: 2 }} />{newSelectedSchool.name}</span>
              </div>
            )}
          </>
        )}

        <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
        <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)} style={inputStyle}>
          <option value="">Select grade...</option>
          {grades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
        <div style={{ position: "relative", marginBottom: "0.5rem" }}>
          <input type="text"
            placeholder={newTeacherResults.length > 0 ? "Select or type teacher name..." : "Mrs. Johnson"}
            value={newTeacher}
            onChange={(e) => { setNewTeacher(e.target.value); setShowNewTeacherDropdown(e.target.value.length > 0); }}
            onFocus={() => { if (newTeacherResults.length > 0) setShowNewTeacherDropdown(true); }}
            style={{ ...inputStyle, marginBottom: 0, borderColor: "#2A4A6B" }} />
          {showNewTeacherDropdown && newTeacherResults.filter(t => normTeacher(t).includes(normTeacher(newTeacher))).length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
              {newTeacherResults.filter(t => normTeacher(t).includes(normTeacher(newTeacher))).map(teacher => (
                <div key={teacher} onClick={() => { setNewTeacher(teacher); setShowNewTeacherDropdown(false); }}
                  style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                  <Icon name="menu_book" size={18} color="#B8CCE0" style={{ verticalAlign: "-3px", marginRight: 4 }} />{teacher}
                </div>
              ))}
            </div>
          )}
        </div>

        {nearTeacherMatch && (
          <div style={{ background: "#13314F", border: "1px solid #2A4A6B", borderRadius: "8px", padding: "0.6rem 0.75rem", marginBottom: "1rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.5rem", lineHeight: "1.4" }}>
              Did you mean an existing teacher? Pick one to join the same class, or keep your spelling to add a new teacher.
            </p>
            <Button variant="secondary" size="sm" onClick={() => { setNewTeacher(nearTeacherMatch); setShowNewTeacherDropdown(false); }}
              style={{ background: "#0F3D2E", border: "1px solid #02C39A", color: "#02C39A" }}>
              <Icon name="menu_book" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Use "{nearTeacherMatch}"
            </Button>
          </div>
        )}

        {isBrandNewTeacher && (
          <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 1rem", lineHeight: "1.4" }}>
            New teacher — “{newTeacher.trim()}” will be added{scopedSchool ? ` to ${scopedSchool.name}` : ""}.
          </p>
        )}

        {membershipError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{membershipError}</p>}
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={closeAddClassroom} style={{ flex: 1 }}>Cancel</Button>
          <Button variant="primary" onClick={saveNewClassroom} disabled={!newGrade || (!scopedSchool && !newSchoolSearch) || !newTeacher || savingMembership}
            style={{ flex: 2 }}>
            {savingMembership ? "Saving..." : "Add classroom →"}
          </Button>
        </div>
        </>
        )}
      </div>
    </div>
  );

  if (showBirthdayList) {
    const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const now = new Date();
    const monthName = MONTH_NAMES[now.getMonth()];
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
          <button onClick={() => setShowBirthdayList(false)} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}><Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back</button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>🎂 Birthdays coming up</h1>
          <div style={{ width: "60px" }} />
        </div>

        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          {monthBirthdays.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
              <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🎂</p>
              <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No birthdays coming up</p>
              <p style={{ color: "#607080", fontSize: "0.85rem" }}>When families in your classrooms add birthdays, they'll show up here.</p>
            </div>
          ) : (
            <>
              <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 1rem", lineHeight: "1.5" }}>
                Families in your classrooms and connections with a birthday in the next 45 days.
              </p>
              {monthBirthdays.map((b) => (
                <div key={b.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "#2A1E3D", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: "1.1rem", fontWeight: "700", color: "#C9A9FF" }}>{b.day}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>
                      {b.isMine ? "Your family" : b.familyLabel}
                      {b.label ? <span style={{ color: "#C9A9FF" }}> · {b.label}</span> : null}
                    </p>
                    <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>{monthName} {b.day}</p>
                  </div>
                  {!b.isMine && (
                    wishedIds[b.id] ? (
                      <span style={{ color: "#02C39A", fontSize: "0.8rem", fontWeight: "600", flexShrink: 0 }}>Sent 🎉</span>
                    ) : (
                      <button onClick={() => wishHappyBirthday(b)} disabled={wishBusy === b.id}
                        style={{ background: "#7C5CBF", border: "none", color: "#FFFFFF", fontSize: "0.8rem", fontWeight: "600", padding: "0.45rem 0.85rem", borderRadius: "8px", cursor: "pointer", minHeight: "36px", flexShrink: 0 }}>
                        {wishBusy === b.id ? "..." : "Wish 🎂"}
                      </button>
                    )
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  if (selectedClassroom) {
    const m = selectedClassroom;
    const cards = familyCardsFor(m);
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        {headerBar}
        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          <button onClick={() => { setSelectedClassroom(null); setDrillMessage(""); }}
            style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "0.95rem", cursor: "pointer", padding: "0 0 1rem", display: "flex", alignItems: "center", gap: "6px" }}>
            <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back to classrooms
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", background: "#1A3A5C", borderRadius: "10px", marginBottom: "1.25rem" }}>
            <Icon name="menu_book" size={22} color="#B8CCE0" />
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: "0 0 2px" }}>
                {m.classrooms?.teacher_name} · {getGradeLabel(m.classrooms?.grade)}
              </p>
              <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>{m.classrooms?.schools?.name}</p>
            </div>
          </div>

          {drillMessage && (
            <div style={{ background: "#3D1515", border: "1px solid #F87171", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
              <p style={{ color: "#F87171", fontSize: "0.85rem", margin: 0 }}>{drillMessage}</p>
            </div>
          )}

          <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>
            FAMILIES IN THIS CLASS
          </p>

          {cards.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", marginBottom: "1rem" }}>
              <p style={{ margin: "0 0 1rem" }}><Icon name="waving_hand" size={44} color="#3E5A7F" /></p>
              <p style={{ color: "#FFFFFF", fontSize: "1.05rem", margin: "0 0 0.5rem" }}>No other families here yet</p>
              <p style={{ color: "#607080", fontSize: "0.9rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
                Invite a parent from this class to Huddle — once they join, you can set up playdates.
              </p>
            </div>
          ) : (
            cards.map((card) => (
              <div key={card.key} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0, overflow: "hidden" }}>
                    {card.parents?.photo_url ? (
                      <img src={card.parents.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : card.parents?.name?.charAt(0) || "?"}
                  </div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: 0, display: "flex", alignItems: "center" }}>
                    {shortName(card.parents?.name)}{petBadges(card.householdId)}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
                  {connectedIds.has(card.parents?.id) ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#02C39A", fontSize: "0.78rem", fontWeight: "600", padding: "0 6px" }}>
                      <Icon name="check_circle" size={15} color="#02C39A" />Connected
                    </span>
                  ) : pendingIds.has(card.parents?.id) ? (
                    <span style={{ color: "#8AAEC8", fontSize: "0.78rem", fontWeight: "600", padding: "0 6px" }}>
                      Requested
                    </span>
                  ) : (
                    <Button variant="accent" size="sm" title="Connect with this family"
                      onClick={() => connectTo(card.parents?.id)} disabled={connectBusy === card.parents?.id}>
                      {connectBusy === card.parents?.id ? "..." : "Connect"}
                    </Button>
                  )}
                  <Button variant="primary" size="sm"
                    onClick={() => { setRequestEventType("playdate"); setRequestingPlaydate(card.parents); }}>
                    Huddle →
                  </Button>
                </div>
              </div>
            ))
          )}

          <Button fullWidth onClick={() => setInviting(true)}
            style={{ border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", borderRadius: "12px", marginTop: "1rem" }}>
            <Icon name="add" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Invite a parent to Huddle
          </Button>

          <button onClick={() => leaveClassroom(m)} disabled={householdBusy}
            style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#607080", fontSize: "0.8rem", cursor: "pointer", marginTop: "1.5rem", minHeight: "44px" }}>
            Leave this classroom
          </button>
        </div>

        {inviting && (
          <InviteFamily session={session} inviterName={parent?.name} onClose={() => setInviting(false)} />
        )}

        <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px", animation: "huddleFadeInUp 340ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
      {headerBar}

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        <div style={{ marginBottom: "1.25rem" }}>
          <p style={{ color: "#607080", fontSize: "0.8rem", margin: "0 0 2px" }}>{todayLabel()}</p>
          <h2 style={{ color: "#FFFFFF", fontSize: "1.4rem", fontWeight: "600", margin: 0, letterSpacing: "-0.02em" }}>
            {greeting()}, {parent?.name?.split(" ")[0] || "there"}
          </h2>
        </div>

        {nextPlaydate ? (
          <div onClick={() => typeof onGoToPlaydates === "function" && onGoToPlaydates()}
            style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "14px", padding: "1.1rem 1.25rem", marginBottom: "1.5rem", cursor: "pointer" }}>
            <p style={{ color: "#02C39A", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: "600", margin: "0 0 6px" }}>
              {nextPlaydate._role === "hosting" ? "YOU'RE HOSTING" : "NEXT PLAYDATE"}
            </p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "600", margin: "0 0 3px" }}>
              <Icon name="calendar_month" size={18} color="#02C39A" style={{ verticalAlign: "-3px", marginRight: 4 }} />{fmtPlaydate(nextPlaydate.proposed_date)}
            </p>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>
              <Icon name="location_on" size={18} color="#8AAEC8" style={{ verticalAlign: "-3px", marginRight: 4 }} />{nextPlaydate.location_name}{nextPlaydate._otherLabel ? ` · with ${nextPlaydate._otherLabel}` : ""}
            </p>
          </div>
        ) : (
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "14px", padding: "1.1rem 1.25rem", marginBottom: "1.5rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: 0 }}>
              📅 No playdates coming up — tap <span style={{ color: "#02C39A", fontWeight: "600" }}>Huddle →</span> next to a family below to set one up.
            </p>
          </div>
        )}

        {upcomingBirthdays.length > 0 && (
          <div style={{ background: "#2A1E3D", border: "1px solid #7C5CBF", borderRadius: "14px", padding: "1.1rem 1.25rem", marginBottom: "1.5rem" }}>
            <p style={{ color: "#C9A9FF", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: "600", margin: "0 0 10px" }}>
              🎂 BIRTHDAYS THIS WEEK
            </p>
            {upcomingBirthdays.map((b) => {
              const whenLabel = b.daysUntil === 0 ? "Today!" : b.daysUntil === 1 ? "Tomorrow" : `In ${b.daysUntil} days`;
              return (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.5rem 0", borderTop: "1px solid #3D2E52" }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 1px" }}>
                      {b.isMine ? "Your family" : b.familyLabel}
                      {b.label ? <span style={{ color: "#C9A9FF" }}> · {b.label}</span> : null}
                    </p>
                    <p style={{ color: "#A88FD0", fontSize: "0.8rem", margin: 0 }}>{whenLabel}</p>
                  </div>
                  {!b.isMine && (
                    wishedIds[b.id] ? (
                      <span style={{ color: "#02C39A", fontSize: "0.8rem", fontWeight: "600" }}>Sent 🎉</span>
                    ) : (
                      <button onClick={() => wishHappyBirthday(b)} disabled={wishBusy === b.id}
                        style={{ background: "#7C5CBF", border: "none", color: "#FFFFFF", fontSize: "0.8rem", fontWeight: "600", padding: "0.45rem 0.85rem", borderRadius: "8px", cursor: "pointer", minHeight: "36px", flexShrink: 0 }}>
                        {wishBusy === b.id ? "..." : "Wish 🎂"}
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(() => {
          const familiesAtSchool = new Set(
            Object.values(classmates).flatMap((g) =>
              (g?.rows || []).map((cm) => cm.household_id)
            ).filter(Boolean)
          ).size;
          const tiles = [
            { label: "Connections", value: statConnections, go: onGoToNetwork },
            { label: "Families at your school", value: familiesAtSchool, go: null },
            { label: "Upcoming playdates", value: statUpcoming, go: onGoToPlaydates },
            { label: "Birthdays coming up", value: statBirthdaysMonth, go: () => setShowBirthdayList(true), highlight: hasUpcomingBirthdayEvent, tag: birthdayEventTag },
          ];
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", marginBottom: "1.5rem" }}>
              {tiles.map((t) => (
                <div key={t.label}
                  onClick={() => t.go && t.go()}
                  style={{
                    background: t.highlight ? "#0F3D2E" : "#162D50",
                    border: t.highlight ? "2px solid #02C39A" : "1px solid #2A4A6B",
                    borderRadius: "12px", padding: "0.9rem 0.5rem", textAlign: "center",
                    cursor: t.go ? "pointer" : "default",
                    boxShadow: t.highlight ? "0 0 12px rgba(2, 195, 154, 0.35)" : "none",
                  }}>
                  <p style={{ color: "#02C39A", fontSize: "1.6rem", fontWeight: "700", margin: "0 0 2px" }}>{t.value}</p>
                  <p style={{ color: t.highlight ? "#02C39A" : "#8AAEC8", fontSize: "0.68rem", margin: 0, lineHeight: "1.25", fontWeight: t.highlight ? "600" : "400" }}>{t.label}</p>
                  {t.highlight && t.tag ? (
                    <span style={{ display: "inline-block", marginTop: "5px", background: "#02C39A", color: "#0F2044", fontSize: "0.6rem", fontWeight: "700", padding: "2px 8px", borderRadius: "999px", letterSpacing: "0.02em" }}>{t.tag}</span>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })()}

        {memberships.length > 0 && (
          <p style={{ color: "#8AAEC8", fontSize: "0.8rem", letterSpacing: "0.05em", margin: "0 0 0.75rem" }}>YOUR SCHOOLS</p>
        )}

        {Object.entries(membershipsBySchool).map(([schoolKey, school]) => (
          <div key={schoolKey} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", background: "#1A3A5C", borderRadius: "10px 10px 0 0", borderBottom: "2px solid #02C39A" }}>
              <Icon name="school" size={22} color="#B8CCE0" />
              <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: 0 }}>{school.name}</p>
            </div>
            <div style={{ background: "#162D50", borderRadius: "0 0 12px 12px", border: "1px solid #2A4A6B", borderTop: "none", overflow: "hidden" }}>
              {school.classrooms.map((m, idx) => {
                const familyCount = familyCardsFor(m).length;
                return (
                  <div key={m.id} onClick={() => setSelectedClassroom(m)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "1rem", cursor: "pointer", borderBottom: idx < school.classrooms.length - 1 ? "1px solid #2A4A6B" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Icon name="menu_book" size={20} color="#B8CCE0" />
                      <div>
                        <p style={{ color: "#FFFFFF", fontSize: "0.95rem", margin: "0 0 2px", fontWeight: "500" }}>
                          {m.classrooms?.teacher_name} · {getGradeLabel(m.classrooms?.grade)}
                        </p>
                        <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                          {familyCount} {familyCount === 1 ? "family" : "families"} to huddle with
                        </p>
                      </div>
                    </div>
                    <span style={{ color: "#02C39A", fontSize: "1.2rem" }}>›</span>
                  </div>
                );
              })}
              <div onClick={() => openAddClassroomToSchool({ id: school.id, name: school.name })} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", cursor: "pointer", borderTop: "1px dashed #2A4A6B" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "1px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", color: "#607080", fontSize: "1rem" }}>+</div>
                <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Add another classroom</p>
              </div>
            </div>
          </div>
        ))}

        {memberships.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem 1rem", marginBottom: "1rem" }}>
            <p style={{ margin: "0 0 1rem" }}><Icon name="school" size={44} color="#3E5A7F" /></p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Add your kid's classroom</p>
            <p style={{ color: "#607080", fontSize: "0.9rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
              Add your school and classroom to find other families to huddle with.
            </p>
            <Button variant="primary" onClick={openAddDifferentSchool}>
              <Icon name="add" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Add a classroom
            </Button>
          </div>
        )}

        {memberships.length > 0 && (
          <div onClick={() => { if (typeof onOpenJourney === "function") onOpenJourney(); }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0.85rem", borderRadius: "12px", border: "1px solid #22355A", background: "#132840", color: "#B8CCE0", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem" }}>
            🌱 Your Huddle journey{archivedCount > 0 ? ` · ${archivedCount} past ${archivedCount === 1 ? "classroom" : "classrooms"}` : ""}
          </div>
        )}

        {memberships.length > 0 && (
          <Button fullWidth variant="secondary" onClick={openAddDifferentSchool}
            style={{ background: "#162D50", borderRadius: "12px", marginBottom: "0.75rem" }}>
            <Icon name="school" size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />Add a different school
          </Button>
        )}

        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <span onClick={() => setInviting(true)}
            style={{ color: "#607080", fontSize: "0.82rem", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px" }}>
            Know a parent who isn't on Huddle? Invite them
          </span>
        </div>
      </div>

      {inviting && (
        <InviteFamily session={session} inviterName={parent?.name} onClose={() => setInviting(false)} />
      )}

      {addClassroomModal}

      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}