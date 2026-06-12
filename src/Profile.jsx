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
  const [schoolName, setSchoolName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [activationCode, setActivationCode] = useState("");

  const inputStyle = {
    width: "100%",
    padding: "0.85rem 1rem",
    borderRadius: "10px",
    border: "1px solid #2A4A6B",
    background: "#0F2044",
    color: "#FFFFFF",
    fontSize: "1rem",
    marginBottom: "1rem",
    boxSizing: "border-box",
  };

  const labelStyle = {
    color: "#8AAEC8",
    fontSize: "0.85rem",
    marginBottom: "0.4rem",
    display: "block",
  };

  const buttonStyle = {
    width: "100%",
    padding: "0.85rem",
    borderRadius: "10px",
    border: "none",
    background: "#02C39A",
    color: "#0F2044",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    marginTop: "0.5rem",
  };

  const grades = [
    "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade",
    "4th Grade", "5th Grade", "6th Grade"
  ];

  const saveProfile = async () => {
    setLoading(true);
    setError("");

    try {
      // Save parent
      const { error: parentError } = await supabase
        .from("parents")
        .upsert({ id: session.user.id, name: parentName });
      if (parentError) throw parentError;

      // Save child
      const { data: child, error: childError } = await supabase
        .from("children")
        .insert({
          parent_id: session.user.id,
          name: childName,
          grade: grades.indexOf(childGrade),
          allergies: allergies || null,
          medical_notes: medicalNotes || null,
        })
        .select()
        .single();
      if (childError) throw childError;

      // Find or create school
      const code = activationCode.toUpperCase();
      let school;
      const { data: existingSchool } = await supabase
        .from("schools")
        .select()
        .eq("activation_code", code)
        .maybeSingle();

      if (existingSchool) {
        school = existingSchool;
      } else {
        const { data: newSchool, error: schoolError } = await supabase
          .from("schools")
          .insert({ name: schoolName, activation_code: code })
          .select()
          .single();
        if (schoolError) throw schoolError;
        school = newSchool;
      }

      // Find or create classroom
      const currentYear = new Date().getFullYear();
      const schoolYear = `${currentYear}-${currentYear + 1}`;
      const gradeNumber = grades.indexOf(childGrade);

      let classroom;
      const { data: existingClassroom } = await supabase
        .from("classrooms")
        .select()
        .eq("school_id", school.id)
        .eq("teacher_name", teacherName)
        .eq("school_year", schoolYear)
        .maybeSingle();

      if (existingClassroom) {
        classroom = existingClassroom;
      } else {
        const { data: newClassroom, error: classroomError } = await supabase
          .from("classrooms")
          .insert({
            school_id: school.id,
            teacher_name: teacherName,
            grade: gradeNumber,
            school_year: schoolYear,
          })
          .select()
          .single();
        if (classroomError) throw classroomError;
        classroom = newClassroom;
      }

      // Add child to classroom
      const { error: memberError } = await supabase
        .from("classroom_members")
        .insert({
          child_id: child.id,
          classroom_id: classroom.id,
          school_year: schoolYear,
        });
      if (memberError) throw memberError;

      onComplete();

    } catch (err) {
      setError(err.message);
      console.error(err);
    }

    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0F2044",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem" }}>
        Huddle
      </h1>
      <p style={{ color: "#B0C4D8", fontSize: "0.9rem", margin: "0 0 2rem" }}>
        Let's set up your profile
      </p>

      <div style={{
        background: "#162D50",
        borderRadius: "16px",
        padding: "2rem",
        width: "100%",
        maxWidth: "400px"
      }}>

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
            <input
              type="text"
              placeholder="Jane Smith"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              style={inputStyle}
            />
            <button
              onClick={() => setStep("child")}
              disabled={!parentName}
              style={{ ...buttonStyle, background: !parentName ? "#2A4A6B" : "#02C39A", cursor: !parentName ? "not-allowed" : "pointer" }}
            >
              Next →
            </button>
          </>
        )}

        {step === "child" && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>About your child</h2>
            <label style={labelStyle}>Child's name</label>
            <input
              type="text"
              placeholder="Emma Smith"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Grade</label>
            <select
              value={childGrade}
              onChange={(e) => setChildGrade(e.target.value)}
              style={{ ...inputStyle, appearance: "none" }}
            >
              <option value="">Select grade...</option>
              {grades.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <label style={labelStyle}>Allergies (optional)</label>
            <input
              type="text"
              placeholder="e.g. peanuts, dairy"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Medical notes (optional)</label>
            <input
              type="text"
              placeholder="e.g. carries EpiPen"
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setStep("parent")}
                style={{ ...buttonStyle, background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", flex: 1 }}
              >
                ← Back
              </button>
              <button
                onClick={() => setStep("school")}
                disabled={!childName || !childGrade}
                style={{ ...buttonStyle, background: (!childName || !childGrade) ? "#2A4A6B" : "#02C39A", cursor: (!childName || !childGrade) ? "not-allowed" : "pointer", flex: 2 }}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {step === "school" && (
          <>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>Your school</h2>
            <label style={labelStyle}>School name</label>
            <input
              type="text"
              placeholder="Lincoln Elementary"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>Teacher's name</label>
            <input
              type="text"
              placeholder="Mrs. Johnson"
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              style={inputStyle}
            />
            <label style={labelStyle}>School activation code</label>
            <input
              type="text"
              placeholder="e.g. LINCOLN24"
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              style={{ ...inputStyle, textTransform: "uppercase" }}
            />
            <p style={{ color: "#607080", fontSize: "0.8rem", marginBottom: "1rem", marginTop: "-0.5rem" }}>
              Ask your school admin or PTA for the activation code. Don't have one? Enter any code to create a new school.
            </p>
            {error && (
              <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setStep("child")}
                style={{ ...buttonStyle, background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", flex: 1 }}
              >
                ← Back
              </button>
              <button
                onClick={saveProfile}
                disabled={!schoolName || !teacherName || !activationCode || loading}
                style={{ ...buttonStyle, background: (!schoolName || !teacherName || !activationCode) ? "#2A4A6B" : "#02C39A", cursor: loading ? "not-allowed" : "pointer", flex: 2 }}
              >
                {loading ? "Saving..." : "Let's go! →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}