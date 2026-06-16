import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ProfileScreen from "./ProfileScreen";
import PlaydateRequest from "./PlaydateRequest";
import InviteFamily from "./InviteFamily";

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

  // Invite a family flow
  const [inviting, setInviting] = useState(false);

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
      classmatesMap[m.id] = {
        classroomLabel: `${m.classrooms?.teacher_name} · ${grades[m.classrooms?.grade] || "Unknown grade"}`,
        rows: otherMembers || [],
      };
    }
    setClassmates(classmatesMap);

    setLoading(false);
  };

  // Search parents who share a classroom with me (excludes my own household).
  const runMemberSearch = async (query) => {
    setMemberSearch(query);
    if (query.trim().length < 2) { setMemberCandidates([]); return; }

    const classroomIds = memberships.map((m) => m.classroom_id);
    if (classroomIds.length === 0) { setMemberCandidates([]); return; }

    const { data: cms } = await supabase
      .from("classroom_members")
      .select("household_id")
      .in("classroom_id", classroomIds)
      .neq("household_id", householdId);

    const otherHouseholdIds = [...new Set((cms || []).map((c) => c.household_id))];
    if (otherHouseholdIds.length === 0) { setMemberCandidates([]); return; }

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

  // Remove a member. The removed member lands in a fresh household of their own
  // (as primary), carrying over the household's classroom memberships so they
  // stay connected to their kids' classes. No one gets stranded.
  const removeMember = async (memberRow) => {
    setHouseholdBusy(true);
    try {
      const leavingParentId = memberRow.parent_id;
      const wasPrimary = memberRow.role === "primary";

      const { data: classMemberships } = await supabase
        .from("classroom_members")
        .select("classroom_id, school_year")
        .eq("household_id", householdId);

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

      const { data: newHh, error: hhErr } = await supabase
        .from("households")
        .insert({})
        .select()
        .single();
      if (hhErr) throw hhErr;

      const { error: addErr } = await supabase
        .from("household_members")
        .insert({
          household_id: newHh.id,
          parent_id: leavingParentId,
          role: "primary",
        });
      if (addErr) throw addErr;

      if (classMemberships && classMemberships.length > 0) {
        const rows = classMemberships.map((c) => ({
          household_id: newHh.id,
          classroom_id: c.classroom_id,
          school_year: c.school_year,
        }));
        await supabase.from("classroom_members").insert(rows);
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
    if (window.confirm(`Remove ${nm} from your household? They'll get their own household and stay in your shared classrooms.`)) {
      removeMember(memberRow);
    }
  };

  const confirmLeave = () => {
    const me = householdMembers.find((m) => m.parent_id === session.user.id);
    if (!me) return;
    if (window.confirm("Leave this household? You'll get your own household and stay in your current classrooms.")) {
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

  const classmateCards = [];
  Object.values(classmates).forEach((group) => {
    (group.rows || []).forEach((cm) => {
      const members = cm.households?.household_members || [];
      members.forEach((hm) => {
        classmateCards.push({
          key: `${cm.id}-${hm.parent_id}`,
          parents: hm.parents,
          classroomLabel: group.classroomLabel,
        });
      });
    });
  });

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

        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 1rem", letterSpacing: "0.05em" }}>YOUR SCHOOL</p>

        {Object.entries(membershipsBySchool).map(([schoolKey, school]) => (
          <div key={schoolKey} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", background: "#1A3A5C", borderRadius: "10px 10px 0 0", borderBottom: "2px solid #02C39A" }}>
              <span style={{ fontSize: "1.2rem" }}>🏫</span>
              <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: 0 }}>{school.name}</p>
            </div>
            <div style={{ background: "#162D50", borderRadius: "0 0 12px 12px", border: "1px solid #2A4A6B", borderTop: "none", overflow: "hidden" }}>
              <p style={{ color: "#607080", fontSize: "0.7rem", letterSpacing: "0.05em", margin: 0, padding: "0.75rem 1rem 0.25rem" }}>CLASSROOMS</p>
              {school.classrooms.map((m, idx) => {
                const group = classmates[m.id];
                const otherFamilies = group?.rows || [];
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
                          No other families here yet — invite one below.
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

        {classmateCards.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>👋</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>You're the first one here!</p>
            <p style={{ color: "#607080", fontSize: "0.9rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
              Invite another family to Huddle — once they join, you'll be connected and can start setting up playdates.
            </p>
            <button onClick={() => setInviting(true)}
              style={{ padding: "0.85rem 1.5rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer" }}>
              ➕ Invite a family to Huddle
            </button>
          </div>
        ) : (
          classmateCards.map((card) => (
            <div key={card.key} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0, overflow: "hidden" }}>
                  {card.parents?.photo_url ? (
                    <img src={card.parents.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : card.parents?.name?.charAt(0) || "?"}
                </div>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(card.parents?.name)}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>{card.classroomLabel}</p>
                </div>
              </div>
              <button onClick={() => setRequestingPlaydate(card.parents)}
                style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                Huddle →
              </button>
            </div>
          ))
        )}

        {/* Always-available invite (quieter when the classroom already has people) */}
        {classmateCards.length > 0 && (
          <button onClick={() => setInviting(true)}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginTop: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            ➕ Invite a family to Huddle
          </button>
        )}
      </div>

      {/* Invite a family modal */}
      {inviting && (
        <InviteFamily
          session={session}
          inviterName={parent?.name}
          onClose={() => setInviting(false)}
        />
      )}

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
}