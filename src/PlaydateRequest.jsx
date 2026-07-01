import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ConfirmModal from "./ConfirmModal";

export default function PlaydateRequest({ session, recipient, recipients, onBack, onSent, eventType = "playdate", editEvent = null }) {
  const isEditing = !!editEvent;
  // In edit mode, the event's own type wins; otherwise use the passed eventType.
  const effectiveType = isEditing ? (editEvent.event_type || "playdate") : eventType;
  const isBirthday = effectiveType === "birthday";

  // Normalize to a list: supports single `recipient` (Home/Network) or `recipients` array (multi-select picker).
  const recipientList = (recipients && recipients.length > 0)
    ? recipients
    : (recipient ? [recipient] : []);
  const isMulti = recipientList.length > 1;

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState(null);
  const [sent, setSent] = useState(false);

  // Pets: organizer's own pets, the "bringing" toggles, and recipients' aggregated comfort prefs.
  const [myPets, setMyPets] = useState({ has_dog: false, has_cat: false });
  const [bringingDog, setBringingDog] = useState(false);
  const [bringingCat, setBringingCat] = useState(false);
  // Aggregated across ALL recipients: does ANYONE prefer no dogs / no cats?
  const [anyPreferNoDogs, setAnyPreferNoDogs] = useState(false);
  const [anyPreferNoCats, setAnyPreferNoCats] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const locations = [
    { name: "Local Park", address: "Nearby park" },
    { name: "School Playground", address: "School grounds" },
    { name: "Community Center", address: "Community center" },
    { name: "Our House", address: "My home" },
    { name: "Their House", address: "Their home" },
  ];

  const recipientIdsKey = recipientList.map((r) => r.id).join(",");

  // Pre-fill the form when editing an existing event.
  useEffect(() => {
    if (!editEvent) return;
    if (editEvent.proposed_date) {
      const d = new Date(editEvent.proposed_date);
      // Local yyyy-mm-dd and HH:mm for the inputs.
      const pad = (x) => String(x).padStart(2, "0");
      setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setLocationName(editEvent.location_name || "");
    setLocationAddress(editEvent.location_address || "");
    setNote(editEvent.note || "");
    setTitle(editEvent.title || "");
    setBringingDog(!!editEvent.bringing_dog);
    setBringingCat(!!editEvent.bringing_cat);
  }, [editEvent]);

 useEffect(() => {
    (async () => {
      try {
        const { data: hm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", session.user.id)
          .single();
        if (!hm) return;

        // Organizer's own pets (so we only offer toggles for pets they have).
        const { data: myPrefs } = await supabase
          .from("household_preferences")
          .select("has_dog, has_cat")
          .eq("household_id", hm.household_id)
          .maybeSingle();
        if (myPrefs) setMyPets({ has_dog: !!myPrefs.has_dog, has_cat: !!myPrefs.has_cat });

        // Recipients' comfort preferences, aggregated (does ANYONE prefer no dogs/cats?).
        let dogs = false, cats = false;
        for (const r of recipientList) {
          const { data: theirHm } = await supabase
            .from("household_members")
            .select("household_id")
            .eq("parent_id", r.id)
            .single();
          if (theirHm) {
            const { data: theirPrefs } = await supabase
              .from("household_preferences")
              .select("prefer_no_dogs, prefer_no_cats")
              .eq("household_id", theirHm.household_id)
              .maybeSingle();
            if (theirPrefs?.prefer_no_dogs) dogs = true;
            if (theirPrefs?.prefer_no_cats) cats = true;
          }
        }
        setAnyPreferNoDogs(dogs);
        setAnyPreferNoCats(cats);

        // Get a classroom this household is in, then that classroom's school_id (for the gradient).
        const { data: cm } = await supabase
          .from("classroom_members")
          .select("classroom_id")
          .eq("household_id", hm.household_id)
          .limit(1)
          .maybeSingle();
        if (!cm?.classroom_id) return;

        const { data: cls } = await supabase
          .from("classrooms")
          .select("school_id")
          .eq("id", cm.classroom_id)
          .maybeSingle();
        if (!cls?.school_id) return;

        const { data: school } = await supabase
          .from("schools")
          .select("latitude, longitude")
          .eq("id", cls.school_id)
          .maybeSingle();

        if (school && school.latitude != null && school.longitude != null) {
          setCoords({ latitude: Number(school.latitude), longitude: Number(school.longitude) });
        }
      } catch (e) {
        // No coords -> gradient simply won't show.
      }
    })();
  }, [session, recipientIdsKey]);

  const computeSunTimes = (dateStr, lat, lng) => {
    if (!dateStr || lat == null || lng == null) return null;
    try {
      const d = new Date(`${dateStr}T12:00:00`);
      const rad = Math.PI / 180;
      const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);

      const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + 0.5);
      const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
        - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
        - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
      const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
        - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));

      const latRad = lat * rad;
      const zenith = 90.833 * rad;
      const cosH = (Math.cos(zenith) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
      if (cosH > 1 || cosH < -1) return null;

      const haDeg = Math.acos(cosH) / rad;
      const sunriseUTC = 720 - 4 * (lng + haDeg) - eqTime;
      const sunsetUTC = 720 - 4 * (lng - haDeg) - eqTime;

      const tzOffsetMin = -d.getTimezoneOffset();
      const norm = (m) => ((m + tzOffsetMin) % 1440 + 1440) % 1440;

      return { sunriseMin: norm(sunriseUTC), sunsetMin: norm(sunsetUTC) };
    } catch (e) {
      return null;
    }
  };

  const minutesToLabel = (mins) => {
    let h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  const sunTimes = coords && date ? computeSunTimes(date, coords.latitude, coords.longitude) : null;

  const timeSlots = [];
  for (let h = 7; h <= 21; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const slotMin = h * 60 + m;
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? "AM" : "PM";
      const afterSunset = sunTimes && slotMin >= sunTimes.sunsetMin;
      const beforeSunrise = sunTimes && slotMin < sunTimes.sunriseMin;
      const isDark = afterSunset || beforeSunrise;
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}${isDark ? " 🌙" : ""}`;
      timeSlots.push({ value, label });
    }
  }

  const renderGradient = () => {
    const startMin = 7 * 60;
    const endMin = 21 * 60;
    const span = endMin - startMin;
    const pct = (min) => Math.max(0, Math.min(100, ((min - startMin) / span) * 100));

    if (!sunTimes) {
      return "linear-gradient(90deg, #1B3A5C 0%, #244C70 50%, #1B3A5C 100%)";
    }

    const sr = pct(sunTimes.sunriseMin);
    const ss = pct(sunTimes.sunsetMin);
    return `linear-gradient(90deg,
      #0B1B33 0%,
      #0B1B33 ${Math.max(0, sr - 8)}%,
      #C97B3C ${sr}%,
      #4AA3D8 ${Math.min(sr + 10, 100)}%,
      #4AA3D8 ${Math.max(ss - 10, 0)}%,
      #C97B3C ${ss}%,
      #0B1B33 ${Math.min(100, ss + 8)}%,
      #0B1B33 100%)`;
  };

  const selectedPct = (() => {
    if (!time) return null;
    const [hh, mm] = time.split(":").map(Number);
    const min = hh * 60 + mm;
    const startMin = 7 * 60, endMin = 21 * 60;
    return Math.max(0, Math.min(100, ((min - startMin) / (endMin - startMin)) * 100));
  })();

  const shortName = (fullName) => {
    if (!fullName) return "this family";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  // The actual send (runs directly, or after the user OKs the pet heads-up).
  // Creates ONE event (playdate or birthday), then ONE invite row per recipient (+ notification each).
  const sendRequest = async () => {
    setLoading(true);
    setError("");

    let createdPlaydateId = null;
    try {
      const { data: myHm, error: myErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .single();
      if (myErr) throw myErr;

      // Resolve each recipient -> their household, skipping anyone in my own household.
      const targets = [];
      for (const r of recipientList) {
        const { data: theirHm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", r.id)
          .single();
        if (theirHm && theirHm.household_id !== myHm.household_id) {
          targets.push({ parentId: r.id, householdId: theirHm.household_id });
        }
      }

      if (targets.length === 0) {
        setError("No valid families to invite.");
        setLoading(false);
        return;
      }

      const proposedDate = new Date(`${date}T${time}`).toISOString();

      const { data: playdate, error: pdErr } = await supabase
        .from("playdates")
        .insert({
          organizer_household_id: myHm.household_id,
          organizer_parent_id: session.user.id,
          proposed_date: proposedDate,
          location_name: locationName,
          location_address: locationAddress,
          note: note || null,
          status: "pending",
          bringing_dog: bringingDog,
          bringing_cat: bringingCat,
          event_type: effectiveType,
          title: isBirthday ? (title.trim() || null) : null,
        })
        .select()
        .single();
      if (pdErr) throw pdErr;
      createdPlaydateId = playdate.id;

   // One invite row per recipient, PLUS the host's own row (rsvp='yes')
      // so "who's going" is one clean count and the host counts toward confirmation.
      const inviteRows = targets.map((t) => ({
        playdate_id: playdate.id,
        household_id: t.householdId,
        invited_by_household_id: myHm.household_id,
        invited_parent_id: t.parentId,
        rsvp: "invited",
      }));
      inviteRows.push({
        playdate_id: playdate.id,
        household_id: myHm.household_id,
        invited_by_household_id: myHm.household_id,
        invited_parent_id: session.user.id,
        rsvp: "yes",
      });
      const { error: invErr } = await supabase.from("playdate_invites").insert(inviteRows);
      if (invErr) throw invErr;

      // Best-effort: notify every invited household.
      try {
        const { data: myMembers } = await supabase
          .from("household_members")
          .select("parents(name)")
          .eq("household_id", myHm.household_id);
        const inviterNames = (myMembers || [])
          .map((m) => {
            const n = m.parents?.name;
            if (!n) return null;
            const parts = n.trim().split(/\s+/);
            return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
          })
          .filter(Boolean);
        const inviterLabel = inviterNames.length > 0 ? inviterNames.join(" & ") : "A family";

        const targetHouseholdIds = targets.map((t) => t.householdId);
        const { data: theirMembers } = await supabase
          .from("household_members")
          .select("parent_id")
          .in("household_id", targetHouseholdIds);

        const rows = (theirMembers || []).map((m) => ({
          recipient_id: m.parent_id,
          type: isBirthday ? "birthday_invite" : "playdate_invite",
          title: isBirthday ? "You're invited to a birthday! 🎂" : "New playdate invite 🎉",
          body: isBirthday
            ? `${inviterLabel} invited you to a birthday celebration. Open the Playdates tab to RSVP.`
            : `${inviterLabel} invited you to a playdate. Open the Playdates tab to RSVP.`,
        }));
        if (rows.length > 0) {
          await supabase.from("notifications").insert(rows);
        }
      } catch (notifErr) {
        // Best-effort — don't block the invite.
      }

      setSent(true);
      setTimeout(() => { onSent(); }, 1800);

    } catch (err) {
      if (createdPlaydateId) {
        await supabase.from("playdates").delete().eq("id", createdPlaydateId);
      }
      setError(err.message);
      setLoading(false);
    }
  };

  // Button handler: validate, run the aggregated pet cross-check, then send.
  // Save edits to an existing event: update details, diff the guest list
  // (add new families, remove dropped ones), and notify appropriately.
  const saveEdits = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: myHm, error: myErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .single();
      if (myErr) throw myErr;

      const proposedDate = new Date(`${date}T${time}`).toISOString();

      // Did the "when/where" meaningfully change? (drives whether we re-notify guests)
      const detailsChanged =
        proposedDate !== new Date(editEvent.proposed_date).toISOString() ||
        (locationName || "") !== (editEvent.location_name || "") ||
        (locationAddress || "") !== (editEvent.location_address || "");

      // 1) Update the event row.
      const { error: updErr } = await supabase
        .from("playdates")
        .update({
          proposed_date: proposedDate,
          location_name: locationName,
          location_address: locationAddress,
          note: note || null,
          title: isBirthday ? (title.trim() || null) : null,
          bringing_dog: bringingDog,
          bringing_cat: bringingCat,
        })
        .eq("id", editEvent.id);
      if (updErr) throw updErr;

      // 2) Resolve the NEW recipient list -> their households.
      const newTargets = [];
      for (const r of recipientList) {
        const { data: theirHm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", r.id)
          .single();
        if (theirHm && theirHm.household_id !== myHm.household_id) {
          newTargets.push({ parentId: r.id, householdId: theirHm.household_id });
        }
      }
      const newHouseholdIds = new Set(newTargets.map((t) => t.householdId));

      // 3) Current invite rows (excluding the host's own row).
      const { data: existingInvites } = await supabase
        .from("playdate_invites")
        .select("id, household_id")
        .eq("playdate_id", editEvent.id)
        .neq("household_id", myHm.household_id);
      const existingHouseholdIds = new Set((existingInvites || []).map((i) => i.household_id));

      // 4) ADD: households in new list but not currently invited.
      const toAdd = newTargets.filter((t) => !existingHouseholdIds.has(t.householdId));
      if (toAdd.length > 0) {
        const rows = toAdd.map((t) => ({
          playdate_id: editEvent.id,
          household_id: t.householdId,
          invited_by_household_id: myHm.household_id,
          invited_parent_id: t.parentId,
          rsvp: "invited",
        }));
        await supabase.from("playdate_invites").insert(rows);
      }

      // 5) REMOVE: currently invited but not in the new list.
      const removeRows = (existingInvites || []).filter((i) => !newHouseholdIds.has(i.household_id));
      if (removeRows.length > 0) {
        await supabase.from("playdate_invites")
          .delete()
          .in("id", removeRows.map((r) => r.id));
      }

      // ---- Notifications (best-effort) ----
      try {
        // Inviter label.
        const { data: myMembers } = await supabase
          .from("household_members").select("parents(name)").eq("household_id", myHm.household_id);
        const inviterLabel = (myMembers || [])
          .map((m) => m.parents?.name).filter(Boolean)
          .map((n) => { const p = n.trim().split(/\s+/); return p.length === 1 ? p[0] : `${p[0]} ${p[p.length-1].charAt(0)}.`; })
          .join(" & ") || "A family";
        const kind = isBirthday ? "birthday" : "playdate";

        // Newly added families: standard invite notification.
        if (toAdd.length > 0) {
          const { data: addMembers } = await supabase
            .from("household_members").select("parent_id").in("household_id", toAdd.map((t) => t.householdId));
          const rows = (addMembers || []).map((m) => ({
            recipient_id: m.parent_id,
            type: isBirthday ? "birthday_invite" : "playdate_invite",
            title: isBirthday ? "You're invited to a birthday! 🎂" : "New playdate invite 🎉",
            body: `${inviterLabel} invited you to a ${kind}. Open the Playdates tab to RSVP.`,
          }));
          if (rows.length > 0) await supabase.from("notifications").insert(rows);
        }

        // Removed families: gentle heads-up.
        if (removeRows.length > 0) {
          const { data: remMembers } = await supabase
            .from("household_members").select("parent_id").in("household_id", removeRows.map((r) => r.household_id));
          const rows = (remMembers || []).map((m) => ({
            recipient_id: m.parent_id,
            type: "event_removed",
            title: "Plans changed",
            body: `${inviterLabel}'s ${kind} plans changed and it's no longer on your calendar.`,
          }));
          if (rows.length > 0) await supabase.from("notifications").insert(rows);
        }

        // Kept families: only notify if when/where changed.
        if (detailsChanged) {
          const keptIds = newTargets.filter((t) => existingHouseholdIds.has(t.householdId)).map((t) => t.householdId);
          if (keptIds.length > 0) {
            const { data: keptMembers } = await supabase
              .from("household_members").select("parent_id").in("household_id", keptIds);
            const rows = (keptMembers || []).map((m) => ({
              recipient_id: m.parent_id,
              type: "event_updated",
              title: isBirthday ? "Birthday details updated 🎂" : "Playdate details updated",
              body: `${inviterLabel} updated the ${kind} details. Open the Playdates tab to see what changed.`,
            }));
            if (rows.length > 0) await supabase.from("notifications").insert(rows);
          }
        }
      } catch (notifErr) { /* best-effort */ }

      setSent(true);
      setTimeout(() => { onSent(); }, 1400);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const attemptSend = () => {
    if (!date || !time || !locationName) {
      setError("Please fill in date, time and location");
      return;
    }
    setError("");

    // Edit mode: require at least one family, then save.
    if (isEditing) {
      if (recipientList.length === 0) {
        setError("A birthday needs at least one family invited.");
        return;
      }
      saveEdits();
      return;
    }

    const dogConflict = bringingDog && anyPreferNoDogs;
    const catConflict = bringingCat && anyPreferNoCats;

    if (dogConflict || catConflict) {
      const animals = [];
      if (dogConflict) animals.push("dogs");
      if (catConflict) animals.push("cats");
      const animalLabel = animals.join(" and ");
      // Generic wording — protects which specific family set the preference.
      const who = isMulti ? "Some families you invited" : "This family";
      setConfirm({
        title: "A quick heads-up",
        body: `${who} would rather not be around ${animalLabel}. You can still send — just wanted you to know.`,
        confirmLabel: "Send anyway",
        cancelLabel: "Go back",
        tone: "primary",
        onConfirm: () => { setConfirm(null); sendRequest(); },
      });
      return;
    }

    sendRequest();
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  const isPresetSelected = locations.some((l) => l.name === locationName);

  const petToggle = (active, label, onClick) => (
    <button
      onClick={onClick}
      style={{
        padding: "0.6rem 1rem", borderRadius: "8px", border: "1px solid",
        borderColor: active ? "#02C39A" : "#2A4A6B",
        background: active ? "#0F3D2E" : "transparent",
        color: active ? "#02C39A" : "#8AAEC8",
        fontSize: "0.9rem", cursor: "pointer", minHeight: "44px"
      }}
    >
      {label}
    </button>
  );

  // Theme accent: birthday = purple, playdate = teal.
  const accent = isBirthday ? "#7C5CBF" : "#02C39A";
  const accentBg = isBirthday ? "#2A1E3D" : "#0F3D2E";

  // Label for the recipient card / success screen.
  const recipientHeading = isMulti
    ? `${recipientList.length} families`
    : `${shortName(recipientList[0]?.name)}'s family`;

  if (sent) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center", maxWidth: "340px" }}>
          <div style={{ fontSize: "3.5rem", margin: "0 0 1rem" }}>{isBirthday ? "🎂" : "🎉"}</div>
          <h2 style={{ color: accent, fontSize: "1.5rem", fontWeight: "700", margin: "0 0 0.5rem" }}>{isEditing ? "Changes saved!" : "Invite sent!"}</h2>
          <p style={{ color: "#8AAEC8", fontSize: "0.95rem", margin: "0 0 1.75rem", lineHeight: "1.5" }}>
            {isMulti
              ? `${recipientList.length} families will get your ${isBirthday ? "birthday" : "playdate"} invite. You'll be notified when they reply.`
              : `${shortName(recipientList[0]?.name)}'s family will get your ${isBirthday ? "birthday" : "playdate"} invite. You'll be notified when they reply.`}
          </p>
          <button onClick={() => onSent()}
            style={{ padding: "0.75rem 1.5rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer" }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const showBringPets = myPets.has_dog || myPets.has_cat;
  const firstRecipient = recipientList[0];

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: accent, fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>{isEditing ? (isBirthday ? "🎂 Edit birthday" : "Edit playdate") : (isBirthday ? "🎂 Birthday Invite" : "Request a Playdate")}</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", gap: "12px" }}>
          {isMulti ? (
            <div style={{ display: "flex", marginRight: "4px" }}>
              {recipientList.slice(0, 3).map((r, i) => (
                <div key={r.id} style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", border: "2px solid #162D50", marginLeft: i > 0 ? "-12px" : 0 }}>
                  {r.photo_url ? <img src={r.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (r.name?.charAt(0) || "?")}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
              {firstRecipient?.photo_url ? (
                <img src={firstRecipient.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (firstRecipient?.name?.charAt(0) || "?")}
            </div>
          )}
          <div>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>{recipientHeading}</p>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>{isMulti ? `Sending one ${isBirthday ? "birthday" : "playdate"} invite to everyone` : `Sending a ${isBirthday ? "birthday" : "playdate"} invite`}</p>
          </div>
        </div>

        {isBirthday && (
          <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>PARTY TITLE (optional)</p>
            <input
              type="text"
              placeholder="e.g. Birthday party at the park!"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              style={{ ...inputStyle, marginBottom: 0 }}
            />
            <p style={{ color: "#607080", fontSize: "0.72rem", margin: "0.5rem 0 0", lineHeight: "1.4" }}>
              Add a friendly title for your celebration. Totally optional.
            </p>
          </div>
        )}

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>DATE & TIME</p>
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            style={inputStyle}
          />

          {date && (
            <div style={{ marginBottom: "0.85rem" }}>
              <div style={{
                position: "relative", height: "14px", borderRadius: "7px",
                background: renderGradient(), border: "1px solid #2A4A6B", overflow: "hidden"
              }}>
                {selectedPct != null && (
                  <div style={{
                    position: "absolute", top: "-3px", left: `calc(${selectedPct}% - 3px)`,
                    width: "6px", height: "20px", borderRadius: "3px",
                    background: "#FFFFFF", boxShadow: "0 0 4px rgba(0,0,0,0.5)"
                  }} />
                )}
              </div>
              {sunTimes ? (
                <p style={{ color: "#8AAEC8", fontSize: "0.72rem", margin: "0.4rem 0 0", textAlign: "center" }}>
                  🌅 Sunrise {minutesToLabel(sunTimes.sunriseMin)} · 🌇 Sunset {minutesToLabel(sunTimes.sunsetMin)}
                </p>
              ) : (
                <p style={{ color: "#607080", fontSize: "0.72rem", margin: "0.4rem 0 0", textAlign: "center" }}>
                  Morning to evening
                </p>
              )}
            </div>
          )}

          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Time</label>
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ ...inputStyle, appearance: "auto", cursor: "pointer" }}
          >
            <option value="" disabled>Select a time</option>
            {timeSlots.map((slot) => (
              <option key={slot.value} value={slot.value}>{slot.label}</option>
            ))}
          </select>
        </div>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>LOCATION</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1rem" }}>
            {locations.map((loc) => {
              const selected = locationName === loc.name;
              return (
                <button
                  key={loc.name}
                  onClick={() => { setLocationName(loc.name); setLocationAddress(loc.address); }}
                  style={{
                    padding: "0.6rem", borderRadius: "8px", border: "1px solid",
                    borderColor: selected ? accent : "#2A4A6B",
                    background: selected ? accentBg : "transparent",
                    color: selected ? accent : "#8AAEC8",
                    fontSize: "0.8rem", cursor: "pointer", textAlign: "left"
                  }}
                >
                  {loc.name}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "0.25rem 0 0.85rem" }}>
            <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
            <span style={{ color: "#607080", fontSize: "0.75rem" }}>or enter a specific place</span>
            <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
          </div>

          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Place or address</label>
          <input
            type="text"
            placeholder="e.g. Howarth Park, Santa Rosa"
            value={isPresetSelected ? "" : locationName}
            onChange={(e) => { setLocationName(e.target.value); setLocationAddress(""); }}
            style={inputStyle}
          />
          <p style={{ color: "#607080", fontSize: "0.72rem", margin: "-0.5rem 0 0", lineHeight: "1.4" }}>
            Tip: include the city so the other families can find it easily.
          </p>
        </div>

        {showBringPets && (
          <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 0.4rem", letterSpacing: "0.05em" }}>BRINGING A PET?</p>
            <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0 0 1rem", lineHeight: "1.4" }}>
              Let the other families know if a furry friend is coming along.
            </p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {myPets.has_dog && petToggle(bringingDog, "🐕 Bringing our dog", () => setBringingDog((v) => !v))}
              {myPets.has_cat && petToggle(bringingCat, "🐈 Bringing our cat", () => setBringingCat((v) => !v))}
            </div>
          </div>
        )}

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>ADD A NOTE (optional)</p>
          <textarea
            placeholder={isBirthday ? "e.g. Cake and games — hope you can make it!" : "e.g. Our kids seem to get along great!"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none", marginBottom: 0 }}
          />
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

        <button
          onClick={attemptSend}
          disabled={loading}
          style={{
            width: "100%", padding: "0.85rem", borderRadius: "10px",
            border: "none", background: loading ? "#028090" : accent,
            color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? (isEditing ? "Saving..." : "Sending...") : isEditing
            ? "Save changes"
            : isBirthday
              ? (isMulti ? `Send birthday invite to ${recipientList.length} families →` : "Send birthday invite →")
              : (isMulti ? `Send to ${recipientList.length} families →` : "Send playdate invite →")}
        </button>

      </div>

      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}