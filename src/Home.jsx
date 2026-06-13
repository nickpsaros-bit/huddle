import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Home({ session }) {
  const [parent, setParent] = useState(null);
  const [children, setChildren] = useState([]);
  const [classmates, setClassmates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingChild, setAddingChild] = useState(false);
  const [editingChild, setEditingChild] = useState(null);
  const [newChildName, setNewChildName] = useState("");
  const [newChildGrade, setNewChildGrade] = useState("");
  const [newChildTeacher, setNewChildTeacher] = useState("");
  const [newChildCode, setNewChildCode] = useState("");
  const [newChildSchool, setNewChildSchool] = useState("");
  const [childLoading, setChildLoading] = useState(false);
  const [childError, setChildError] = useState("");

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: parentData } = await supabase.from("parents").select("*").eq("id", session.user.id).single();
    setParent(parentData);

    const { data: childrenData } = await supabase
      .from("children")
      .select("*, classroom_members(*, classrooms(id, teacher_name, grade, school_year, school_id, schools(id, name)))")
      .eq("parent_id", session.user.id);
    setChildren(childrenData || []);

    if (!childrenData || childrenData.length === 0) { setLoading(false); return; }

    const currentYear = new Date().getFullYear();
    const schoolYear = `${currentYear}-${currentYear + 1}`;
    const member = childrenData[0]?.classroom_members?.find(m => m.school_year === schoolYear);
    if (!member) { setLoading(false); return; }

    const { data: classmateMembers } = await supabase
      .from("classroom_members")
      .select("*, children(*, parents(*))")
      .eq("classroom_id", member.classroom_id)
      .eq("school_year", schoolYear);

    setClassmates(classmateMembers?.filter(m => m.children?.parent_id !== session.user.id) || []);
    setLoading(false);
  };

  const saveNewChild = async () => {
    setChildLoading(true);
    setChildError("");
    try {
      const { data: child, error: childErr } = await supabase
        .from("children")
        .insert({ parent_id: session.user.id, name: newChildName, grade: grades.indexOf(newChildGrade) })
        .select().single();
      if (childErr) throw childErr;

      const code = newChildCode.toUpperCase();
      let school;
      const { data: existingSchool } = await supabase.from("schools").select().eq("activation_code", code).maybeSingle();
      if (existingSchool) {
        school = existingSchool;
        // Update school name if provided
        if (newChildSchool) {
          await supabase.from("schools").update({ name: newChildSchool }).eq("id", existingSchool.id);
        }
      } else {
        const { data: newSchool, error: schoolErr } = await supabase.from("schools")
          .insert({ name: newChildSchool || "My School", activation_code: code }).select().single();
        if (schoolErr) throw schoolErr;
        school = newSchool;
      }

      const currentYear = new Date().getFullYear();
      const schoolYear = `${currentYear}-${currentYear + 1}`;
      let classroom;
      const { data: existingClassroom } = await supabase.from("classrooms").select()
        .eq("school_id", school.id).eq("teacher_name", newChildTeacher).eq("school_year", schoolYear).maybeSingle();
      if (existingClassroom) { classroom = existingClassroom; }
      else {
        const { data: newClassroom, error: classroomErr } = await supabase.from("classrooms")
          .insert({ school_id: school.id, teacher_name: newChildTeacher, grade: grades.indexOf(newChildGrade), school_year: schoolYear })
          .select().single();
        if (classroomErr) throw classroomErr;
        classroom = newClassroom;
      }

      await supabase.from("classroom_members").insert({ child_id: child.id, classroom_id: classroom.id, school_year: schoolYear });
      setAddingChild(false);
      setNewChildName(""); setNewChildGrade(""); setNewChildTeacher(""); setNewChildCode(""); setNewChildSchool("");
      fetchData();
    } catch (err) { setChildError(err.message); }
    setChildLoading(false);
  };

  const openEdit = (child) => {
    const currentYear = new Date().getFullYear();
    const schoolYear = `${currentYear}-${currentYear + 1}`;
    const membership = child.classroom_members?.find(m => m.school_year === schoolYear);
    setEditingChild({
      id: child.id,
      name: child.name,
      grade: grades[child.grade] || "",
      teacher: membership?.classrooms?.teacher_name || "",
      school: membership?.classrooms?.schools?.name || "",
      classroomId: membership?.classrooms?.id || null,
      schoolId: membership?.classrooms?.schools?.id || null,
    });
  };

  const saveEdit = async () => {
    setChildLoading(true);
    setChildError("");
    try {
      const { error: childErr } = await supabase
        .from("children")
        .update({ name: editingChild.name, grade: grades.indexOf(editingChild.grade) })
        .eq("id", editingChild.id);
      if (childErr) throw childErr;

      if (editingChild.classroomId) {
        await supabase.from("classrooms")
          .update({ teacher_name: editingChild.teacher })
          .eq("id", editingChild.classroomId);
      }
      if (editingChild.schoolId) {
        await supabase.from("schools")
          .update({ name: editingChild.school })
          .eq("id", editingChild.schoolId);
      }

      setEditingChild(null);
      setChildError("");
      fetchData();
    } catch (err) { setChildError(err.message); }
    setChildLoading(false);
  };

  const signOut = async () => { await supabase.auth.signOut(); };
  const getGradeLabel = (gradeNum) => grades[gradeNum] || "Unknown grade";

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

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0 }}>Huddle</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: "#8AAEC8", fontSize: "0.85rem" }}>Hi, {parent?.name?.split(" ")[0]}!</span>
          <button onClick={signOut} style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", padding: "0.4rem 0.8rem", borderRadius: "8px", fontSize: "0.8rem", cursor: "pointer" }}>Sign out</button>
        </div>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* Your Children */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>YOUR CHILDREN</p>
        <div style={{ display: "flex", gap: "10px", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {children.map((child) => {
            const currentYear = new Date().getFullYear();
            const schoolYear = `${currentYear}-${currentYear + 1}`;
            const membership = child.classroom_members?.find(m => m.school_year === schoolYear);
            return (
              <div key={child.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem", border: "1px solid #2A4A6B", flex: "1", minWidth: "140px", maxWidth: "180px", position: "relative" }}>
                <button onClick={() => openEdit(child)} style={{ position: "absolute", top: "8px", right: "8px", background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", borderRadius: "6px", padding: "2px 7px", fontSize: "0.75rem", cursor: "pointer" }}>✏️</button>
                <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", margin: "0 auto 0.75rem" }}>👦</div>
                <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "600", margin: "0 0 4px", textAlign: "center" }}>{child.name}</p>
                <p style={{ color: "#02C39A", fontSize: "0.75rem", margin: "0 0 4px", textAlign: "center" }}>{getGradeLabel(child.grade)}</p>
                {membership?.classrooms?.teacher_name && (
                  <p style={{ color: "#607080", fontSize: "0.72rem", margin: "0 0 2px", textAlign: "center" }}>{membership.classrooms.teacher_name}</p>
                )}
                {membership?.classrooms?.schools?.name && (
                  <p style={{ color: "#607080", fontSize: "0.72rem", margin: 0, textAlign: "center" }}>{membership.classrooms.schools.name}</p>
                )}
              </div>
            );
          })}

          {/* Add child card */}
          <div onClick={() => setAddingChild(true)} style={{ background: "transparent", borderRadius: "12px", padding: "1rem", border: "1px dashed #2A4A6B", flex: "1", minWidth: "140px", maxWidth: "180px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", gap: "8px" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "50%", border: "2px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", color: "#2A4A6B" }}>+</div>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0, textAlign: "center" }}>Add a child</p>
          </div>
        </div>

        {/* Classroom */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>YOUR CLASSROOM</p>
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>
            {classmates.length > 0 ? `${classmates.length} ${classmates.length === 1 ? "family" : "families"} in your class` : "You're the first one here!"}
          </p>
          <p style={{ color: "#607080", fontSize: "0.8rem", margin: "4px 0 0" }}>Share Huddle with other parents to get started</p>
        </div>

        {/* Classmates */}
        {classmates.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>👋</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No classmates yet</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Share Huddle with other parents in your class to get started!</p>
          </div>
        ) : (
          classmates.map((member) => (
            <div key={member.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0 }}>
                  {member.children?.parents?.name?.charAt(0) || "?"}
                </div>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{member.children?.parents?.name || "Unknown Parent"}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Parent of {member.children?.name}</p>
                </div>
              </div>
              <button style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                Huddle →
              </button>
            </div>
          ))
        )}
      </div>

      {/* Edit child modal */}
      {editingChild && (
        <div style={overlay}>
          <div style={modalBox}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>Edit child</h2>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Child's name</label>
            <input type="text" value={editingChild.name}
              onChange={(e) => setEditingChild({ ...editingChild, name: e.target.value })}
              style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={editingChild.grade}
              onChange={(e) => setEditingChild({ ...editingChild, grade: e.target.value })}
              style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <input type="text" value={editingChild.teacher}
              onChange={(e) => setEditingChild({ ...editingChild, teacher: e.target.value })}
              style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <input type="text" placeholder="Sun Valley Elementary" value={editingChild.school || ""}
              onChange={(e) => setEditingChild({ ...editingChild, school: e.target.value })}
              style={inputStyle} />
            {childError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{childError}</p>}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => { setEditingChild(null); setChildError(""); }}
                style={{ flex: 1, padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={saveEdit} disabled={childLoading}
                style={{ flex: 2, padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
                {childLoading ? "Saving..." : "Save changes →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add child modal */}
      {addingChild && (
        <div style={overlay}>
          <div style={modalBox}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 1.5rem" }}>Add another child</h2>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Child's name</label>
            <input type="text" placeholder="Child's name" value={newChildName} onChange={(e) => setNewChildName(e.target.value)} style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={newChildGrade} onChange={(e) => setNewChildGrade(e.target.value)} style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <input type="text" placeholder="Sun Valley Elementary" value={newChildSchool} onChange={(e) => setNewChildSchool(e.target.value)} style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <input type="text" placeholder="Mrs. Johnson" value={newChildTeacher} onChange={(e) => setNewChildTeacher(e.target.value)} style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Activation code</label>
            <input type="text" placeholder="e.g. LINCOLN24" value={newChildCode} onChange={(e) => setNewChildCode(e.target.value)} style={{ ...inputStyle, textTransform: "uppercase" }} />
            {childError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{childError}</p>}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setAddingChild(false)} style={{ flex: 1, padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={saveNewChild} disabled={!newChildName || !newChildGrade || !newChildTeacher || !newChildCode || childLoading}
                style={{ flex: 2, padding: "0.85rem", borderRadius: "10px", border: "none", background: (!newChildName || !newChildGrade || !newChildTeacher || !newChildCode) ? "#2A4A6B" : "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
                {childLoading ? "Saving..." : "Add child →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}