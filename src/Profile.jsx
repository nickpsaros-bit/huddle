import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Profile({ session, onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingExisting, setCheckingExisting] = useState(true);

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

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  // GUARD: if this authenticated user ALREADY has a household, they already have
  // an account — do NOT let them run signup again (which would create a duplicate
  // household). Send them straight into the app.
  useEffect(() => {
    let cancelled = false;
    const checkExisting = async () => {
      try {
        const { data: hm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", session.user.id)
          .maybeSingle();
        if (!cancelled && hm) {
          onComplete();
          return;
        }
      } catch (e) {
        // If the check fails, fall through to signup (safe default) but don't crash.
      }
      if (!cancelled) setCheckingExisting(false);
    };
    checkExisting();
    return () => { cancelled = true; };
  }, []);

  // Name validation: reject emails, junk, too-short. Returns an error string or "".
  const validateName = (raw) => {
    const name = (raw || "").trim();
    if (name.length < 2) return "Please enter your name.";
    if (/@/.test(name) || /\S+@\S+\.\S+/.test(name)) {
      return "That looks like an email. Please enter your name (e.g. Jane Smith).";
    }
    if (/^\d+$/.test(name)) return "Please enter your name, not just numbers.";
    if (/https?:\/\//i.test(name)) return "Please enter your name.";
    return "";
  };

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

  const saveStep1 = async () => {
    const nameError = validateName(parentName);
    if (nameError) { setError(nameError); return; }
    setLoading(true);
    setError("");
    try {
      const { error: parentErr } = await supabase.from("parents").upsert({
        id: session.user.id,
        name: parentName.trim(),
      });
      if (parentErr) throw parentErr;
      setStep(2);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const saveStep2 = async () => {
    setLoading(true);
    setError("");
    try {
      // DUPLICATE GUARD: re-check for an existing household right before creating one.
      const { data: existingHh } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .maybeSingle();
      if (existingHh) {
        onComplete();
        return;
      }

      // School: existing or new
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

      // Classroom: existing or new.
      // IMPORTANT: match on teacher + GRADE + year to mirror the unique constraint
      // (classrooms_unique_teacher_grade_year). One teacher can have multiple grades
      // (e.g. "Ms Christy" in both K and 6th), so a teacher-only lookup is ambiguous
      // and would miss the right row, then collide on insert.
      let classroom;
      const { data: existing } = await supabase.from("classrooms").select()
        .eq("school_id", school.id)
        .eq("teacher_name", teacher)
        .eq("grade", grades.indexOf(grade))
        .eq("school_year", schoolYear)
        .maybeSingle();
      if (existing) {
        classroom = existing;
      } else {
        const { data: newClassroom, error: classroomErr } = await supabase.from("classrooms")
          .insert({ school_id: school.id, teacher_name: teacher, grade: grades.indexOf(grade), school_year: schoolYear })
          .select().single();
        if (classroomErr) {
          // Safety net: if a duplicate slips through (race condition), fetch + join
          // the existing row instead of failing signup.
          if ((classroomErr.message || "").toLowerCase().includes("duplicate")) {
            const { data: found } = await supabase.from("classrooms").select()
              .eq("school_id", school.id)
              .eq("teacher_name", teacher)
              .eq("grade", grades.indexOf(grade))
              .eq("school_year", schoolYear)
              .maybeSingle();
            if (found) {
              classroom = found;
            } else {
              throw classroomErr;
            }
          } else {
            throw classroomErr;
          }
        } else {
          classroom = newClassroom;
        }
      }

      // Create own household
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

      // Welcome notification (non-blocking — a failed insert shouldn't stop signup).
      try {
        await supabase.from("notifications").insert({
          recipient_id: session.user.id,
          type: "welcome",
          title: "Welcome to Huddle! 👋",
          body: "Huddle helps you connect with other parents in your kid's classroom. A few tips to get started: add all your classrooms so you see every family, tap \"Huddle →\" next to a parent to set up a playdate, and check this bell for playdate invites and updates. Your privacy is protected — other parents only ever see your first name and last initial, never your full name, email, or phone.",
        });
      } catch (notifErr) {
        // Ignore — welcome note is best-effort.
      }

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

  // While we check whether this user already has an account, show a neutral loader.
  if (checkingExisting) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Huddle</p>
      </div>
    );
  }

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
              onChange={(e) => { setParentName(e.target.value); if (error) setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && parentName && saveStep1()}
              style={inputStyle} />

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
      </div>
    </div>
  );
}