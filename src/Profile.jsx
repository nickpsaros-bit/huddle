import { useState } from "react";
import { supabase } from "./supabase";

export default function Profile({ session, onComplete }) {
  const [step, setStep] = useState("parent");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [parentName, setParentName] = useState("");
  const [childName, setChildName] = useState("");
  const [childGrade, setChildGrade] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolResults, setSchoolResults] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [teacherResults, setTeacherResults] = useState([]);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);

  const grades = [
    "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade",
    "4th Grade", "5th Grade", "6th Grade"
  ];

  const searchSchools = async (query) => {
    setSchoolSearch(query);
    setSelectedSchool(null);
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

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  const labelStyle = {
    color: "#8AAEC8", fontSize: "0.85rem", marginBottom: "0.4rem", display: "block"
  };

  const buttonStyle = {
    width: "100%", padding: "0.85rem", borderRadius: "10px",
    border: "none", background: "#02C39A", color: "#0F2044",
    fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginTop: "0.5rem"
  };

  const saveProfile = async () => {
    setLoading(true);
    setError("");
    try {
      const { error: parentError } = await supabase
        .from("parents").upsert({ id: session.user.id, name: parentName });
      if (parentError) throw parentError;

      const { data: child, error: childError } = await supabase
        .from("children")
        .insert({
          parent_id: session.user.id, name: childName,
          grade: grades.indexOf(childGrade),
          allergies: allergies || null, medical_notes: medicalNotes || null,
        }).select().single();
      if (childError) throw childError;

      let school;
      if (selectedSchool) {
        school = selectedSchool;
      } else {
        const code = schoolSearch.toUpperCase().replace(/\s+/g, "").slice(0, 10) + Date.now().toString().slice(-4);
        const { data: newSchool, error: schoolError } = await supabase
          .from("schools").insert({ name: schoolSearch, activation_code: code }).select().single();
        if (schoolError) throw schoolError;
        school = newSchool;
      }

      const currentYear = new Date().getFullYear();
      const schoolYear = `${currentYear}-${currentYear + 1}`;
      let classroom;
      const { data: existingClassroom } = await supabase.from("classrooms").select()
        .eq("school_id", school.id).eq("teacher_name", teacherName).eq("school_year", schoolYear).maybeSingle();
      if (existingClassroom) {
        classroom = existingClassroom;
      } else {
        const { data: newClassroom, error: classroomError } = await supabase.from("classrooms")
          .insert({ school_id: school.id, teacher_name: teacherName, grade: grades.indexOf(childGrade), school_year: schoolYear })
          .select().single();
        if (classroomError) throw classroomError;
        classroom = newClassroom;
      }

      await supabase.from("classroom_members").insert({
        child_id: child.id, classroom_id: classroom.id, school_year: schoolYear,
      });

      onComplete();
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  const teacherMismatch = teacherResults.length > 0 && teacherName &&
    !teacherResults.find(t => t.toLowerCase() === teacherName.toLowerCase());

  return (
    <div style={{
      minHeight: "100vh", background: "#0F2044", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "2rem", fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem" }}>Huddle</h1>
      <p style={{ color: "#B0C4D8", fontSize: "0.9rem", margin: "0 0 2rem" }}>Let's set up your profile</p>

      <div style={{ background: "#162D50", borderRadius: "16px", padding: "2rem", width: "100%", maxWidth: "400px" }}>

        {/* Progress bar */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "1.5rem" }}>
          {["parent", "child", "school"].map((s, i) => (
            <div key={s} style={{
              flex: 1, height: "4px", borderRadius: "2px",
              background: s === step ? "#02C39A" :
                (["parent", "child", "school"].indexOf(step) > i ? "#028090" : "#2A4A6B")
            }} />
          ))}
        </div>

        {step === "parent" && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>About you</h2>
            <label style={labelStyle}>Your full name</label>
            <input type="text" placeholder="Jane Smith" value={parentName}
              onChange={(e) => setParentName(e.target.value)} style={inputStyle} />
            <button onClick={() => setStep("child")} disabled={!parentName}
              style={{ ...buttonStyle, background: !parentName ? "#2A4A6B" : "#02C39A", cursor: !parentName ? "not-allowed" : "pointer" }}>
              Next →
            </button>
          </>
        )}

        {step === "child" && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>About your child</h2>
            <label style={labelStyle}>Child's name</label>
            <input type="text" placeholder="Emma Smith" value={childName}
              onChange={(e) => setChildName(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Grade</label>
            <select value={childGrade} onChange={(e) => setChildGrade(e.target.value)}
              style={{ ...inputStyle, appearance: "none" }}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <label style={labelStyle}>Allergies (optional)</label>
            <input type="text" placeholder="e.g. peanuts, dairy" value={allergies}
              onChange={(e) => setAllergies(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Medical notes (optional)</label>
            <input type="text" placeholder="e.g. carries EpiPen" value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)} style={inputStyle} />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setStep("parent")}
                style={{ ...buttonStyle, background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", flex: 1 }}>
                ← Back
              </button>
              <button onClick={() => setStep("school")} disabled={!childName || !childGrade}
                style={{ ...buttonStyle, background: (!childName || !childGrade) ? "#2A4A6B" : "#02C39A", cursor: (!childName || !childGrade) ? "not-allowed" : "pointer", flex: 2 }}>
                Next →
              </button>
            </div>
          </>
        )}

        {step === "school" && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>Your school</h2>

            <label style={labelStyle}>School name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text" placeholder="Start typing your school name..."
                value={schoolSearch} onChange={(e) => searchSchools(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
              {showSchoolDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10 }}>
                  {schoolResults.map(school => (
                    <div key={school.id} onClick={() => selectSchool(school)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#2A4A6B"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
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

            <label style={labelStyle}>Teacher's name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text"
                placeholder={teacherResults.length > 0 ? "Select or type teacher name..." : "Mrs. Johnson"}
                value={teacherName}
                onChange={(e) => { setTeacherName(e.target.value); setShowTeacherDropdown(e.target.value.length > 0); }}
                onFocus={() => { if (teacherResults.length > 0) setShowTeacherDropdown(true); }}
                style={{ ...inputStyle, marginBottom: 0, borderColor: teacherMismatch ? "#854F0B" : "#2A4A6B" }} />
              {showTeacherDropdown && teacherResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
                  {teacherResults.filter(t => t.toLowerCase().includes(teacherName.toLowerCase())).map(teacher => (
                    <div key={teacher} onClick={() => { setTeacherName(teacher); setShowTeacherDropdown(false); }}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#2A4A6B"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      📚 {teacher}
                    </div>
                  ))}
                  {teacherMismatch && (
                    <div onClick={() => setShowTeacherDropdown(false)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem", borderTop: "1px solid #2A4A6B" }}>
                      + Add "{teacherName}" as a new teacher
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

            <p style={{ color: "#607080", fontSize: "0.8rem", marginBottom: "1rem" }}>
              Select your school then pick your teacher from the list, or add a new one.
            </p>

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setStep("child")}
                style={{ ...buttonStyle, background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", flex: 1 }}>
                ← Back
              </button>
              <button onClick={saveProfile} disabled={!schoolSearch || !teacherName || loading}
                style={{ ...buttonStyle, background: (!schoolSearch || !teacherName) ? "#2A4A6B" : "#02C39A", cursor: loading ? "not-allowed" : "pointer", flex: 2 }}>
                {loading ? "Saving..." : "Let's go! →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}