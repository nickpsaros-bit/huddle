import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function PlaydateRequest({ session, recipient, onBack, onSent }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState(null); // organizer's school { latitude, longitude }

  const locations = [
    { name: "Local Park", address: "Nearby park" },
    { name: "School Playground", address: "School grounds" },
    { name: "Community Center", address: "Community center" },
    { name: "Our House", address: "My home" },
    { name: "Their House", address: "Their home" },
    { name: "Custom location", address: "" },
  ];

  // Fetch the organizer's school coordinates (for the sunrise/sunset gradient).
  // Gracefully no-ops if the school has no coordinates yet.
  useEffect(() => {
    (async () => {
      try {
        const { data: hm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", session.user.id)
          .single();
        if (!hm) return;

        const { data: cm } = await supabase
          .from("classroom_members")
          .select("classrooms(schools(latitude, longitude))")
          .eq("household_id", hm.household_id)
          .limit(1);

        const school = cm?.[0]?.classrooms?.schools;
        if (school && school.latitude != null && school.longitude != null) {
          setCoords({ latitude: school.latitude, longitude: school.longitude });
        }
      } catch (e) {
        // No coords -> gradient simply won't show.
      }
    })();
  }, [session]);

  // Inline sunrise/sunset calculation (NOAA approximation) — no dependency.
  // Returns { sunriseMin, sunsetMin } as minutes-from-midnight in local time, or null.
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

  // 30-minute time slots, 7:00 AM to 9:00 PM. If we know sunset for the day,
  // slots after sunset get a 🌙; otherwise no marker.
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

  // Build a day/night gradient for the 7 AM–9 PM window (840 minutes span).
  // Maps sunrise/sunset onto the strip so it reflects the real local day.
  const renderGradient = () => {
    const startMin = 7 * 60;   // 7:00 AM
    const endMin = 21 * 60;    // 9:00 PM
    const span = endMin - startMin;
    const pct = (min) => Math.max(0, Math.min(100, ((min - startMin) / span) * 100));

    // Default (no sun data): a gentle neutral daytime gradient.
    if (!sunTimes) {
      return "linear-gradient(90deg, #1B3A5C 0%, #244C70 50%, #1B3A5C 100%)";
    }

    const sr = pct(sunTimes.sunriseMin);
    const ss = pct(sunTimes.sunsetMin);
    // night (deep blue) -> dawn (amber) -> day (sky) -> dusk (amber) -> night
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

  // Position (%) of the currently selected time on the gradient strip.
  const selectedPct = (() => {
    if (!time) return null;
    const [hh, mm] = time.split(":").map(Number);
    const min = hh * 60 + mm;
    const startMin = 7 * 60, endMin = 21 * 60;
    return Math.max(0, Math.min(100, ((min - startMin) / (endMin - startMin)) * 100));
  })();

  const sendRequest = async () => {
    if (!date || !time || !locationName) {
      setError("Please fill in date, time and location");
      return;
    }
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

      const { data: theirHm, error: theirErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", recipient.id)
        .single();
      if (theirErr) throw theirErr;

      if (theirHm.household_id === myHm.household_id) {
        setError("That parent is in your own household.");
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
        })
        .select()
        .single();
      if (pdErr) throw pdErr;
      createdPlaydateId = playdate.id;

      const { error: invErr } = await supabase
        .from("playdate_invites")
        .insert({
          playdate_id: playdate.id,
          household_id: theirHm.household_id,
          invited_by_household_id: myHm.household_id,
          rsvp: "invited",
        });
      if (invErr) throw invErr;

      // Notify every parent in the invited household (non-blocking).
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

        const { data: theirMembers } = await supabase
          .from("household_members")
          .select("parent_id")
          .eq("household_id", theirHm.household_id);

        const rows = (theirMembers || []).map((m) => ({
          recipient_id: m.parent_id,
          type: "playdate_invite",
          title: "New playdate invite 🎉",
          body: `${inviterLabel} invited you to a playdate. Open the Playdates tab to RSVP.`,
        }));
        if (rows.length > 0) {
          await supabase.from("notifications").insert(rows);
        }
      } catch (notifErr) {
        // Best-effort — don't block the invite.
      }

      onSent();

    } catch (err) {
      if (createdPlaydateId) {
        await supabase.from("playdates").delete().eq("id", createdPlaydateId);
      }
      setError(err.message);
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  const shortName = (fullName) => {
    if (!fullName) return "this family";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Request a Playdate</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>

        {/* Recipient card */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
            {recipient.photo_url ? (
              <img src={recipient.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              recipient.name?.charAt(0) || "?"
            )}
          </div>
          <div>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(recipient.name)}'s family</p>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Sending a playdate invite</p>
          </div>
        </div>

        {/* Date & Time */}
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

          {/* Day/night gradient strip — only meaningful once a date is picked */}
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

        {/* Location */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>LOCATION</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1rem" }}>
            {locations.map((loc) => (
              <button
                key={loc.name}
                onClick={() => { setLocationName(loc.name); setLocationAddress(loc.address); }}
                style={{
                  padding: "0.6rem", borderRadius: "8px", border: "1px solid",
                  borderColor: locationName === loc.name ? "#02C39A" : "#2A4A6B",
                  background: locationName === loc.name ? "#0F3D2E" : "transparent",
                  color: locationName === loc.name ? "#02C39A" : "#8AAEC8",
                  fontSize: "0.8rem", cursor: "pointer", textAlign: "left"
                }}
              >
                {loc.name}
              </button>
            ))}
          </div>
          {locationName === "Custom location" && (
            <>
              <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Location name</label>
              <input type="text" placeholder="e.g. Howarth Park" onChange={(e) => setLocationName(e.target.value)} style={inputStyle} />
              <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Address</label>
              <input type="text" placeholder="Full address" onChange={(e) => setLocationAddress(e.target.value)} style={inputStyle} />
            </>
          )}
        </div>

        {/* Note */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>ADD A NOTE (optional)</p>
          <textarea
            placeholder="e.g. Our kids seem to get along great!"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none", marginBottom: 0 }}
          />
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

        <button
          onClick={sendRequest}
          disabled={loading}
          style={{
            width: "100%", padding: "0.85rem", borderRadius: "10px",
            border: "none", background: loading ? "#028090" : "#02C39A",
            color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Sending..." : "Send playdate invite →"}
        </button>

      </div>
    </div>
  );
}