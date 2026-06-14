import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Playdates({ session }) {
  const [householdId, setHouseholdId] = useState(null);
  const [organized, setOrganized] = useState([]);
  const [invited, setInvited] = useState([]);
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

  // Returns a display label for a household: "Nick P. & Angi P."
  const householdLabel = async (hhId) => {
    const { data } = await supabase
      .from("household_members")
      .select("parents(name)")
      .eq("household_id", hhId);
    const names = (data || []).map((m) => m.parents?.name).filter(Boolean);
    if (names.length === 0) return "A family";
    return names.map(shortName).join(" & ");
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

    // Playdates my household organized.
    const { data: org } = await supabase
      .from("playdates")
      .select("*")
      .eq("organizer_household_id", hhId)
      .order("proposed_date", { ascending: true });

    // For each, load the invite roster + a label per invited household.
    const organizedEnriched = [];
    for (const pd of (org || [])) {
      const { data: invites } = await supabase
        .from("playdate_invites")
        .select("*")
        .eq("playdate_id", pd.id);
      const roster = [];
      for (const inv of (invites || [])) {
        roster.push({ ...inv, label: await householdLabel(inv.household_id) });
      }
      organizedEnriched.push({ ...pd, roster });
    }
    setOrganized(organizedEnriched);

    // Playdates my household was invited to (not ones I organized).
    const { data: myInvites } = await supabase
      .from("playdate_invites")
      .select("*, playdates(*)")
      .eq("household_id", hhId);

    const invitedEnriched = [];
    for (const inv of (myInvites || [])) {
      const pd = inv.playdates;
      if (!pd) continue;
      if (pd.organizer_household_id === hhId) continue; // skip my own
      const organizerLabel = await householdLabel(pd.organizer_household_id);
      invitedEnriched.push({ invite: inv, playdate: pd, organizerLabel });
    }
    invitedEnriched.sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));
    setInvited(invitedEnriched);

    setLoading(false);
  };

  const respond = async (inviteId, rsvp) => {
    setBusy(true);
    try {
      await supabase
        .from("playdate_invites")
        .update({ rsvp, responded_at: new Date().toISOString() })
        .eq("id", inviteId);
      setMessage(rsvp === "yes" ? "You're going!" : rsvp === "maybe" ? "Marked as maybe" : "Declined");
      await fetchData();
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

  const card = { background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "12px", border: "1px solid #2A4A6B" };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Loading...</p>
      </div>
    );
  }

  const nothing = organized.length === 0 && invited.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Playdates</h1>
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
            <p style={{ color: "#607080", fontSize: "0.9rem" }}>Tap "Huddle →" next to a parent on your Home screen to invite them.</p>
          </div>
        )}

        {/* Invites to my household */}
        {invited.length > 0 && (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>INVITES FOR YOU</p>
            {invited.map(({ invite, playdate, organizerLabel }) => (
              <div key={invite.id} style={card}>
                <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 4px" }}>{organizerLabel} invited you</p>
                <p style={{ color: "#02C39A", fontSize: "0.9rem", margin: "0 0 2px" }}>📅 {fmtDate(playdate.proposed_date)}</p>
                <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 2px" }}>📍 {playdate.location_name}{playdate.location_address ? ` — ${playdate.location_address}` : ""}</p>
                {playdate.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "0.5rem 0 0", fontStyle: "italic" }}>"{playdate.note}"</p>}

                <div style={{ display: "flex", gap: "8px", marginTop: "1rem" }}>
                  <button onClick={() => respond(invite.id, "yes")} disabled={busy}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "none", background: invite.rsvp === "yes" ? "#02C39A" : "#0F3D2E", color: invite.rsvp === "yes" ? "#0F2044" : "#02C39A", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                    Going
                  </button>
                  <button onClick={() => respond(invite.id, "maybe")} disabled={busy}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #854F0B", background: invite.rsvp === "maybe" ? "#854F0B" : "transparent", color: "#F59E0B", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer" }}>
                    Maybe
                  </button>
                  <button onClick={() => respond(invite.id, "no")} disabled={busy}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: invite.rsvp === "no" ? "#3D1515" : "transparent", color: "#F87171", fontSize: "0.85rem", cursor: "pointer" }}>
                    Can't go
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Playdates I organized */}
        {organized.length > 0 && (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: invited.length > 0 ? "1.5rem 0 0.75rem" : "0 0 0.75rem", letterSpacing: "0.05em" }}>YOU'RE HOSTING</p>
            {organized.map((pd) => (
              <div key={pd.id} style={card}>
                <p style={{ color: "#02C39A", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>📅 {fmtDate(pd.proposed_date)}</p>
                <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 2px" }}>📍 {pd.location_name}{pd.location_address ? ` — ${pd.location_address}` : ""}</p>
                {pd.note && <p style={{ color: "#607080", fontSize: "0.85rem", margin: "0.5rem 0 0", fontStyle: "italic" }}>"{pd.note}"</p>}

                <div style={{ marginTop: "1rem", borderTop: "1px solid #2A4A6B", paddingTop: "0.75rem" }}>
                  <p style={{ color: "#8AAEC8", fontSize: "0.7rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>GUEST LIST</p>
                  {pd.roster.map((inv) => (
                    <div key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <p style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: 0 }}>{inv.label}</p>
                      <span style={{ color: rsvpColor(inv.rsvp), fontSize: "0.8rem", fontWeight: "500" }}>{rsvpLabel(inv.rsvp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}