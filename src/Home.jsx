import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ProfileScreen from "./ProfileScreen";
import PlaydateRequest from "./PlaydateRequest";
import InviteFamily from "./InviteFamily";

export default function Home({ session, notificationCount, onBellClick, onPlaydateCreated }) {
  const [parent, setParent] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [classmates, setClassmates] = useState({});
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
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
  const [inviting, setInviting] = useState(false);

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  useEffect(() => { fetchData(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const getGradeLabel = (gradeNum) => grades[gradeNum] || "Unknown grade";

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
      setSelectedClassroom(null);
      fetchData();
    } catch (err) {
      alert("Error: " + err.message);
    }
    setHouseholdBusy(false);
  };

  const familyCardsFor = (membershipRow) => {
    const group = classmates[membershipRow.id];
    const cards = [];
    (group?.rows || []).forEach((cm) => {
      const members = cm.households?.household_members || [];
      members.forEach((hm) => {
        if (!hm.parents) return;
        cards.push({ key: `${cm.id}-${hm.parent_id}`, parents: hm.parents });
      });
    });
    return cards;
  };

  const membershipsBySchool = memberships.reduce((acc, m) => {
    const schoolName = m.classrooms?.schools?.name || "Unknown School";
    const schoolKey = schoolName.toLowerCase().replace(/\s+/g, "-");
    if (!acc[schoolKey]) acc[schoolKey] = { name: schoolName, classrooms: [] };
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

  const headerBar = (
    <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
      <h1 style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0 }}>Huddle</h1>
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
        <span onClick={() => setShowProfile(true)} style={{ color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer", textDecoration: "underline" }}>
          Hi, {parent?.name?.split(" ")[0]}!
        </span>
        {parent?.photo_url && (
          <img src={parent.photo_url} alt="Profile" onClick={() => setShowProfile(true)}
            style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "2px solid #02C39A" }} />
        )}
      </div>
    </div>
  );

  // Shared add-classroom modal (used in both views).
  const addClassroomModal = addingClassroom && (
    <div style={overlay}>
      <div style={modalBox}>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>Add a school or classroom</h2>

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
  );

  // ---- DRILL-IN VIEW: a single classroom's families + actions ----
  if (selectedClassroom) {
    const m = selectedClassroom;
    const cards = familyCardsFor(m);
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        {headerBar}
        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          <button onClick={() => setSelectedClassroom(null)}
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
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: 0 }}>{shortName(card.parents?.name)}</p>
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
            style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#607080", fontSize: "0.8rem", cursor: "pointer", marginTop: "1.5rem" }}>
            Remove this classroom
          </button>
        </div>

        {inviting && (
          <InviteFamily session={session} inviterName={parent?.name} onClose={() => setInviting(false)} />
        )}
      </div>
    );
  }

  // ---- MAIN VIEW: school card(s) with tappable classroom rows ----
  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
      {headerBar}

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

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
              <div onClick={() => setAddingClassroom(true)} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", cursor: "pointer", borderTop: "1px dashed #2A4A6B" }}>
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
            <button onClick={() => setAddingClassroom(true)}
              style={{ padding: "0.85rem 1.5rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer" }}>
              ➕ Add a classroom
            </button>
          </div>
        )}

        {memberships.length > 0 && (
          <button onClick={() => setAddingClassroom(true)}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px solid #2A4A6B", background: "#162D50", color: "#8AAEC8", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            🏫 Add a different school
          </button>
        )}

        <button onClick={() => setInviting(true)}
          style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer", marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          ➕ Invite a parent to Huddle
        </button>
      </div>

      {inviting && (
        <InviteFamily session={session} inviterName={parent?.name} onClose={() => setInviting(false)} />
      )}

      {addClassroomModal}
    </div>
  );
}