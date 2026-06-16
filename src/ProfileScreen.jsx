import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "./supabase";
import { TERMS_OF_SERVICE, PRIVACY_POLICY, TERMS_VERSION, PRIVACY_VERSION } from "./legal";

export default function ProfileScreen({ session, onBack }) {
  const [parent, setParent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [consents, setConsents] = useState([]);
  const [view, setView] = useState("main");
  const [memberships, setMemberships] = useState([]);
  const [householdMembers, setHouseholdMembers] = useState([]);

  const grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade","6th Grade"];

  useEffect(() => {
    fetchProfile();
    fetchConsents();
    fetchFamily();
  }, []);

  // Privacy-safe short name: "Nick Psaros" -> "Nick P."
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const getGradeLabel = (g) => grades[g] || "Unknown grade";

  const fetchProfile = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("parents")
      .select("*")
      .eq("id", session.user.id)
      .single();
    setParent(data);
    setNewName(data?.name || "");
    setLoading(false);
  };

  const fetchConsents = async () => {
    const { data } = await supabase
      .from("parent_consents")
      .select("*")
      .eq("parent_id", session.user.id)
      .order("consented_at", { ascending: false });
    setConsents(data || []);
  };

  // Your classrooms + household members (the "about my family" data).
  const fetchFamily = async () => {
    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .maybeSingle();
    if (!hm) return;
    const hhId = hm.household_id;

    const { data: members } = await supabase
      .from("household_members")
      .select("id, parent_id, role, joined_at, parents(id, name, photo_url)")
      .eq("household_id", hhId)
      .order("joined_at", { ascending: true });
    setHouseholdMembers(members || []);

    const { data: ms } = await supabase
      .from("classroom_members")
      .select("id, classrooms(id, teacher_name, grade, school_year, schools(id, name))")
      .eq("household_id", hhId);
    setMemberships(ms || []);
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `${session.user.id}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("parents").update({ photo_url: cacheBustedUrl }).eq("id", session.user.id);
      setMessage("Photo updated!");
      fetchProfile();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setUploading(false);
  };

  const saveName = async () => {
    await supabase.from("parents").update({ name: newName }).eq("id", session.user.id);
    setEditing(false);
    setMessage("Name updated!");
    fetchProfile();
    setTimeout(() => setMessage(""), 3000);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const tosConsent = consents.find(c => c.document_type === "terms_of_service");
  const privacyConsent = consents.find(c => c.document_type === "privacy_policy");

  // Group classrooms by school for display.
  const bySchool = memberships.reduce((acc, m) => {
    const name = m.classrooms?.schools?.name || "Unknown School";
    if (!acc[name]) acc[name] = [];
    acc[name].push(m);
    return acc;
  }, {});

  if (view === "terms" || view === "privacy") {
    const doc = view === "terms" ? TERMS_OF_SERVICE : PRIVACY_POLICY;
    const title = view === "terms" ? "Terms of Service" : "Privacy Policy";
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B", position: "sticky", top: 0, zIndex: 10 }}>
          <button onClick={() => setView("main")} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>{title}</h1>
          <div style={{ width: "60px" }} />
        </div>
        <div style={{ padding: "1.5rem", maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ color: "#FFFFFF", fontSize: "0.9rem", lineHeight: "1.6" }}>
            <ReactMarkdown>{doc}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Profile</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "2rem" }}>
          <div onClick={() => document.getElementById("photo-upload").click()}
            style={{ width: "120px", height: "120px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", fontWeight: "600", color: "#FFFFFF", cursor: "pointer", overflow: "hidden", border: "3px solid #02C39A", position: "relative", marginBottom: "0.75rem" }}>
            {parent?.photo_url ? (
              <img src={parent.photo_url} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              parent?.name?.charAt(0) || "?"
            )}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", padding: "4px 0", textAlign: "center", fontSize: "0.65rem", color: "#FFFFFF" }}>
              {uploading ? "Uploading..." : "Tap to change"}
            </div>
          </div>
          <input id="photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={uploadPhoto} />

          {editing ? (
            <div style={{ width: "100%", maxWidth: "300px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "1rem", textAlign: "center", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                <button onClick={() => { setEditing(false); setNewName(parent?.name || ""); }}
                  style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer" }}>
                  Cancel
                </button>
                <button onClick={saveName}
                  style={{ flex: 2, padding: "0.5rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <p style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: 0 }}>{parent?.name}</p>
              <button onClick={() => setEditing(true)}
                style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.7rem", cursor: "pointer" }}>
                Edit
              </button>
            </div>
          )}
        </div>

        {/* YOUR CLASSROOMS */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>YOUR CLASSROOMS</p>
        {memberships.length === 0 ? (
          <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", padding: "1rem 1.25rem", marginBottom: "1rem" }}>
            <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>No classrooms yet.</p>
          </div>
        ) : (
          <div style={{ marginBottom: "1rem" }}>
            {Object.entries(bySchool).map(([schoolName, classes]) => (
              <div key={schoolName} style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "0.75rem", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.85rem 1rem", background: "#1A3A5C", borderBottom: "1px solid #2A4A6B" }}>
                  <span style={{ fontSize: "1.1rem" }}>🏫</span>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "600", margin: 0 }}>{schoolName}</p>
                </div>
                {classes.map((m, idx) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.75rem 1rem", borderBottom: idx < classes.length - 1 ? "1px solid #2A4A6B" : "none" }}>
                    <span style={{ fontSize: "0.95rem" }}>📚</span>
                    <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>
                      {m.classrooms?.teacher_name} · {getGradeLabel(m.classrooms?.grade)}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* YOUR HOUSEHOLD */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 0.75rem", letterSpacing: "0.05em" }}>YOUR HOUSEHOLD</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem", overflow: "hidden" }}>
          {householdMembers.length === 0 ? (
            <div style={{ padding: "1rem 1.25rem" }}>
              <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Just you for now.</p>
            </div>
          ) : (
            householdMembers.map((m, idx) => {
              const isMe = m.parent_id === session.user.id;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0.85rem 1rem", borderBottom: idx < householdMembers.length - 1 ? "1px solid #2A4A6B" : "none" }}>
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
              );
            })
          )}
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem", marginTop: "1.5rem" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 4px", letterSpacing: "0.05em" }}>EMAIL</p>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>{session.user.email}</p>
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 4px", letterSpacing: "0.05em" }}>MEMBER SINCE</p>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>
              {new Date(parent?.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          </div>
        </div>

        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 0.75rem", letterSpacing: "0.05em" }}>LEGAL</p>

        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem" }}>
          <div onClick={() => setView("terms")}
            style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Terms of Service</p>
              <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                {tosConsent
                  ? `v${tosConsent.document_version} · agreed ${new Date(tosConsent.consented_at).toLocaleDateString()}`
                  : "Not yet agreed"}
              </p>
            </div>
            <span style={{ color: "#02C39A", fontSize: "1.1rem" }}>→</span>
          </div>
          <div onClick={() => setView("privacy")}
            style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2A4A6B", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 2px" }}>Privacy Policy</p>
              <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
                {privacyConsent
                  ? `v${privacyConsent.document_version} · agreed ${new Date(privacyConsent.consented_at).toLocaleDateString()}`
                  : "Not yet agreed"}
              </p>
            </div>
            <span style={{ color: "#02C39A", fontSize: "1.1rem" }}>→</span>
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: "0 0 4px" }}>Request data deletion</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>
              Email <span style={{ color: "#02C39A" }}>admin@huddlefamilies.com</span> to request account and data deletion
            </p>
          </div>
        </div>

        <button onClick={signOut}
          style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #F87171", background: "transparent", color: "#F87171", fontSize: "1rem", cursor: "pointer", marginTop: "1rem" }}>
          Sign out
        </button>
      </div>
    </div>
  );
}