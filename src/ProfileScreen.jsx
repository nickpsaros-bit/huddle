import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ConfirmModal from "./ConfirmModal";
import PlaydateRequest from "./PlaydateRequest";
import Button from "./Button";

export default function ProfileScreen({ session, onBack, onOpenSettings }) {
  const [parent, setParent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [memberships, setMemberships] = useState([]);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [householdId, setHouseholdId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
 const [prefs, setPrefs] = useState({
    has_dog: false, has_cat: false, has_horse: false, has_other: false, other_label: "",
    prefer_no_dogs: false, prefer_no_cats: false,
  });
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Birthdays (household attribute; month/day only, optional label).
  const [birthdays, setBirthdays] = useState([]);
  const [bdayMonth, setBdayMonth] = useState("");
  const [bdayDay, setBdayDay] = useState("");
  const [bdayLabel, setBdayLabel] = useState("");
  const [bdayBusy, setBdayBusy] = useState(false);
  const [bdayInviteOpen, setBdayInviteOpen] = useState(false);   // family picker open
  const [bdayPeople, setBdayPeople] = useState([]);               // families I can invite
  const [bdayPeopleLoading, setBdayPeopleLoading] = useState(false);
  const [bdaySelected, setBdaySelected] = useState({});           // parentId -> person
  const [bdayLaunch, setBdayLaunch] = useState(null);             // array of recipients -> opens form

  // ---- Link a household member (find a co-parent in your classrooms) ----
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkPeople, setLinkPeople] = useState([]);
  const [linkBusyId, setLinkBusyId] = useState(null);
  const [pendingRequest, setPendingRequest] = useState(null); // an outgoing join request I've already sent

  const grades = ["TK","Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade"];

  useEffect(() => {
    fetchProfile();
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

  // Your classrooms + household members (the "about my family" data) + pet prefs.
  const fetchFamily = async () => {
    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .maybeSingle();
    if (!hm) return;
    const hhId = hm.household_id;
    setHouseholdId(hhId);

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

    // Load household pet preferences (may not exist yet).
    const { data: pref } = await supabase
      .from("household_preferences")
      .select("*")
      .eq("household_id", hhId)
      .maybeSingle();
    if (pref) {
    setPrefs({
        has_dog: !!pref.has_dog,
        has_cat: !!pref.has_cat,
        has_horse: !!pref.has_horse,
        has_other: !!pref.has_other,
        other_label: pref.other_label || "",
        prefer_no_dogs: !!pref.prefer_no_dogs,
        prefer_no_cats: !!pref.prefer_no_cats,
      });
    }

    // Load this household's birthdays (month/day only).
    const { data: bdays } = await supabase
      .from("household_birthdays")
      .select("id, month, day, label")
      .eq("household_id", hhId)
      .order("month", { ascending: true })
      .order("day", { ascending: true });
    setBirthdays(bdays || []);

    // Any outgoing household-link request I've already sent that's still pending?
    const { data: outgoing } = await supabase
      .from("household_join_requests")
      .select("id, target_household_id, status, created_at")
      .eq("requesting_parent_id", session.user.id)
      .eq("status", "pending")
      .maybeSingle();
    setPendingRequest(outgoing || null);
  };

  const savePrefs = async () => {
    if (!householdId) return;
    setSavingPrefs(true);
    setMessage("");
    try {
      const { error } = await supabase
        .from("household_preferences")
        .upsert({
          household_id: householdId,
          has_dog: prefs.has_dog,
          has_cat: prefs.has_cat,
          has_horse: prefs.has_horse,
          has_other: prefs.has_other,
          other_label: prefs.has_other ? (prefs.other_label || null) : null,
          prefer_no_dogs: prefs.prefer_no_dogs,
          prefer_no_cats: prefs.prefer_no_cats,
          updated_at: new Date().toISOString(),
        }, { onConflict: "household_id" });
      if (error) throw error;
      setMessage("Pets & preferences saved!");
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setSavingPrefs(false);
  };

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const addBirthday = async () => {
    const m = parseInt(bdayMonth, 10);
    const d = parseInt(bdayDay, 10);
    if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
      setMessage("Please pick a valid month and day.");
      setTimeout(() => setMessage(""), 3000);
      return;
    }
    if (!householdId) return;
    setBdayBusy(true);
    try {
      const { error } = await supabase.from("household_birthdays").insert({
        household_id: householdId,
        month: m,
        day: d,
        label: bdayLabel.trim() || null,
      });
      if (error) throw error;
      setBdayMonth(""); setBdayDay(""); setBdayLabel("");
      setMessage("Birthday added 🎂");
      fetchFamily();
      setTimeout(() => setMessage(""), 2500);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBdayBusy(false);
  };

  // Open the birthday family picker and load families I can invite
  // (accepted connections + parents sharing my classrooms).
  const openBirthdayInvite = async () => {
    setBdayInviteOpen(true);
    setBdaySelected({});
    setBdayPeopleLoading(true);
    try {
      const uid = session.user.id;
      const peopleById = {};

      // Connections (accepted).
      const { data: conns } = await supabase
        .from("connections")
        .select(`requester:parents!connections_requester_id_fkey(id, name, photo_url), recipient:parents!connections_recipient_id_fkey(id, name, photo_url), requester_id, recipient_id`)
        .or(`requester_id.eq.${uid},recipient_id.eq.${uid}`)
        .eq("status", "accepted");
      for (const c of (conns || [])) {
        const p = c.requester_id === uid ? c.recipient : c.requester;
        if (p && p.id && p.id !== uid) peopleById[p.id] = p;
      }

      // Classmates: parents sharing my classrooms.
      if (householdId) {
        const { data: myCms } = await supabase
          .from("classroom_members")
          .select("classroom_id, school_year")
          .eq("household_id", householdId);
        for (const cm of (myCms || [])) {
          const { data: mates } = await supabase
            .from("classroom_members")
            .select("households(household_members(parents(id, name, photo_url)))")
            .eq("classroom_id", cm.classroom_id)
            .eq("school_year", cm.school_year)
            .neq("household_id", householdId);
          for (const row of (mates || [])) {
            const members = row.households?.household_members || [];
            for (const mm of members) {
              const p = mm.parents;
              if (p && p.id && p.id !== uid) peopleById[p.id] = p;
            }
          }
        }
      }

      setBdayPeople(Object.values(peopleById).sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    } catch (err) {
      setMessage("Couldn't load families: " + err.message);
    }
    setBdayPeopleLoading(false);
  };

  const toggleBdaySelect = (person) => {
    setBdaySelected((prev) => {
      const next = { ...prev };
      if (next[person.id]) delete next[person.id];
      else next[person.id] = person;
      return next;
    });
  };

  const continueToBirthdayForm = () => {
    const recipients = Object.values(bdaySelected);
    if (recipients.length === 0) return;
    setBdayInviteOpen(false);
    setBdayLaunch(recipients);
  };

  const deleteBirthday = async (id) => {
    setBdayBusy(true);
    try {
      const { error } = await supabase.from("household_birthdays").delete().eq("id", id);
      if (error) throw error;
      setMessage("Birthday removed");
      fetchFamily();
      setTimeout(() => setMessage(""), 2500);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBdayBusy(false);
  };

  // Open the link panel and load people in MY classrooms who are in a DIFFERENT
  // household than mine (candidates to merge into my household as a co-parent).
  const openLink = async () => {
    setLinkOpen(true);
    setLinkSearch("");
    setLinkLoading(true);
    try {
      const userId = session.user.id;
      if (!householdId) { setLinkPeople([]); setLinkLoading(false); return; }

      const { data: myMs } = await supabase
        .from("classroom_members")
        .select("classroom_id, school_year")
        .eq("household_id", householdId);

      const peopleMap = {};
      for (const m of (myMs || [])) {
        const { data: others } = await supabase
          .from("classroom_members")
          .select("household_id, households(household_members(parent_id, parents(id, name, photo_url)))")
          .eq("classroom_id", m.classroom_id)
          .eq("school_year", m.school_year)
          .neq("household_id", householdId);

        for (const row of (others || [])) {
          const members = row.households?.household_members || [];
          for (const hm2 of members) {
            const p = hm2.parents;
            if (p && p.id && p.id !== userId && !peopleMap[p.id]) {
              peopleMap[p.id] = {
                id: p.id,
                name: p.name,
                photo_url: p.photo_url,
                household_id: row.household_id,
              };
            }
          }
        }
      }

      const list = Object.values(peopleMap).sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      setLinkPeople(list);
    } catch (e) {
      setLinkPeople([]);
    }
    setLinkLoading(false);
  };

  // Send a household-link request to the chosen person's household.
  // Inbox.jsx (approveJoin) handles the approval + merge on the other side.
  const askToLink = async (person) => {
    if (!person?.household_id) return;
    setLinkBusyId(person.id);
    setMessage("");
    try {
      const { data: inserted, error } = await supabase
        .from("household_join_requests")
        .insert({
          requesting_parent_id: session.user.id,
          target_household_id: person.household_id,
          status: "pending",
        })
        .select("id, target_household_id, status, created_at")
        .single();
      if (error && !error.message.includes("duplicate")) throw error;

      // Notify the target household's members (best-effort).
      try {
        const { data: me } = await supabase.from("parents").select("name").eq("id", session.user.id).single();
        const myLabel = shortName(me?.name);
        const { data: targetMembers } = await supabase
          .from("household_members")
          .select("parent_id")
          .eq("household_id", person.household_id);
        const rows = (targetMembers || []).map((m) => ({
          recipient_id: m.parent_id,
          type: "household_join_request",
          title: "Household link request 🏡",
          body: `${myLabel} wants to join your household. Open your notifications to approve.`,
        }));
        if (rows.length > 0) await supabase.from("notifications").insert(rows);
      } catch (notifErr) {
        // Best-effort.
      }

      if (inserted) setPendingRequest(inserted);
      setLinkOpen(false);
      setMessage(`Request sent to ${shortName(person.name)}. They'll need to approve it.`);
      setTimeout(() => setMessage(""), 4000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setLinkBusyId(null);
  };

  // Cancel an outgoing pending request.
  const cancelRequest = async () => {
    if (!pendingRequest) return;
    setMessage("");
    try {
      await supabase
        .from("household_join_requests")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("id", pendingRequest.id);
      setPendingRequest(null);
      setMessage("Request cancelled.");
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
  };

  // Remove a member (or leave the household). Calls the atomic RPC, which:
  // gives the removed person a fresh solo household with their classrooms copied,
  // and enforces the rules server-side (leave-self always ok; primary removes
  // co-parents; primary can't be removed by a co-parent).
  const doRemoveMember = async (targetParentId) => {
    setRemoveBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.rpc("remove_household_member", {
        p_target_parent: targetParentId,
      });
      if (error) throw error;
      const leftSelf = targetParentId === session.user.id;
      setMessage(leftSelf ? "You've left the household." : "Member removed.");
      // Reload household data (if I left, my household changed entirely).
      fetchProfile();
      fetchFamily();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setRemoveBusy(false);
  };

  // Opens the iOS-safe confirm modal for leaving or removing.
  const confirmRemove = (m, isMe) => {
    if (isMe) {
      setConfirm({
        title: "Leave this household?",
        body: "You'll get your own household and keep your classrooms. You can link up again later.",
        confirmLabel: "Leave",
        cancelLabel: "Stay",
        tone: "danger",
        onConfirm: () => doRemoveMember(session.user.id),
      });
    } else {
      setConfirm({
        title: `Remove ${shortName(m.parents?.name)}?`,
        body: `${shortName(m.parents?.name)} will get their own household and keep their classrooms. They won't be part of your household anymore.`,
        confirmLabel: "Remove",
        cancelLabel: "Keep",
        tone: "danger",
        onConfirm: () => doRemoveMember(m.parent_id),
      });
    }
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

  // Group classrooms by school for display.
  const bySchool = memberships.reduce((acc, m) => {
    const name = m.classrooms?.schools?.name || "Unknown School";
    if (!acc[name]) acc[name] = [];
    acc[name].push(m);
    return acc;
  }, {});

  // A reusable toggle pill for the pets/preferences section.
  const togglePill = (active, label, onClick) => (
    <button onClick={onClick}
      style={{
        padding: "0.6rem 0.9rem", borderRadius: "10px", cursor: "pointer",
        border: `1px solid ${active ? "#02C39A" : "#2A4A6B"}`,
        background: active ? "#0F3D2E" : "transparent",
        color: active ? "#02C39A" : "#8AAEC8",
        fontSize: "0.9rem", fontWeight: active ? "600" : "500",
        minHeight: "44px", display: "flex", alignItems: "center", gap: "6px",
      }}>
      {label}
    </button>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  // Birthday invite form (multi-family) launched from the picker.
  if (bdayLaunch) {
    return (
      <PlaydateRequest
        session={session}
        recipients={bdayLaunch}
        eventType="birthday"
        onBack={() => setBdayLaunch(null)}
        onSent={() => { setBdayLaunch(null); setMessage("Birthday invite sent 🎂"); setTimeout(() => setMessage(""), 3000); }}
      />
    );
  }

  // Birthday family picker (multi-select).
  if (bdayInviteOpen) {
    const selectedCount = Object.keys(bdaySelected).length;
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "90px" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
          <button onClick={() => setBdayInviteOpen(false)} style={{ background: "transparent", border: "none", color: "#7C5CBF", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>🎂 Invite families</h1>
          <div style={{ width: "60px" }} />
        </div>

        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.25rem", lineHeight: "1.5" }}>
            Choose the families you'd like to invite to the birthday. You can pick as many as you like.
          </p>

          {bdayPeopleLoading ? (
            <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading families...</p>
          ) : bdayPeople.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
              <p style={{ fontSize: "2rem", margin: "0 0 0.75rem" }}>👋</p>
              <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.4rem" }}>No families to invite yet</p>
              <p style={{ color: "#607080", fontSize: "0.85rem" }}>Connect with families or join a classroom, then you can invite them.</p>
            </div>
          ) : (
            bdayPeople.map((p) => {
              const on = !!bdaySelected[p.id];
              return (
                <div key={p.id} onClick={() => toggleBdaySelect(p)}
                  style={{ display: "flex", alignItems: "center", gap: "12px", background: on ? "#2A1E3D" : "#162D50", border: on ? "1px solid #7C5CBF" : "1px solid #2A4A6B", borderRadius: "12px", padding: "0.85rem 1rem", marginBottom: "10px", cursor: "pointer" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                    {p.photo_url ? <img src={p.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (p.name?.charAt(0) || "?")}
                  </div>
                  <p style={{ flex: 1, color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: 0 }}>{shortName(p.name)}</p>
                  <div style={{ width: "24px", height: "24px", borderRadius: "6px", border: on ? "none" : "1px solid #2A4A6B", background: on ? "#7C5CBF" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {on && <span style={{ color: "#FFFFFF", fontSize: "0.8rem", fontWeight: "700" }}>✓</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {selectedCount > 0 && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "1rem 1.5rem", background: "#162D50", borderTop: "1px solid #2A4A6B" }}>
            <Button fullWidth onClick={continueToBirthdayForm}
              style={{ maxWidth: "600px", margin: "0 auto", background: "#7C5CBF", color: "#FFFFFF" }}>
              Continue with {selectedCount} {selectedCount === 1 ? "family" : "families"} →
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Profile</h1>
        <button onClick={onOpenSettings} aria-label="Settings"
          style={{ background: "#0F3D2E", border: "1.5px solid #02C39A", cursor: "pointer", fontSize: "1.15rem", width: "40px", height: "40px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
          ⚙️
        </button>
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
                <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setNewName(parent?.name || ""); }} style={{ flex: 1 }}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={saveName} style={{ flex: 2 }}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <p style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: 0 }}>{parent?.name}</p>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}
                style={{ padding: "0.25rem 0.7rem", fontSize: "0.7rem", minHeight: "0" }}>
                Edit
              </Button>
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
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "0.75rem", overflow: "hidden" }}>
          {householdMembers.length === 0 ? (
            <div style={{ padding: "1rem 1.25rem" }}>
              <p style={{ color: "#607080", fontSize: "0.85rem", margin: 0 }}>Just you for now.</p>
            </div>
          ) : (
            householdMembers.map((m, idx) => {
              const isMe = m.parent_id === session.user.id;
              const myRow = householdMembers.find((x) => x.parent_id === session.user.id);
              const iAmPrimary = myRow?.role === "primary";
              const others = householdMembers.length > 1;
              // Show a control when: this row is me AND I'm not alone (Leave),
              // OR this row is a co-parent AND I'm the primary (Remove).
              const canLeave = isMe && others;
              const canRemove = !isMe && iAmPrimary && m.role !== "primary";
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
                  {(canLeave || canRemove) && (
                    <button
                      onClick={() => confirmRemove(m, isMe)}
                      disabled={removeBusy}
                      style={{ marginLeft: "auto", background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", fontSize: "0.75rem", padding: "0.35rem 0.7rem", borderRadius: "8px", cursor: "pointer", flexShrink: 0, minHeight: "36px" }}>
                      {isMe ? "Leave" : "Remove"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Find / link a co-parent into the household */}
        {pendingRequest ? (
          <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #854F0B", marginBottom: "1rem", padding: "1rem 1.25rem" }}>
            <p style={{ color: "#F59E0B", fontSize: "0.85rem", fontWeight: "600", margin: "0 0 4px" }}>Link request pending</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", lineHeight: "1.4" }}>
              You've asked to join another household. It's waiting on their approval.
            </p>
            <Button fullWidth variant="secondary" onClick={cancelRequest}>
              Cancel request
            </Button>
          </div>
        ) : !linkOpen ? (
          <Button fullWidth variant="secondary" onClick={openLink}
            style={{ color: "#02C39A", marginBottom: "1rem" }}>
            ＋ Find a household member
          </Button>
        ) : (
          <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem", padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
              <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: 0 }}>Link a co-parent</p>
              <Button variant="ghost" size="sm" onClick={() => setLinkOpen(false)}>
                Close
              </Button>
            </div>
            <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 0.85rem", lineHeight: "1.4" }}>
              Find another parent in your classrooms to merge into your household. They'll need to approve the request.
            </p>

            <input type="text" placeholder="Search by name..." value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              style={{ width: "100%", padding: "0.7rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "0.85rem" }} />

            {linkLoading ? (
              <p style={{ color: "#607080", fontSize: "0.85rem", textAlign: "center", padding: "1rem" }}>Loading...</p>
            ) : (() => {
              const filtered = linkPeople.filter((p) =>
                (p.name || "").toLowerCase().includes(linkSearch.toLowerCase())
              );
              if (linkPeople.length === 0) {
                return <p style={{ color: "#607080", fontSize: "0.82rem", margin: 0, lineHeight: "1.5" }}>No other parents found in your classrooms yet. Add your classrooms on the Home tab so co-parents can show up here.</p>;
              }
              if (filtered.length === 0) {
                return <p style={{ color: "#607080", fontSize: "0.82rem", margin: 0 }}>No matches. Try a different name.</p>;
              }
              return filtered.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "0.6rem 0", borderBottom: "1px solid #2A4A6B" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0, overflow: "hidden" }}>
                      {p.photo_url ? (
                        <img src={p.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (p.name?.charAt(0) || "?")}
                    </div>
                    <span style={{ color: "#FFFFFF", fontSize: "0.88rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shortName(p.name)}</span>
                  </div>
                  <button onClick={() => askToLink(p)} disabled={linkBusyId === p.id}
                    style={{ flexShrink: 0, padding: "0.45rem 0.85rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.8rem", fontWeight: "600", cursor: "pointer", minHeight: "40px" }}>
                    {linkBusyId === p.id ? "Sending..." : "Ask to link"}
                  </button>
                </div>
              ));
            })()}
          </div>
        )}

        {/* PETS & PLAYDATE PREFERENCES (household-level) */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 0.75rem", letterSpacing: "0.05em" }}>PETS & PLAYDATE PREFERENCES</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem", padding: "1.25rem" }}>

          <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.25rem" }}>Pets in your household</p>
          <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 0.85rem", lineHeight: "1.4" }}>
            Shown on your family's card so others know what to expect.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: prefs.has_other ? "0.75rem" : "1.5rem" }}>
            {togglePill(prefs.has_dog, "🐕 Dog", () => setPrefs((p) => ({ ...p, has_dog: !p.has_dog })))}
           {togglePill(prefs.has_cat, "🐈 Cat", () => setPrefs((p) => ({ ...p, has_cat: !p.has_cat })))}
            {togglePill(prefs.has_horse, "🐴 Horse", () => setPrefs((p) => ({ ...p, has_horse: !p.has_horse })))}
            {togglePill(prefs.has_other, "🐾 Other", () => setPrefs((p) => ({ ...p, has_other: !p.has_other })))}
          </div>
          {prefs.has_other && (
            <input type="text" placeholder="What kind? (e.g. rabbit, bird)" value={prefs.other_label}
              onChange={(e) => setPrefs((p) => ({ ...p, other_label: e.target.value }))}
              style={{ width: "100%", padding: "0.7rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "1.5rem" }} />
          )}

          <div style={{ borderTop: "1px solid #2A4A6B", paddingTop: "1.25rem" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.25rem" }}>Playdate preferences</p>
            <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 0.85rem", lineHeight: "1.4" }}>
              If a host plans to bring a pet, we'll give you a gentle heads-up first.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {togglePill(prefs.prefer_no_dogs, "Rather not be around dogs", () => setPrefs((p) => ({ ...p, prefer_no_dogs: !p.prefer_no_dogs })))}
              {togglePill(prefs.prefer_no_cats, "Rather not be around cats", () => setPrefs((p) => ({ ...p, prefer_no_cats: !p.prefer_no_cats })))}
            </div>
          </div>

          <Button fullWidth variant="primary" onClick={savePrefs} disabled={savingPrefs || !householdId}
            style={{ marginTop: "1.5rem" }}>
            {savingPrefs ? "Saving..." : "Save pets & preferences"}
          </Button>
        </div>

        {/* BIRTHDAYS (household attribute — month/day only, optional label) */}
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "1.5rem 0 0.75rem", letterSpacing: "0.05em" }}>BIRTHDAYS</p>
        <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #2A4A6B", marginBottom: "1rem", padding: "1.25rem" }}>
          <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.25rem" }}>Birthdays in your family 🎂</p>
          <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 1rem", lineHeight: "1.4" }}>
            Add a birthday so families in your classrooms can celebrate together. We only store the month and day — never a name or age.
          </p>

          {birthdays.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              {birthdays.map((b) => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.6rem 0.25rem", borderBottom: "1px solid #223B5A" }}>
                  <span style={{ fontSize: "1.1rem" }}>🎂</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: "#FFFFFF", fontSize: "0.9rem", margin: 0 }}>
                      {MONTHS[b.month - 1]} {b.day}
                      {b.label ? <span style={{ color: "#8AAEC8" }}> · {b.label}</span> : null}
                    </p>
                  </div>
                  <button onClick={() => deleteBirthday(b.id)} disabled={bdayBusy}
                    style={{ background: "transparent", border: "1px solid #2A4A6B", color: "#8AAEC8", fontSize: "0.75rem", padding: "0.35rem 0.7rem", borderRadius: "8px", cursor: "pointer", minHeight: "34px" }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <select value={bdayMonth} onChange={(e) => setBdayMonth(e.target.value)}
              style={{ flex: "1 1 120px", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: bdayMonth ? "#FFFFFF" : "#607080", fontSize: "0.9rem", cursor: "pointer" }}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={bdayDay} onChange={(e) => setBdayDay(e.target.value)}
              style={{ flex: "1 1 90px", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: bdayDay ? "#FFFFFF" : "#607080", fontSize: "0.9rem", cursor: "pointer" }}>
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <input type="text" placeholder="Optional — a nickname to tell birthdays apart (no full name needed)"
            value={bdayLabel} onChange={(e) => setBdayLabel(e.target.value)} maxLength={30}
            style={{ width: "100%", padding: "0.7rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "0.85rem" }} />

          <Button fullWidth variant="primary" onClick={addBirthday} disabled={bdayBusy || !householdId || !bdayMonth || !bdayDay}
            style={{ background: (!bdayMonth || !bdayDay) ? "#1B3A5C" : "#02C39A", color: (!bdayMonth || !bdayDay) ? "#607080" : "#0F2044" }}>
            {bdayBusy ? "Saving..." : "Add birthday"}
          </Button>

          <div style={{ borderTop: "1px solid #2A4A6B", marginTop: "1.25rem", paddingTop: "1.25rem" }}>
            <p style={{ color: "#FFFFFF", fontSize: "0.9rem", fontWeight: "500", margin: "0 0 0.25rem" }}>Throwing a party? 🎉</p>
            <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 0.85rem", lineHeight: "1.4" }}>
              Invite families from your classrooms and connections to a birthday celebration.
            </p>
            <Button fullWidth onClick={openBirthdayInvite} disabled={!householdId}
              style={{ background: "#7C5CBF", color: "#FFFFFF" }}>
              🎂 Invite families to a birthday
            </Button>
          </div>
        </div>

      </div>

      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}