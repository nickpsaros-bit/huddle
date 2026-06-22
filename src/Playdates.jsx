import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import ConfirmModal from "./ConfirmModal";
import PlaydateRequest from "./PlaydateRequest";

export default function Playdates({ session, onChanged }) {
  const [householdId, setHouseholdId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  // Create-flow state
  const [picking, setPicking] = useState(false);
  const [pickPeople, setPickPeople] = useState([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A family";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const householdLabel = async (hhId) => {
    const { data } = await supabase
      .from("household_members")
      .select("parents(name)")
      .eq("household_id", hhId);
    const names = (data || []).map((m) => m.parents?.name).filter(Boolean);
    if (names.length === 0) return "A family";
    return names.map(shortName).join(" & ");
  };
 
  

  const householdInitial = async (hhId) => {
    const { data } = await supabase
      .from("household_members")
      .select("parents(name)")
      .eq("household_id", hhId)
      .limit(1);
    const nm = data?.[0]?.parents?.name;
    return nm ? nm.charAt(0).toUpperCase() : "?";
  };

  // Recompute a playdate's status from its invites and persist it.
  // Rule: Confirmed = >=2 firm "yes". Pending = >=1 yes and >=2 parties still
  // in play (could still reach 2 yes). Cancelled = can't reach 2.
  const recomputePlaydateStatus = async (playdateId) => {
    const { data: invites } = await supabase
      .from("playdate_invites")
      .select("rsvp")
      .eq("playdate_id", playdateId);

    const rows = invites || [];
    const yesCount = rows.filter((r) => r.rsvp === "yes").length;
    const aliveCount = rows.filter((r) => ["yes", "maybe", "invited"].includes(r.rsvp)).length;

    let status;
    if (yesCount >= 2) status = "confirmed";
    else if (yesCount >= 1 && aliveCount >= 2) status = "pending";
    else status = "cancelled";

    await supabase.from("playdates").update({ status }).eq("id", playdateId);
    return status;
  };



  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  // Pet line for a playdate (🐕/🐈). guest=true => "The host plans to bring...";
  // guest=false (hosting view) => "You're bringing...". Returns null if no pet flagged.
  const petLine = (pd, guest) => {
    const animals = [];
    if (pd.bringing_dog) animals.push("dog");
    if (pd.bringing_cat) animals.push("cat");
    if (animals.length === 0) return null;
    const icons = `${pd.bringing_dog ? "🐕" : ""}${pd.bringing_cat ? "🐈" : ""}`;
    const list = animals.length === 2 ? "dog and cat" : animals[0];
    const text = guest ? `The host plans to bring their ${list}` : `You're bringing your ${list}`;
    return (
      <div style={{ background: "#1A3A5C", borderRadius: "8px", padding: "0.5rem 0.75rem", margin: "0.6rem 0 0", display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "0.95rem" }}>{icons}</span>
        <span style={{ color: "#FFFFFF", fontSize: "0.82rem" }}>{text}</span>
      </div>
    );
  };

  const addToCalendar = (pd) => {
    const start = new Date(pd.proposed_date);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const toIcs = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const esc = (s) => (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const loc = [pd.location_name, pd.location_address].filter(Boolean).join(", ");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Huddle//Playdate//EN",
      "BEGIN:VEVENT",
      `UID:huddle-${pd.id}@huddlefamilies.com`,
      `DTSTAMP:${toIcs(new Date())}`,
      `DTSTART:${toIcs(start)}`,
      `DTEND:${toIcs(end)}`,
      "SUMMARY:Playdate",
      loc ? `LOCATION:${esc(loc)}` : "",
      pd.note ? `DESCRIPTION:${esc(pd.note)}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);

    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "playdate.ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fetchData = async () => {
    setLoading(true);

    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .maybeSingle();

    if (!hm) { setLoading(false); return; }
    const hhId = hm.household_id;
    setHouseholdId(hhId);

    const all = [];

    const { data: hosting } = await supabase
      .from("playdates")
      .select("*")
      .eq("organizer_household_id", hhId);

    for (const pd of (hosting || [])) {
      const { data: invites } = await supabase
        .from("playdate_invites")
        .select("*")
        .eq("playdate_id", pd.id);
      const roster = [];
      for (const inv of (invites || [])) {
        roster.push({
          ...inv,
          label: await householdLabel(inv.household_id),
          initial: await householdInitial(inv.household_id),
        });
      }
      all.push({
        kind: "hosting",
        playdate: pd,
        roster,
        goingCount: roster.filter((r) => r.rsvp === "yes").length,
      });
    }

    const { data: myInvites } = await supabase
      .from("playdate_invites")
      .select("*, playdates(*)")
      .eq("household_id", hhId);

    for (const inv of (myInvites || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.organizer_household_id === hhId) continue;
      // Person-facing: who organized it (falls back to household label if no parent).
      let organizerLabel = await householdLabel(pd.organizer_household_id);
      if (pd.organizer_parent_id) {
        const { data: orgParent } = await supabase
          .from("parents")
          .select("name")
          .eq("id", pd.organizer_parent_id)
          .maybeSingle();
        if (orgParent?.name) organizerLabel = shortName(orgParent.name);
      }
      all.push({ kind: "invited", playdate: pd, invite: inv, organizerLabel });
    }

    setItems(all);
    setLoading(false);
  };

  // Load people you can huddle with: classmates (your classrooms) + connections.
  // Deduped by parent id, excluding yourself and your own household.
  const openPicker = async () => {
    setPicking(true);
    setPickSearch("");
    setPickLoading(true);
    try {
      const userId = session.user.id;

      // My household (to exclude my own household members).
      const { data: myHm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", userId)
        .maybeSingle();
      const myHouseholdId = myHm?.household_id;

      const peopleMap = {}; // parent_id -> { id, name, photo_url, source }

      // --- Classmates: other households in my classrooms ---
      if (myHouseholdId) {
        const { data: myMemberships } = await supabase
          .from("classroom_members")
          .select("classroom_id, school_year")
          .eq("household_id", myHouseholdId);

        for (const m of (myMemberships || [])) {
          const { data: others } = await supabase
            .from("classroom_members")
            .select("households(household_members(parent_id, parents(id, name, photo_url)))")
            .eq("classroom_id", m.classroom_id)
            .eq("school_year", m.school_year)
            .neq("household_id", myHouseholdId);

          for (const row of (others || [])) {
            const members = row.households?.household_members || [];
            for (const hm2 of members) {
              const p = hm2.parents;
              if (p && p.id && p.id !== userId && !peopleMap[p.id]) {
                peopleMap[p.id] = { id: p.id, name: p.name, photo_url: p.photo_url, source: "Classmate" };
              }
            }
          }
        }
      }

      // --- Connections (accepted) ---
      const { data: conns } = await supabase
        .from("connections")
        .select(`
          requester:parents!connections_requester_id_fkey(id, name, photo_url),
          recipient:parents!connections_recipient_id_fkey(id, name, photo_url),
          requester_id, recipient_id
        `)
        .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
        .eq("status", "accepted");

      for (const c of (conns || [])) {
        const other = c.requester_id === userId ? c.recipient : c.requester;
        if (other && other.id && other.id !== userId) {
          if (!peopleMap[other.id]) {
            peopleMap[other.id] = { id: other.id, name: other.name, photo_url: other.photo_url, source: "Connection" };
          }
        }
      }

      const list = Object.values(peopleMap).sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      setPickPeople(list);
    } catch (e) {
      setPickPeople([]);
    }
    setPickLoading(false);
  };

  const respond = async (inviteId, rsvp) => {
    setBusy(true);
    try {
  await supabase
        .from("playdate_invites")
        .update({ rsvp, responded_at: new Date().toISOString(), responded_parent_id: session.user.id })
        .eq("id", inviteId);

      // Recompute this playdate's status (confirmed/pending/cancelled) after the RSVP change.
      try {
        const { data: invRow } = await supabase
          .from("playdate_invites")
          .select("playdate_id")
          .eq("id", inviteId)
          .single();
        if (invRow?.playdate_id) {
          await recomputePlaydateStatus(invRow.playdate_id);
        }
      } catch (statusErr) {
        // Best-effort — don't block the RSVP if recompute fails.
      }

      try {
        const { data: inv } = await supabase
          .from("playdate_invites")
          .select("playdate_id, household_id, playdates(organizer_household_id)")
          .eq("id", inviteId)
          .single();

        const organizerHouseholdId = inv?.playdates?.organizer_household_id;
        const respondingHouseholdId = inv?.household_id;
        const playdateId = inv?.playdate_id;

        if (organizerHouseholdId && respondingHouseholdId && organizerHouseholdId !== respondingHouseholdId) {
          const { data: respMembers } = await supabase
            .from("household_members")
            .select("parents(name)")
            .eq("household_id", respondingHouseholdId);
          const respNames = (respMembers || [])
            .map((m) => {
              const n = m.parents?.name;
              if (!n) return null;
              const parts = n.trim().split(/\s+/);
              return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
            })
            .filter(Boolean);
          const respLabel = respNames.length > 0 ? respNames.join(" & ") : "A family";

          const verb = rsvp === "yes" ? "is going to" : rsvp === "maybe" ? "might come to" : "can't make";
          const emoji = rsvp === "yes" ? "✅" : rsvp === "maybe" ? "🤔" : "😔";

          const { data: hostMembers } = await supabase
            .from("household_members")
            .select("parent_id")
            .eq("household_id", organizerHouseholdId);

          const rows = (hostMembers || []).map((m) => ({
            recipient_id: m.parent_id,
            type: "playdate_rsvp",
            title: `Playdate RSVP ${emoji}`,
            body: `${respLabel} ${verb} your playdate.`,
          }));
          if (rows.length > 0) {
            await supabase.from("notifications").insert(rows);
          }

        if (rsvp === "yes" && playdateId) {
            try {
              await supabase.functions.invoke("send-playdate-invite", {
                body: {
                  playdate_id: playdateId,
                  responding_household_id: respondingHouseholdId,
                },
              });
            } catch (emailErr) {
              // Best-effort — the in-app RSVP still succeeds.
            }
          }

          // Guest declined → email the HOST (they shouldn't have to check the app).
          if (rsvp === "no" && playdateId) {
            try {
              await supabase.functions.invoke("notify-host-decline", {
                body: {
                  playdate_id: playdateId,
                  declining_household_id: respondingHouseholdId,
                },
              });
            } catch (emailErr) {
              // Best-effort — the in-app decline still succeeds.
            }
          }
          // Guest declined → email the HOST (they shouldn't have to check the app).
          if (rsvp === "no" && playdateId) {
            try {
              await supabase.functions.invoke("notify-host-decline", {
                body: {
                  playdate_id: playdateId,
                  declining_household_id: respondingHouseholdId,
                },
              });
            } catch (emailErr) {
              // Best-effort — the in-app decline still succeeds.
            }
          }
        }
      } catch (notifErr) {
        // Best-effort — don't block the RSVP.
      }

      setMessage(rsvp === "yes" ? "You're going!" : rsvp === "maybe" ? "Marked as maybe" : "Can't make it");
      await fetchData();
      if (typeof onChanged === "function") onChanged();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBusy(false);
  };

  // The actual cancellation work (called after the user confirms in the modal).
  const doCancelPlaydate = async (pd) => {
    setBusy(true);
    try {
      try {
        await supabase.functions.invoke("cancel-playdate-invite", {
          body: { playdate_id: pd.id },
        });
      } catch (calErr) {
        // Best-effort — don't block the cancellation if the email fails.
      }

      const { data: invites } = await supabase
        .from("playdate_invites")
        .select("household_id")
        .eq("playdate_id", pd.id);

      try {
        const hostLabel = await householdLabel(pd.organizer_household_id);
        const whenStr = fmtDate(pd.proposed_date);
        const invitedHouseholdIds = [...new Set((invites || []).map((i) => i.household_id))]
          .filter((id) => id && id !== pd.organizer_household_id);

        if (invitedHouseholdIds.length > 0) {
          const { data: guestParents } = await supabase
            .from("household_members")
            .select("parent_id")
            .in("household_id", invitedHouseholdIds);

          const rows = (guestParents || []).map((m) => ({
            recipient_id: m.parent_id,
            type: "playdate_cancelled",
            title: "Playdate cancelled",
            body: `${hostLabel} cancelled the playdate for ${whenStr}.`,
          }));
          if (rows.length > 0) {
            await supabase.from("notifications").insert(rows);
          }
        }
      } catch (notifErr) {
        // Best-effort.
      }

      await supabase.from("playdate_invites").delete().eq("playdate_id", pd.id);
      await supabase.from("playdates").delete().eq("id", pd.id);

      setMessage("Playdate cancelled");
      await fetchData();
      if (typeof onChanged === "function") onChanged();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBusy(false);
  };

  // Opens the in-app confirm modal (replaces window.confirm, which fails on mobile).
  const cancelPlaydate = (pd) => {
    setConfirm({
      title: "Cancel this playdate?",
      body: "Invited families will be notified and it'll be removed from their calendars.",
      confirmLabel: "Cancel playdate",
      cancelLabel: "Keep it",
      tone: "danger",
      onConfirm: () => doCancelPlaydate(pd),
    });
  };

  const rsvpColor = (rsvp) =>
    rsvp === "yes" ? "#02C39A" : rsvp === "maybe" ? "#F59E0B" : rsvp === "no" ? "#F87171" : "#607080";
  const rsvpLabel = (rsvp) =>
    rsvp === "yes" ? "Going" : rsvp === "maybe" ? "Maybe" : rsvp === "no" ? "Declined" : "Invited";

  const hostBadge = (roster, dim) => {
    if (dim) return { text: "Hosted", bg: "#1A3A5C", color: "#8AAEC8" };
    if (!roster || roster.length === 0) return { text: "No guests yet", bg: "#1A3A5C", color: "#8AAEC8" };
    const going = roster.filter((r) => r.rsvp === "yes").length;
    if (going > 0) return { text: `${going} going`, bg: "#0F3D2E", color: "#02C39A" };
    const anyOpen = roster.some((r) => r.rsvp === "invited" || r.rsvp === "maybe");
    if (anyOpen) return { text: "Pending", bg: "#1A3A5C", color: "#8AAEC8" };
    return { text: "Declined", bg: "#3D1515", color: "#F87171" };
  };

  const now = Date.now();
  const isPast = (it) => new Date(it.playdate.proposed_date).getTime() < now;
  const isDeclined = (it) => it.kind === "invited" && it.invite.rsvp === "no";

  const declined = items
    .filter((it) => isDeclined(it))
    .sort((a, b) => new Date(b.playdate.proposed_date) - new Date(a.playdate.proposed_date));

  const active = items.filter((it) => !isDeclined(it));

  const needsAttention = active
    .filter((it) => !isPast(it) && it.kind === "invited" && it.invite.rsvp === "invited")
    .sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));

  const upcoming = active
    .filter((it) => !isPast(it) && !(it.kind === "invited" && it.invite.rsvp === "invited"))
    .sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));

  const past = active
    .filter((it) => isPast(it))
    .sort((a, b) => new Date(b.playdate.proposed_date) - new Date(a.playdate.proposed_date));

  const card = (dim) => ({
    background: dim ? "#13233F" : "#162D50",
    borderRadius: "12px",
    padding: "1.1rem 1.25rem",
    marginBottom: "12px",
    border: "1px solid #2A4A6B",
    opacity: dim ? 0.6 : 1,
  });
  const sectionLabel = { color: "#8AAEC8", fontSize: "0.8rem", letterSpacing: "0.05em", margin: "0 0 0.75rem" };
  const metaRow = { color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 4px" };

  const calButtonStyle = {
    width: "100%", marginTop: "0.85rem", padding: "0.6rem", borderRadius: "8px",
    border: "1px solid #02C39A", background: "transparent", color: "#02C39A",
    fontSize: "0.85rem", fontWeight: "600", cursor: "pointer",
  };

  // ---- If creating a playdate, render the request form (reuses existing flow) ----
  if (requestingPlaydate) {
    return (
      <PlaydateRequest
        session={session}
        recipient={requestingPlaydate}
        onBack={() => setRequestingPlaydate(null)}
        onSent={() => {
          setRequestingPlaydate(null);
          setPicking(false);
          fetchData();
          if (typeof onChanged === "function") onChanged();
        }}
      />
    );
  }

  // ---- PERSON PICKER VIEW (the "+" create-flow) ----
  if (picking) {
    const filtered = pickPeople.filter((p) =>
      (p.name || "").toLowerCase().includes(pickSearch.toLowerCase())
    );
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
          <button onClick={() => setPicking(false)} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Who's it with?</h1>
          <div style={{ width: "52px" }} />
        </div>

        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          <input
            type="text"
            placeholder="Search by name..."
            value={pickSearch}
            onChange={(e) => setPickSearch(e.target.value)}
            style={{ width: "100%", padding: "0.85rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "1rem", marginBottom: "1.25rem", boxSizing: "border-box" }}
          />

          {pickLoading ? (
            <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
              <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>👋</p>
              <p style={{ color: "#FFFFFF", fontSize: "1.05rem", margin: "0 0 0.5rem" }}>
                {pickPeople.length === 0 ? "No one to huddle with yet" : "No matches"}
              </p>
              <p style={{ color: "#607080", fontSize: "0.9rem", lineHeight: "1.5" }}>
                {pickPeople.length === 0
                  ? "Find parents in your classrooms on the Home tab, or connect with families in Search — then set up a playdate here."
                  : "Try a different name."}
              </p>
            </div>
          ) : (
            filtered.map((p) => (
              <div key={p.id}
                onClick={() => setRequestingPlaydate({ id: p.id, name: p.name, photo_url: p.photo_url })}
                style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0, overflow: "hidden" }}>
                    {p.photo_url ? (
                      <img src={p.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (p.name?.charAt(0) || "?")}
                  </div>
                  <div>
                    <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(p.name)}</p>
                    <p style={{ color: "#607080", fontSize: "0.78rem", margin: 0 }}>{p.source}</p>
                  </div>
                </div>
                <span style={{ color: "#02C39A", fontSize: "0.85rem", fontWeight: "600", flexShrink: 0 }}>Select →</span>
              </div>
            ))
          )}
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

  const nothing = needsAttention.length === 0 && upcoming.length === 0 && past.length === 0 && declined.length === 0;

  const renderCard = (it, dim) => {
    const pd = it.playdate;
    if (it.kind === "invited") {
      const needsReply = it.invite.rsvp === "invited";
      const showCal = !dim && it.invite.rsvp === "yes";
      return (
        <div key={`inv-${it.invite.id}`} style={card(dim)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: 0 }}>{it.organizerLabel} invited you</p>
            {!dim && needsReply ? (
              <span style={{ fontSize: "0.65rem", background: "#3D1F0A", color: "#F59E0B", padding: "3px 9px", borderRadius: "8px", whiteSpace: "nowrap", border: "1px solid #854F0B" }}>Needs reply</span>
            ) : (
              <span style={{ fontSize: "0.7rem", color: rsvpColor(it.invite.rsvp), fontWeight: "600", whiteSpace: "nowrap" }}>{rsvpLabel(it.invite.rsvp)}</span>
            )}
          </div>
          <p style={{ ...metaRow, color: dim ? "#8AAEC8" : "#02C39A" }}>📅 {fmtDate(pd.proposed_date)}</p>
          <p style={metaRow}>📍 {pd.location_name}{pd.location_address ? ` — ${pd.location_address}` : ""}</p>
          {petLine(pd, true)}
          {pd.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "0.5rem 0 0", fontStyle: "italic" }}>"{pd.note}"</p>}

          {!dim && (
            <div style={{ display: "flex", gap: "8px", marginTop: "1rem" }}>
              <button onClick={() => respond(it.invite.id, "yes")} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "none", background: it.invite.rsvp === "yes" ? "#02C39A" : "#0F3D2E", color: it.invite.rsvp === "yes" ? "#0F2044" : "#02C39A", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                Going
              </button>
              <button onClick={() => respond(it.invite.id, "maybe")} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #854F0B", background: it.invite.rsvp === "maybe" ? "#854F0B" : "transparent", color: "#F59E0B", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                Maybe
              </button>
              <button onClick={() => respond(it.invite.id, "no")} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#F87171", fontSize: "0.85rem", cursor: "pointer" }}>
                Can't go
              </button>
            </div>
          )}

          {dim && isDeclined(it) && (
            <button onClick={() => respond(it.invite.id, "yes")} disabled={busy}
              style={{ width: "100%", marginTop: "0.85rem", padding: "0.55rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.8rem", cursor: "pointer" }}>
              Changed your mind? Tap to go
            </button>
          )}

          {showCal && (
            <button onClick={() => addToCalendar(pd)} style={calButtonStyle}>
              📆 Add to calendar
            </button>
          )}
        </div>
      );
    }

    const badge = hostBadge(it.roster, dim);
    const showCal = !dim && it.goingCount > 0;
    return (
      <div key={`host-${pd.id}`} style={card(dim)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <p style={{ color: dim ? "#8AAEC8" : "#02C39A", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>📅 {fmtDate(pd.proposed_date)}</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>📍 {pd.location_name}{pd.location_address ? ` — ${pd.location_address}` : ""}</p>
          </div>
          <span style={{ fontSize: "0.65rem", background: badge.bg, color: badge.color, padding: "3px 9px", borderRadius: "8px", whiteSpace: "nowrap" }}>
            {badge.text}
          </span>
        </div>

        {petLine(pd, false)}

        {pd.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "6px 0 12px", fontStyle: "italic" }}>"{pd.note}"</p>}

        <div style={{ borderTop: "1px solid #2A4A6B", paddingTop: "0.75rem", marginTop: pd.note ? 0 : "0.75rem" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.7rem", letterSpacing: "0.05em", margin: "0 0 0.6rem" }}>GUEST LIST</p>
          {it.roster.length === 0 && (
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0, fontStyle: "italic" }}>No families invited yet.</p>
          )}
          {it.roster.map((inv) => (
            <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: "600", color: "#FFFFFF", flexShrink: 0 }}>
                  {inv.initial}
                </div>
                <span style={{ color: "#FFFFFF", fontSize: "0.85rem" }}>{inv.label}</span>
              </div>
              <span style={{ color: rsvpColor(inv.rsvp), fontSize: "0.8rem", fontWeight: "500" }}>{rsvpLabel(inv.rsvp)}</span>
            </div>
          ))}
        </div>

        {showCal && (
          <button onClick={() => addToCalendar(pd)} style={calButtonStyle}>
            📆 Add to calendar
          </button>
        )}

        {!dim && (
          <button onClick={() => cancelPlaydate(pd)} disabled={busy}
            style={{ width: "100%", marginTop: "0.85rem", padding: "0.7rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.85rem", fontWeight: "500", cursor: "pointer", minHeight: "44px" }}>
            Cancel playdate
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Playdates</h1>
        {(needsAttention.length + upcoming.length) > 0 && (
          <span style={{ color: "#607080", fontSize: "0.8rem" }}>{needsAttention.length + upcoming.length} upcoming</span>
        )}
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* Create entry point — this page is where you ACT */}
        <button onClick={openPicker}
          style={{ width: "100%", padding: "0.95rem", borderRadius: "12px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          ➕ Set up a playdate
        </button>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {nothing && (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>📅</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No playdates yet</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Tap "Set up a playdate" above to invite a family.</p>
          </div>
        )}

        {needsAttention.length > 0 && (
          <>
            <p style={sectionLabel}>NEEDS YOUR REPLY</p>
            {needsAttention.map((it) => renderCard(it, false))}
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <p style={{ ...sectionLabel, marginTop: needsAttention.length > 0 ? "1.5rem" : 0 }}>UPCOMING</p>
            {upcoming.map((it) => renderCard(it, false))}
          </>
        )}

        {past.length > 0 && (
          <>
            <p style={{ ...sectionLabel, marginTop: (needsAttention.length + upcoming.length) > 0 ? "1.5rem" : 0, color: "#607080" }}>PAST</p>
            {past.map((it) => renderCard(it, true))}
          </>
        )}

        {declined.length > 0 && (
          <>
            <p style={{ ...sectionLabel, marginTop: (needsAttention.length + upcoming.length + past.length) > 0 ? "1.5rem" : 0, color: "#607080" }}>DECLINED</p>
            {declined.map((it) => renderCard(it, true))}
          </>
        )}
      </div>

      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}