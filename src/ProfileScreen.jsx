import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

export default function ProfileScreen({ session, onBack }) {
  const [parent, setParent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => { fetchProfile(); }, []);

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

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPhoto(true);
    const fileExt = file.name.split(".").pop();
    const filePath = `${session.user.id}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true });
    if (uploadError) {
      setMessage("Error uploading photo");
      setUploadingPhoto(false);
      return;
    }
    const { data: { publicUrl } } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);
    await supabase.from("parents").update({ photo_url: publicUrl }).eq("id", session.user.id);
    setMessage("Photo updated!");
    fetchProfile();
    setUploadingPhoto(false);
  };

  const saveName = async () => {
    setSaving(true);
    await supabase.from("parents").update({ name: newName }).eq("id", session.user.id);
    setEditingName(false);
    setMessage("Name updated!");
    fetchProfile();
    setSaving(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const inputStyle = {
    width: "100%",
    padding: "0.85rem 1rem",
    borderRadius: "10px",
    border: "1px solid #2A4A6B",
    background: "#0F2044",
    color: "#FFFFFF",
    fontSize: "1rem",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>
          Back
        </button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>My Profile</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "2rem" }}>
          <div
            onClick={() => fileInputRef.current.click()}
            style={{ width: "100px", height: "100px", borderRadius: "50%", background: parent?.photo_url ? "transparent" : "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.5rem", cursor: "pointer", position: "relative", overflow: "hidden", border: "3px solid #02C39A" }}
          >
            {parent?.photo_url ? (
              <img src={parent.photo_url} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span>{parent?.name?.charAt(0) || "?"}</span>
            )}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.5)", padding: "4px 0", textAlign: "center", fontSize: "0.65rem", color: "#FFFFFF" }}>
              {uploadingPhoto ? "Uploading..." : "Edit"}
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={uploadPhoto} style={{ display: "none" }} />
          <p style={{ color: "#607080", fontSize: "0.8rem", marginTop: "0.5rem" }}>Tap photo to change</p>
        </div>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>YOUR NAME</p>
          {editingName ? (
            <div>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, marginBottom: "0.75rem" }} />
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setEditingName(false)} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", cursor: "pointer" }}>Cancel</button>
                <button onClick={saveName} disabled={saving} style={{ flex: 2, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontWeight: "600", cursor: "pointer" }}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: 0 }}>{parent?.name}</p>
              <button onClick={() => setEditingName(true)} style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", padding: "0.3rem 0.7rem", borderRadius: "6px", fontSize: "0.8rem", cursor: "pointer" }}>Edit</button>
            </div>
          )}
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>EMAIL</p>
          <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: 0 }}>{session.user.email}</p>
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>TRUST SCORE</p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <p style={{ color: "#02C39A", fontSize: "1.5rem", fontWeight: "700", margin: 0 }}>{parent?.trust_score || 0}</p>
            <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>points — complete playdates to earn more</p>
          </div>
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>PRIVACY</p>
          {[
            ["Show my name to classmates", true],
            ["Allow playdate requests", true],
            ["Show trust score on profile", true],
          ].map(([label, defaultVal]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>{label}</p>
              <div style={{ width: "44px", height: "24px", borderRadius: "12px", background: defaultVal ? "#02C39A" : "#2A4A6B", position: "relative", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "50%", background: "#FFFFFF", position: "absolute", top: "3px", left: defaultVal ? "23px" : "3px" }} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>NOTIFICATIONS</p>
          {[
            ["Playdate requests", true],
            ["Messages", true],
            ["Playdate reminders", true],
            ["Rating prompts", false],
          ].map(([label, defaultVal]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>{label}</p>
              <div style={{ width: "44px", height: "24px", borderRadius: "12px", background: defaultVal ? "#02C39A" : "#2A4A6B", position: "relative", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "50%", background: "#FFFFFF", position: "absolute", top: "3px", left: defaultVal ? "23px" : "3px" }} />
              </div>
            </div>
          ))}
        </div>

        <button onClick={signOut} style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #E05A5A", background: "transparent", color: "#E05A5A", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
          Sign out
        </button>

        <p style={{ color: "#607080", fontSize: "0.75rem", textAlign: "center", marginTop: "1rem" }}>
          Huddle v0.1 — huddlefamilies.com
        </p>

      </div>
    </div>
  );
}