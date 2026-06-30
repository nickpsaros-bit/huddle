import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ProfileScreen from "./ProfileScreen";
import PlaydateRequest from "./PlaydateRequest";
import InviteFamily from "./InviteFamily";
import ConfirmModal from "./ConfirmModal";

export default function Home({ session, notificationCount, onBellClick, onPlaydateCreated, onGoToPlaydates, onGoToNetwork }) {
  const [parent, setParent] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [classmates, setClassmates] = useState({});
  const [petsByHousehold, setPetsByHousehold] = useState({});
  const [nextPlaydate, setNextPlaydate] = useState(null);
  const [statConnections, setStatConnections] = useState(0);
  const [statUpcoming, setStatUpcoming] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [addingClassroom, setAddingClassroom] = useState(false);
  const [scopedSchool, setScopedSchool] = useState(null); // { id, name } when adding within a school card; null = full picker
  // Teacher/grade conflict step: when the typed teacher already exists at this
  // school under different grade(s), we pause to ask "same teacher, or different
  // person with the same name?" { school, schoolYear, existing: [{id,grade}], typedGrade }
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

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

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

  // Relative time for the activity feed ("2h ago", "3d ago").
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

  // Icon + accent for each activity (notification) type.
  const activityStyle = (type) => {
    switch (type) {
      case "playdate_invite": return { icon: "🎉", bg: "#13314F", color: "#8AAEC8" };
      case "playdate_rsvp": return { icon: "✅", bg: "#0F3D2E", color: "#02C39A" };
      case "playdate_cancelled": return { icon: "❌", bg: "#3D1515", color: "#F87171" };
      case "invite_accepted": return { icon: "👋", bg: "#13314F", color: "#8AAEC8" };
      default: return { icon: "🔔", bg: "#13233F", color: "#8AAEC8" };
    }
  };

  // Small inline pet badges for a household (🐕🐈🐴🐾). Returns null if none set.
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

    const { data: membershipData } = await supabase
      .from("classroom_members")
      .select("*, classrooms(id, teacher_name, grade, school_year, schools(id, name))")
      .eq("household_id", hhId);
    setMemberships(membershipData || []);

    const classmatesMap = {};
    const otherHouseholdIds = new Set();
    for (const m of (membershipData || [])) {
      const { data: otherMembers } = await supabase
        .from("classroom_members")
        .select("*, households(id, household_members(parent_id, parents(id, name, photo_url)))")
        .eq("classroom_id", m.classroom_id)
        .eq("school_year", m.school_year)
        .neq("household_id", hhId);
      classmatesMap[m.id] = {
        classroomLabel: `${m.classrooms?.teacher_name} · ${grades[m.classrooms?.grade] || "Unknown grade"}`,
        rows: otherMembers || [],
      };
      for (const cm of (otherMembers || [])) {
        if (cm.household_id) otherHouseholdIds.add(cm.household_id);
      }
    }
    setClassmates(classmatesMap);

    // Batch-fetch pet preferences for ALL the households shown (one query).
    if (otherHouseholdIds.size > 0) {
      const { data: prefs } = await supabase
        .from("household_preferences")
        .select("household_id, has_dog, has_cat, has_horse, has_other, other_label")
        .in("household_id", [...otherHouseholdIds]);
      const map = {};
      for (const row of (prefs || [])) map[row.household_id] = row;
      setPetsByHousehold(map);
    }

    // ---- NEXT PLAYDATE (soonest upcoming I'm hosting or invited to & not declined) ----
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

   candidates.sort((a, b) => new Date(a.pd.proposed_date) - new Date(b.pd.proposed_date));
      setStatUpcoming(candidates.length);
      if (candidates.length > 0) {
        const top = candidates[0];
        let withLabel = { ...top.pd, _role: top.role, _otherLabel: "" };
        // Who's it with? (organizer if invited; first guest if hosting)
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

    // ---- RECENT ACTIVITY (last 5 notifications) ----
 // ---- STAT TILES: connections count ----
    try {
      const { data: conns } = await supabase
        .from("connections")
        .select("id")
        .or(`requester_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`)
        .eq("status", "accepted");
      setStatConnections((conns || []).length);
    } catch (e) {
      setStatConnections(0);
    }

    setLoading(false);
  };

  // Load the teachers already at a given school (for the teacher autocomplete).
  const loadTeachersForSchool = async (schoolId) => {
    const { data } = await supabase.from("classrooms").select("teacher_name").eq("school_id", schoolId).limit(50);
    const unique = [...new Set((data || []).map(c => c.teacher_name).filter(Boolean))];
    setNewTeacherResults(unique);
  };

  // Open the modal SCOPED to an existing school (from inside that school's card).
  // School is locked; only grade + teacher are entered. Teachers pre-suggested.
  const openAddClassroomToSchool = async (school) => {
    // school: { id, name }
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

  // Open the modal UNSCOPED (full school picker) — "Add a different school".
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
    const { data } = await supabase.from("schools").select("*").ilike("name", `%${query}%`).limit(5);
    setNewSchoolResults(data || []);
    setShowNewSchoolDropdown(true);
  };

  const selectNewSchool = async (school) => {
    setNewSelectedSchool(school);
    setNewSchoolSearch(school.name);
    setShowNewSchoolDropdown(false);
    await loadTeachersForSchool(school.id);
  };

  // Normalize a teacher name for matching only (trim, collapse spaces, lowercase).
  // Display always uses the original casing.
  const normTeacher = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

  // Tiny edit-distance (Levenshtein) for near-match detection.
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

  // Is the typed name an EXACT (normalized) match to an existing teacher? Returns
  // the canonical existing name (original casing) if so, else null.
  const exactTeacherMatch = (() => {
    const typed = normTeacher(newTeacher);
    if (!typed) return null;
    return newTeacherResults.find((t) => normTeacher(t) === typed) || null;
  })();

  // The closest existing teacher that is NOT an exact match but is "near" — a
  // likely typo or title variant (one contains the other, or small edit distance).
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
      // Treat as near if one contains the other, or the edit distance is small
      // relative to length (catches "hopkin" vs "hopkins", "mrs hopkins" vs "hopkins").
      const threshold = Math.max(2, Math.floor(Math.min(typed.length, cand.length) * 0.34));
      if (contains || dist <= threshold) {
        if (dist < bestScore) { bestScore = dist; best = t; }
      }
    }
    return best;
  })();

  // True only when the typed name matches nothing at all (brand-new teacher).
  const isBrandNewTeacher = newTeacher.trim().length > 0 && !exactTeacherMatch && !nearTeacherMatch;

  // Does the actual classroom find-or-create + membership insert, given a
  // resolved school + the exact classroom id to join (or null to create at
  // gradeIdx). Used by both the normal save and the conflict-resolution buttons.
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
        // Locked to the card's school — never create a new school here.
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

      const currentYear = new Date().getFullYear();
      const schoolYear = `${currentYear}-${currentYear + 1}`;
      const gradeIdx = grades.indexOf(newGrade);

      // Fetch this school+year's classrooms and find any under the SAME teacher
      // (case-insensitive trim). A classroom is keyed by teacher AND grade, so:
      //  - exact teacher+grade match → join it silently (true duplicate).
      //  - teacher matches but grade differs → PAUSE and ask: same teacher in a
      //    new grade, or a different person with the same name? (We can't know.)
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
        // Exact teacher + grade already exists → join silently.
        await commitClassroom(school, schoolYear, exact.id, gradeIdx, newTeacher);
        setSavingMembership(false);
        return;
      }

      if (sameTeacher.length > 0) {
        // Teacher exists here but under different grade(s) → ask the user.
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

      // No teacher match at all → create fresh.
      await commitClassroom(school, schoolYear, null, gradeIdx, newTeacher);
    } catch (err) { setMembershipError(err.message); }
    setSavingMembership(false);
  };

  // The actual classroom removal (runs after the user confirms in the modal).
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
      setDrillMessage("Couldn't remove the classroom: " + err.message);
    }
    setHouseholdBusy(false);
  };

  // Opens the in-app confirm modal (replaces window.confirm, which fails on mobile).
  const leaveClassroom = (membershipRow) => {
    const label = `${membershipRow.classrooms?.teacher_name} · ${getGradeLabel(membershipRow.classrooms?.grade)}`;
    setConfirm({
      title: "Remove this classroom?",
      body: `This removes your household from ${label}. You can add it back anytime.`,
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      tone: "danger",
      onConfirm: () => doLeaveClassroom(membershipRow),
    });
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

  const membershipsBySchool = memberships.reduce((acc, m) => {
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

  if (showProfile) return <ProfileScreen session={session} onBack={() => setShowProfile(false)} />;
 if (requestingPlaydate) {
    return (
      <PlaydateRequest session={session} recipient={requestingPlaydate}
        onBack={() => setRequestingPlaydate(null)}
        onSent={() => {
          setRequestingPlaydate(null);
          if (typeof onPlaydateCreated === "function") onPlaydateCreated();
        }} />
    );
  }

  // Teal-accented Home header (Home's signature look — distinct from other tabs).
  const headerBar = (
    <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #02C39A" }}>
      <h1 style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0, letterSpacing: "-0.02em" }}>Huddle</h1>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={onBellClick}
          style={{ background: "transparent", border: "none", cursor: "pointer", position: "relative", padding: "4px 8px", fontSize: "1.3rem" }}>
          🔔
          {notificationCount > 0 && (
            <span style={{ position: "absolute", top: 0, right: 0, background: "#E05A5A", color: "#FFFFFF", fontSize: "0.6rem", fontWeight: "700", borderRadius: "50%", width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {notificationCount}
            </span>
          )}
        </button>
        {parent?.photo_url ? (
          <img src={parent.photo_url} alt="Profile" onClick={() => setShowProfile(true)}
            style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "2px solid #02C39A" }} />
        ) : (
          <div onClick={() => setShowProfile(true)}
            style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", border: "2px solid #02C39A" }}>
            {parent?.name?.charAt(0) || "?"}
          </div>
        )}
      </div>
    </div>
  );

  // Shared add-classroom modal (used in both views). When scopedSchool is set,
  // the school is LOCKED (read-only header, no picker, no school creation);
  // when null, the full school search/create picker is shown.
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

            {/* Join one of the existing grades for this teacher */}
            {gradeConflict.existing.map((e) => (
              <button key={e.id} disabled={savingMembership}
                onClick={async () => {
                  setSavingMembership(true); setMembershipError("");
                  try { await commitClassroom(gradeConflict.school, gradeConflict.schoolYear, e.id, e.grade, gradeConflict.teacherName); }
                  catch (err) { setMembershipError(err.message); }
                  setSavingMembership(false);
                }}
                style={{ width: "100%", padding: "0.8rem", borderRadius: "10px", border: "1px solid #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.6rem", minHeight: "44px" }}>
                Join {getGradeLabel(e.grade)} — same teacher, existing class
              </button>
            ))}

            {/* Add the new grade anyway (multi-grade teacher OR different person, same name) */}
            <button disabled={savingMembership}
              onClick={async () => {
                setSavingMembership(true); setMembershipError("");
                try { await commitClassroom(gradeConflict.school, gradeConflict.schoolYear, null, gradeConflict.gradeIdx, gradeConflict.teacherName); }
                catch (err) { setMembershipError(err.message); }
                setSavingMembership(false);
              }}
              style={{ width: "100%", padding: "0.8rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.6rem", minHeight: "44px" }}>
              Add {getGradeLabel(gradeConflict.gradeIdx)} anyway
            </button>

            <button onClick={() => setGradeConflict(null)} disabled={savingMembership}
              style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "none", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer", minHeight: "44px" }}>
              ← Back
            </button>
          </>
        ) : (
        <>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>
          {scopedSchool ? "Add a classroom" : "Add a school or classroom"}
        </h2>

        {/* School: read-only header when scoped, full picker when not */}
        {scopedSchool ? (
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", borderRadius: "10px", background: "#1A3A5C", border: "1px solid #2A4A6B" }}>
              <span style={{ fontSize: "1.05rem" }}>🏫</span>
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
                  📚 {teacher}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Near-match: offer the close existing teacher as a tap-to-use chip,
            while still allowing the typed name to be added as new. */}
        {nearTeacherMatch && (
          <div style={{ background: "#13314F", border: "1px solid #2A4A6B", borderRadius: "8px", padding: "0.6rem 0.75rem", marginBottom: "1rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.5rem", lineHeight: "1.4" }}>
              Did you mean an existing teacher? Pick one to join the same class, or keep your spelling to add a new teacher.
            </p>
            <button onClick={() => { setNewTeacher(nearTeacherMatch); setShowNewTeacherDropdown(false); }}
              style={{ background: "#0F3D2E", border: "1px solid #02C39A", color: "#02C39A", borderRadius: "8px", padding: "0.4rem 0.8rem", fontSize: "0.82rem", fontWeight: "600", cursor: "pointer", minHeight: "40px" }}>
              📚 Use "{nearTeacherMatch}"
            </button>
          </div>
        )}

        {/* Brand-new teacher (matches nothing): neutral confirmation, not a warning. */}
        {isBrandNewTeacher && (
          <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 1rem", lineHeight: "1.4" }}>
            New teacher — “{newTeacher.trim()}” will be added{scopedSchool ? ` to ${scopedSchool.name}` : ""}.
          </p>
        )}

        {membershipError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{membershipError}</p>}
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={closeAddClassroom} style={{ flex: 1, padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={saveNewClassroom} disabled={!newGrade || (!scopedSchool && !newSchoolSearch) || !newTeacher || savingMembership}
            style={{ flex: 2, padding: "0.85rem", borderRadius: "10px", border: "none", background: (!newGrade || (!scopedSchool && !newSchoolSearch) || !newTeacher) ? "#2A4A6B" : "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
            {savingMembership ? "Saving..." : "Add classroom →"}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );

  // ---- DRILL-IN VIEW: a single classroom's families + actions ----
  if (selectedClassroom) {
    const m = selectedClassroom;
    const cards = familyCardsFor(m);
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        {headerBar}
        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          <button onClick={() => { setSelectedClassroom(null); setDrillMessage(""); }}
            style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "0.95rem", cursor: "pointer", padding: "0 0 1rem", display: "flex", alignItems: "center", gap: "6px" }}>
            ← Back to classrooms
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", background: "#1A3A5C", borderRadius: "10px", marginBottom: "1.25rem" }}>
            <span style={{ fontSize: "1.2rem" }}>📚</span>
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
              <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>👋</p>
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
                <button onClick={() => setRequestingPlaydate(card.parents)}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                  Huddle →
                </button>
              </div>
            ))
          )}

          <button onClick={() => setInviting(true)}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginTop: "1rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            ➕ Invite a parent to Huddle
          </button>

          <button onClick={() => leaveClassroom(m)} disabled={householdBusy}
            style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#607080", fontSize: "0.8rem", cursor: "pointer", marginTop: "1.5rem", minHeight: "44px" }}>
            Remove this classroom
          </button>
        </div>

        {inviting && (
          <InviteFamily session={session} inviterName={parent?.name} onClose={() => setInviting(false)} />
        )}

        <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
      </div>
    );
  }

  // ---- MAIN VIEW: dashboard (greeting → next playdate → activity → schools) ----
  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
      {headerBar}

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* Greeting */}
        <div style={{ marginBottom: "1.25rem" }}>
          <p style={{ color: "#607080", fontSize: "0.8rem", margin: "0 0 2px" }}>{todayLabel()}</p>
          <h2 style={{ color: "#FFFFFF", fontSize: "1.4rem", fontWeight: "600", margin: 0, letterSpacing: "-0.02em" }}>
            {greeting()}, {parent?.name?.split(" ")[0] || "there"}
          </h2>
        </div>

        {/* Next playdate hero */}
        {nextPlaydate ? (
          <div onClick={() => typeof onGoToPlaydates === "function" && onGoToPlaydates()}
            style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "14px", padding: "1.1rem 1.25rem", marginBottom: "1.5rem", cursor: "pointer" }}>
            <p style={{ color: "#02C39A", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: "600", margin: "0 0 6px" }}>
              {nextPlaydate._role === "hosting" ? "YOU'RE HOSTING" : "NEXT PLAYDATE"}
            </p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "600", margin: "0 0 3px" }}>
              📅 {fmtPlaydate(nextPlaydate.proposed_date)}
            </p>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>
              📍 {nextPlaydate.location_name}{nextPlaydate._otherLabel ? ` · with ${nextPlaydate._otherLabel}` : ""}
            </p>
          </div>
        ) : (
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "14px", padding: "1.1rem 1.25rem", marginBottom: "1.5rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: 0 }}>
              📅 No playdates coming up — tap <span style={{ color: "#02C39A", fontWeight: "600" }}>Huddle →</span> next to a family below to set one up.
            </p>
          </div>
        )}

       {/* Stat tiles */}
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
          ];
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "1.5rem" }}>
              {tiles.map((t) => (
                <div key={t.label}
                  onClick={() => t.go && t.go()}
                  style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.9rem 0.5rem", textAlign: "center", cursor: t.go ? "pointer" : "default" }}>
                  <p style={{ color: "#02C39A", fontSize: "1.6rem", fontWeight: "700", margin: "0 0 2px" }}>{t.value}</p>
                  <p style={{ color: "#8AAEC8", fontSize: "0.68rem", margin: 0, lineHeight: "1.25" }}>{t.label}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Your schools */}
        {memberships.length > 0 && (
          <p style={{ color: "#8AAEC8", fontSize: "0.8rem", letterSpacing: "0.05em", margin: "0 0 0.75rem" }}>YOUR SCHOOLS</p>
        )}

        {Object.entries(membershipsBySchool).map(([schoolKey, school]) => (
          <div key={schoolKey} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", background: "#1A3A5C", borderRadius: "10px 10px 0 0", borderBottom: "2px solid #02C39A" }}>
              <span style={{ fontSize: "1.2rem" }}>🏫</span>
              <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: 0 }}>{school.name}</p>
            </div>
            <div style={{ background: "#162D50", borderRadius: "0 0 12px 12px", border: "1px solid #2A4A6B", borderTop: "none", overflow: "hidden" }}>
              {school.classrooms.map((m, idx) => {
                const familyCount = familyCardsFor(m).length;
                return (
                  <div key={m.id} onClick={() => setSelectedClassroom(m)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "1rem", cursor: "pointer", borderBottom: idx < school.classrooms.length - 1 ? "1px solid #2A4A6B" : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "1.1rem" }}>📚</span>
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
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🏫</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Add your kid's classroom</p>
            <p style={{ color: "#607080", fontSize: "0.9rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
              Add your school and classroom to find other families to huddle with.
            </p>
            <button onClick={openAddDifferentSchool}
              style={{ padding: "0.85rem 1.5rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer" }}>
              ➕ Add a classroom
            </button>
          </div>
        )}

        {memberships.length > 0 && (
          <button onClick={openAddDifferentSchool}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px solid #2A4A6B", background: "#162D50", color: "#8AAEC8", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            🏫 Add a different school
          </button>
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