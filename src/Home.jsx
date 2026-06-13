import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ProfileScreen from "./ProfileScreen";
import PlaydateRequest from "./PlaydateRequest";

export default function Home({ session }) {
  const [parent, setParent] = useState(null);
  const [children, setChildren] = useState([]);
  const [classmates, setClassmates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingChild, setAddingChild] = useState(false);
  const [editingChild, setEditingChild] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
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

  const uploadChildPhoto = async (e, childId) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileExt = file.name.split(".").pop();
    const filePath = `child-${childId}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars").upload(filePath, file, { upsert: true });
    if (uploadError) { console.error(uploadError); return; }
    const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(filePath);
    await supabase.from("children").update({ photo_url: publicUrl }).eq("id", childId);
    fetchData();
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
        if (newChildSchool) await supabase.from("schools").update({ name: newChildSchool }).eq("id", existingSchool.id);
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
      if (editingChild.classroomId) await supabase.from("classrooms").update({ teacher_name: editingChild.teacher }).eq("id", editingChild.classroomId);
      if (editingChild.schoolId) await supabase.from("schools").update({ name: editingChild.school }).eq("id", editingChild.schoolId);
      setEditingChild(null);
      setChildError("");
      fetchData();
    } catch (err) { setChildError(err.message); }
    setChildLoading(false);
  };

  const signOut = async () => { await supabase.auth.signOut(); };
  const getGradeLabel = (gradeNum) => grades[gradeNum] || "Unknown grade";

  // Group children by school
  ;const childrenBySchool = children.reduce((acc, child) => {
    const currentYear = new Date().getFullYear();
    const schoolYear = `${currentYear}-${currentYear + 1}`;
    const membership = child.classroom_members?.find(m => m.school_year === schoolYear);
    const schoolName = membership?.classrooms?.schools?.name || "Unknown School";
    const schoolKey = schoolName.toLowerCase().replace(/\s+/g, "-");
    if (!acc[schoolKey]) acc[schoolKey] = { name: schoolName, classrooms: {} };
    const classroomId = membership?.classrooms?.id || "unknown";
    const classroomName = membership?.classrooms?.teacher_name || "Unknown Teacher";
    const grade = membership?.classrooms?.grade;
    if (!acc[schoolKey].classrooms[classroomId]) {
      acc[schoolKey].classrooms[classroomId] = { teacher: classroomName, grade, children: [] };
    }
    acc[schoolKey].classrooms[classroomId].children.push(child);
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
      <PlaydateRequest
        session={session}
        recipient={requestingPlaydate}
        onBack={() => setRequestingPlaydate(null)}
        onSent={() => setRequestingPlaydate(null)}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0 }}>Huddle</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span onClick={() => setShowProfile(true)} style={{ color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer", textDecoration: "underline" }}>
            Hi, {parent?.name?.split(" ")[0]}!
          </span>
          {parent?.photo_url && (
            <img src={parent.photo_url} alt="Profile" onClick={() => setShowProfile(true)} style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "2px solid #02C39A" }} />
          )}
        </div>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* YOUR CHILDREN */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>YOUR CHILDREN</p>

        {/* Schools */}
        {Object.entries(childrenBySchool).map(([schoolId, school]) => (
          <div key={schoolId} style={{ marginBottom: "1.5rem" }}>

            {/* School header */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.75rem", padding: "0.75rem 1rem", background: "#1A3A5C", borderRadius: "10px 10px 0 0", borderBottom: "2px solid #02C39A" }}>
              <span style={{ fontSize: "1.2rem" }}>🏫</span>
              <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "600", margin: 0 }}>{school.name}</p>
            </div>

            {/* Classrooms */}
            <div style={{ background: "#162D50", borderRadius: "0 0 12px 12px", border: "1px solid #2A4A6B", borderTop: "none", overflow: "hidden" }}>
              {Object.entries(school.classrooms).map(([classroomId, classroom], idx, arr) => (
                <div key={classroomId} style={{ borderBottom: idx < arr.length - 1 ? "1px solid #2A4A6B" : "none" }}>

                  {/* Classroom header */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.6rem 1rem", background: "#0F2A45" }}>
                    <span style={{ fontSize: "1rem" }}>📚</span>
                    <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: 0 }}>
                      {classroom.teacher} · {getGradeLabel(classroom.grade)}
                    </p>
                  </div>

                  {/* Children in this classroom */}
                  <div style={{ display: "flex", gap: "10px", padding: "1rem", flexWrap: "wrap" }}>
                    {classroom.children.map((child) => (
                      <div key={child.id} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", minWidth: "100px" }}>
                        <button onClick={() => openEdit(child)} style={{ position: "absolute", top: "-4px", right: "-4px", background: "#162D50", border: "1px solid #2A4A6B", color: "#8AAEC8", borderRadius: "50%", width: "22px", height: "22px", fontSize: "0.65rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>✏️</button>

                        {/* Child photo */}
                        <div
                          onClick={() => document.getElementById(`child-photo-${child.id}`).click()}
                          style={{ width: "64px", height: "64px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", cursor: "pointer", overflow: "hidden", border: "3px solid #02C39A", position: "relative", marginBottom: "0.5rem" }}>
                          {child.photo_url ? (
                            <img src={child.photo_url} alt={child.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span>👦</span>
                          )}
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", padding: "2px 0", textAlign: "center", fontSize: "0.5rem", color: "#FFFFFF" }}>edit</div>
                        </div>
                        <input id={`child-photo-${child.id}`} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => uploadChildPhoto(e, child.id)} />

                        <p style={{ color: "#FFFFFF", fontSize: "0.85rem", fontWeight: "600", margin: "0 0 2px", textAlign: "center" }}>{child.name}</p>
                        <p style={{ color: "#02C39A", fontSize: "0.7rem", margin: 0, textAlign: "center" }}>{getGradeLabel(child.grade)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Add a child button */}
              <div
                onClick={() => setAddingChild(true)}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", cursor: "pointer", borderTop: "1px dashed #2A4A6B" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "1px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", color: "#607080", fontSize: "1rem" }}>+</div>
                <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Add another child</p>
              </div>
            </div>
          </div>
        ))}

        {/* If no children yet */}
        {children.length === 0 && (
          <div
            onClick={() => setAddingChild(true)}
            style={{ background: "#162D50", borderRadius: "12px", padding: "1.5rem", border: "1px dashed #2A4A6B", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", gap: "8px", marginBottom: "1.5rem" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "50%", border: "2px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", color: "#2A4A6B" }}>+</div>
            <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Add your first child</p>
          </div>
        )}

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
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0, overflow: "hidden" }}>
                  {member.children?.parents?.photo_url ? (
                    <img src={member.children.parents.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    member.children?.parents?.name?.charAt(0) || "?"
                  )}
                </div>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{member.children?.parents?.name || "Unknown Parent"}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Parent of {member.children?.name}</p>
                </div>
              </div>
              <button
                onClick={() => setRequestingPlaydate(member.children?.parents)}
                style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
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
            <input type="text" value={editingChild.name} onChange={(e) => setEditingChild({ ...editingChild, name: e.target.value })} style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={editingChild.grade} onChange={(e) => setEditingChild({ ...editingChild, grade: e.target.value })} style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <input type="text" value={editingChild.teacher} onChange={(e) => setEditingChild({ ...editingChild, teacher: e.target.value })} style={inputStyle} />
            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <input type="text" value={editingChild.school || ""} onChange={(e) => setEditingChild({ ...editingChild, school: e.target.value })} style={inputStyle} />
            {childError && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{childError}</p>}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => { setEditingChild(null); setChildError(""); }} style={{ flex: 1, padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "1rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={saveEdit} disabled={childLoading} style={{ flex: 2, padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
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