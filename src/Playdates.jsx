import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Playdates({ session, onChanged }) {
  const [householdId, setHouseholdId] = useState(null);
  const [items, setItems] = useState([]); // unified list of playdates I'm in
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

    // Playdates my household hosts.
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

    // Playdates my household is invited to.
    const { data: myInvites } = await supabase
      .from("playdate_invites")
      .select("*, playdates(*)")
      .eq("household_id", hhId);

    for (const inv of (myInvites || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.organizer_household_id === hhId) continue; // already in hosting
      const organizerLabel = await householdLabel(pd.organizer_household_id);
      all.push({ kind: "invited", playdate: pd, invite: inv, organizerLabel });
    }

    setItems(all);
    setLoading(false);
  };

  const respond = async (inviteId, rsvp) => {
    setBusy(true);
    try {
      await supabase
        .from("playdate_invites")
        .update({ rsvp, responded_at: new Date().toISOString() })
        .eq("id", inviteId);
      setMessage(rsvp === "yes" ? "You're going!" : rsvp === "maybe" ? "Marked as maybe" : "Can't make it");
      await fetchData();
      if (typeof onChanged === "function") onChanged();
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
    setBusy(false);
  };

  const rsvpColor = (rsvp) =>
    rsvp === "yes" ? "#02C39A" : rsvp === "maybe" ? "#F59E0B" : rsvp === "no" ? "#F87171" : "#607080";
  const rsvpLabel = (rsvp) =>
    rsvp === "yes" ? "Going" : rsvp === "maybe" ? "Maybe" : rsvp === "no" ? "Declined" : "Invited";

  const now = Date.now();
  const isPast = (it) => new Date(it.playdate.proposed_date).getTime() < now;
  const myRsvp = (it) => (it.kind === "invited" ? it.invite.rsvp : "yes"); // host treated as "going"

  // Partition into zones (declined invites hidden entirely).
  const visible = items.filter((it) => !(it.kind === "invited" && it.invite.rsvp === "no"));

  const needsAttention = visible
    .filter((it) => !isPast(it) && it.kind === "invited" && it.invite.rsvp === "invited")
    .sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));

  const upcoming = visible
    .filter((it) => !isPast(it) && !(it.kind === "invited" && it.invite.rsvp === "invited"))
    .sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));

  const past = visible
    .filter((it) => isPast(it))
    .sort((a, b) => new Date(b.playdate.proposed_date) - new Date(a.playdate.proposed_date)); // newest past first

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

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  const nothing = needsAttention.length === 0 && upcoming.length === 0 && past.length === 0;

  // Renders the body of a card (shared between zones). `dim` removes action buttons.
  const renderCard = (it, dim) => {
    const pd = it.playdate;
    if (it.kind === "invited") {
      const needsReply = it.invite.rsvp === "invited";
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
        </div>
      );
    }

    // hosting card
    return (
      <div key={`host-${pd.id}`} style={card(dim)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div>
            <p style={{ color: dim ? "#8AAEC8" : "#02C39A", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>📅 {fmtDate(pd.proposed_date)}</p>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>📍 {pd.location_name}{pd.location_address ? ` — ${pd.location_address}` : ""}</p>
          </div>
          <span style={{ fontSize: "0.65rem", background: it.goingCount > 0 ? "#0F3D2E" : "#1A3A5C", color: it.goingCount > 0 ? "#02C39A" : "#8AAEC8", padding: "3px 9px", borderRadius: "8px", whiteSpace: "nowrap" }}>
            {dim ? "Hosted" : (it.goingCount > 0 ? `${it.goingCount} going` : "Pending")}
          </span>
        </div>

        {pd.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "6px 0 12px", fontStyle: "italic" }}>"{pd.note}"</p>}

        <div style={{ borderTop: "1px solid #2A4A6B", paddingTop: "0.75rem", marginTop: pd.note ? 0 : "0.75rem" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.7rem", letterSpacing: "0.05em", margin: "0 0 0.6rem" }}>GUEST LIST</p>
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

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {nothing && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>📅</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No playdates yet</p>
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Tap "Huddle →" next to a parent on your Home screen to set one up.</p>
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
      </div>
    </div>
  );
}