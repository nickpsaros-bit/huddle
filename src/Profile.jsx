import { useState } from "react";
import { supabase } from "./supabase";

export default function Profile({ session, onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: parent info
  const [parentName, setParentName] = useState("");

  // Step 2: classroom info
  const [grade, setGrade] = useState("");
  const [teacher, setTeacher] = useState("");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolResults, setSchoolResults] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [teacherResults, setTeacherResults] = useState([]);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);

  // Step 3: household match (co-parent join flow)
  const [matchedHouseholds, setMatchedHouseholds] = useState([]);
  const [matchContext, setMatchContext] = useState(null); // { school, classroom, schoolYear }
  const [requestSent, setRequestSent] = useState(false);

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  const searchSchools = async (query) => {
    setSchoolSearch(query);
    setSelectedSchool(null);
    setTeacherResults([]);
    setTeacher("");
    if (query.length < 2) { setSchoolResults([]); setShowSchoolDropdown(false); return; }
    const { data } = await supabase.from("schools").select("*").ilike("name", `%${query}%`).limit(5);
    setSchoolResults(data || []);
    setShowSchoolDropdown(true);
  };

  const selectSchool = async (school) => {
    setSelectedSchool(school);
    setSchoolSearch(school.name);
    setShowSchoolDropdown(false);
    const { data } = await supabase.from("classrooms").select("teacher_name").eq("school_id", school.id).limit(20);
    const unique = [...new Set((data || []).map(c => c.teacher_name))];
    setTeacherResults(unique);
  };

  const teacherMismatch = teacherResults.length > 0 && teacher &&
    !teacherResults.find(t => t.toLowerCase() === teacher.toLowerCase());

  // Display helper: "Nick Psaros" -> "Nick P." (never show full last name)
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const saveStep1 = async () => {
    setLoading(true);
    setError("");
    try {
      // Save the parent record only. Household is created later (step 2 or 3),
      // once we know whether this parent is joining an existing household.
      const { error: parentErr } = await supabase.from("parents").upsert({
        id: session.user.id,
        name: parentName,
      });
      if (parentErr) throw parentErr;
      setStep(2);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  // Resolves the school (existing or new) and the classroom (existing or new).
  // Returns { school, classroom, schoolYear }. Does NOT create any household
  // or membership — callers decide that based on whether a match was found.
  const resolveSchoolAndClassroom = async () => {
    let school;
    if (selectedSchool) {
      school = selectedSchool;
    } else {
      const code = schoolSearch.toUpperCase().replace(/\s+/g, "").slice(0, 10) + Date.now().toString().slice(-4);
      const { data: newSchool, error: schoolErr } = await supabase.from("schools")
        .insert({ name: schoolSearch, activation_code: code })
        .select().single();
      if (schoolErr) throw schoolErr;
      school = newSchool;
    }

    const currentYear = new Date().getFullYear();
    const schoolYear = `${currentYear}-${currentYear + 1}`;

    let classroom;
    const { data: existing } = await supabase.from("classrooms").select()
      .eq("school_id", school.id)
      .eq("teacher_name", teacher)
      .eq("school_year", schoolYear)
      .maybeSingle();
    if (existing) {
      classroom = existing;
    } else {
      const { data: newClassroom, error: classroomErr } = await supabase.from("classrooms")
        .insert({ school_id: school.id, teacher_name: teacher, grade: grades.indexOf(grade), school_year: schoolYear })
        .select().single();
      if (classroomErr) throw classroomErr;
      classroom = newClassroom;
    }

    return { school, classroom, schoolYear };
  };

  // Finds households already in a classroom, via plain sequential queries
  // (PostgREST nested embeds were returning empty). Returns
  // [{ household_id, names: [...] }], excluding this parent's own household.
  const findHouseholdsInClassroom = async (classroomId) => {
    // 1. Households registered in this classroom.
    const { data: cms } = await supabase
      .from("classroom_members")
      .select("household_id")
      .eq("classroom_id", classroomId);

    const householdIds = [...new Set((cms || []).map((c) => c.household_id))];
    if (householdIds.length === 0) return [];

    // 2. Parents in those households.
    const { data: hms } = await supabase
      .from("household_members")
      .select("household_id, parent_id")
      .in("household_id", householdIds);

    const parentIds = [...new Set((hms || []).map((h) => h.parent_id))];
    if (parentIds.length === 0) return [];

    // 3. Names for those parents.
    const { data: parents } = await supabase
      .from("parents")
      .select("id, name")
      .in("id", parentIds);

    const nameById = {};
    (parents || []).forEach((p) => { nameById[p.id] = p.name; });

    // 4. Group parents by household, excluding my own household.
    const grouped = {};
    (hms || []).forEach((h) => {
      if (h.parent_id === session.user.id) {
        // I'm in this household — mark it so we skip it entirely.
        grouped[h.household_id] = grouped[h.household_id] || { mine: false, names: [] };
        grouped[h.household_id].mine = true;
      }
      grouped[h.household_id] = grouped[h.household_id] || { mine: false, names: [] };
      const nm = nameById[h.parent_id];
      if (nm) grouped[h.household_id].names.push(nm);
    });

    return Object.entries(grouped)
      .filter(([, v]) => !v.mine && v.names.length > 0)
      .map(([household_id, v]) => ({ household_id, names: v.names }));
  };

  // Creates a brand-new household for this parent, adds them as primary,
  // and registers the household in the chosen classroom.
  const createOwnHousehold = async (school, classroom, schoolYear) => {
    const { data: household, error: hhErr } = await supabase
      .from("households")
      .insert({})
      .select()
      .single();
    if (hhErr) throw hhErr;

    const { error: memberErr } = await supabase
      .from("household_members")
      .insert({
        household_id: household.id,
        parent_id: session.user.id,
        role: "primary",
      });
    if (memberErr) throw memberErr;

    const { error: cmErr } = await supabase.from("classroom_members").insert({
      household_id: household.id,
      classroom_id: classroom.id,
      school_year: schoolYear,
    });
    if (cmErr && !cmErr.message.includes("duplicate")) throw cmErr;
  };

  const saveStep2 = async () => {
    setLoading(true);
    setError("");
    try {
      const { school, classroom, schoolYear } = await resolveSchoolAndClassroom();

      const households = await findHouseholdsInClassroom(classroom.id);

      if (households.length > 0) {
        setMatchedHouseholds(households);
        setMatchContext({ school, classroom, schoolYear });
        setStep(3);
        setLoading(false);
        return;
      }

      // No match — create own household as before.
      await createOwnHousehold(school, classroom, schoolYear);
      onComplete();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const requestToJoin = async (household_id) => {
    setLoading(true);
    setError("");
    try {
      const { school, classroom, schoolYear } = matchContext;
      const { error: reqErr } = await supabase.from("household_join_requests").insert({
        requesting_parent_id: session.user.id,
        target_household_id: household_id,
        classroom_id: classroom.id,
        pending_grade: grades.indexOf(grade),
        pending_school_id: school.id,
        pending_teacher_name: teacher,
        pending_school_year: schoolYear,
      });
      if (reqErr) throw reqErr;
      setRequestSent(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const declineMatchAndGoSolo = async () => {
    setLoading(true);
    setError("");
    try {
      const { school, classroom, schoolYear } = matchContext;
      await createOwnHousehold(school, classroom, schoolYear);
      onComplete();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "440px" }}>

        <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem", textAlign: "center" }}>Huddle</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 2rem", textAlign: "center" }}>The social app for school families</p>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "2rem", justifyContent: "center" }}>
          {[1, 2].map(n => (
            <div key={n} style={{
              width: step >= n ? "32px" : "8px",
              height: "8px",
              borderRadius: "4px",
              background: step >= n ? "#02C39A" : "#2A4A6B",
              transition: "all 0.3s"
            }} />
          ))}
        </div>

        {/* Step 1: Parent info */}
        {step === 1 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Welcome!</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Let's get to know you. What's your name?</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Your full name</label>
            <input type="text" placeholder="Jane Smith" value={parentName}
              onChange={(e) => setParentName(e.target.value)} style={inputStyle} />

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={saveStep1} disabled={!parentName || loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
                background: !parentName ? "#2A4A6B" : "#02C39A", color: "#0F2044",
                fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginTop: "0.5rem" }}>
              {loading ? "Saving..." : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 2: Classroom info */}
        {step === 2 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Add a classroom</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Tell us about your child's classroom. You can add more later.</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text" placeholder="Start typing school name..." value={schoolSearch}
                onChange={(e) => searchSchools(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
              {showSchoolDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10 }}>
                  {schoolResults.map(school => (
                    <div key={school.id} onClick={() => selectSchool(school)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      🏫 {school.name}
                    </div>
                  ))}
                  <div onClick={() => { setSelectedSchool(null); setShowSchoolDropdown(false); }}
                    style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem" }}>
                    + Add "{schoolSearch}" as a new school
                  </div>
                </div>
              )}
            </div>

            {selectedSchool && (
              <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
                <span style={{ color: "#02C39A", fontSize: "0.85rem" }}>✓ {selectedSchool.name}</span>
              </div>
            )}

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text"
                placeholder={teacherResults.length > 0 ? "Select or type teacher name..." : "Mrs. Johnson"}
                value={teacher}
                onChange={(e) => { setTeacher(e.target.value); setShowTeacherDropdown(e.target.value.length > 0); }}
                onFocus={() => { if (teacherResults.length > 0) setShowTeacherDropdown(true); }}
                style={{ ...inputStyle, marginBottom: 0, borderColor: teacherMismatch ? "#854F0B" : "#2A4A6B" }} />
              {showTeacherDropdown && teacherResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
                  {teacherResults.filter(t => t.toLowerCase().includes(teacher.toLowerCase())).map(t => (
                    <div key={t} onClick={() => { setTeacher(t); setShowTeacherDropdown(false); }}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      📚 {t}
                    </div>
                  ))}
                  {teacherMismatch && (
                    <div onClick={() => setShowTeacherDropdown(false)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem", borderTop: "1px solid #2A4A6B" }}>
                      + Add "{teacher}" as a new teacher
                    </div>
                  )}
                </div>
              )}
            </div>

            {teacherMismatch && (
              <div style={{ background: "#3D1F0A", border: "1px solid #854F0B", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem", marginTop: "-0.5rem" }}>
                <p style={{ color: "#F59E0B", fontSize: "0.8rem", margin: 0 }}>
                  ⚠️ This teacher isn't in our system yet. Double-check spelling or select from the list above.
                </p>
              </div>
            )}

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={saveStep2} disabled={!grade || !schoolSearch || !teacher || loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
                background: (!grade || !schoolSearch || !teacher) ? "#2A4A6B" : "#02C39A",
                color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              {loading ? "Saving..." : "Finish setup →"}
            </button>
          </div>
        )}

        {/* Step 3: Household match — "is one of these your family?" */}
        {step === 3 && !requestSent && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Is this your family?</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
              {matchedHouseholds.length === 1
                ? "A household is already set up in this class. If it's your family, ask to join so you share classrooms and connections."
                : "Some households are already set up in this class. If one is your family, ask to join."}
            </p>

            {matchedHouseholds.map((hh) => (
              <div key={hh.household_id}
                style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", padding: "1rem 1.25rem", marginBottom: "10px" }}>
                <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 0.75rem" }}>
                  {hh.names.map(shortName).join(" & ")}
                </p>
                <button onClick={() => requestToJoin(hh.household_id)} disabled={loading}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer" }}>
                  {loading ? "Sending..." : "This is my family — ask to join"}
                </button>
              </div>
            ))}

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", margin: "1rem 0 0" }}>{error}</p>}

            <button onClick={declineMatchAndGoSolo} disabled={loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.95rem", cursor: "pointer", marginTop: "1rem" }}>
              None of these — set up my own household
            </button>
          </div>
        )}

        {/* Step 3b: request sent, waiting */}
        {step === 3 && requestSent && (
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>📨</p>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Request sent!</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem", lineHeight: "1.5" }}>
              We've let the household know you'd like to join. Once they approve, you'll share their classrooms and connections automatically. You can close the app — we'll be ready when they say yes.
            </p>
            <button onClick={() => window.location.reload()}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}