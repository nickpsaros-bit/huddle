import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Icon from "./Icon";
import TopBar from "./TopBar";
import PlaydateRequest from "./PlaydateRequest";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Days until the next occurrence of a month/day (this year or next).
function daysUntil(month, day) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), month - 1, day);
  if (next < today) next = new Date(now.getFullYear() + 1, month - 1, day);
  return Math.round((next - today) / (1000 * 60 * 60 * 24));
}

function friendlyWhen(days) {
  if (days === 0) return "Today! 🎉";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `In ${days} days`;
  if (days <= 31) return `In ${Math.round(days / 7)} week${days > 13 ? "s" : ""}`;
  return null; // farther out — we show the date instead
}

export default function Birthdays({
  session, avatarUrl, onProfileClick, onSearchClick, onBellClick, notificationCount = 0, onChanged,
}) {
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState([]);   // connections' birthdays, sorted soonest-first
  const [invites, setInvites] = useState([]);      // inbound birthday invites
  const [myHouseholdId, setMyHouseholdId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Create flow: opens the birthday invite form (family picker first).
  const [creating, setCreating] = useState(false);
  const [pickPeople, setPickPeople] = useState([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [pickFilter, setPickFilter] = useState("");
  const [launchRecipients, setLaunchRecipients] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const userId = session.user.id;
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", userId)
        .maybeSingle();
      if (!hm) { setLoading(false); return; }
      const hhId = hm.household_id;
      setMyHouseholdId(hhId);

      // --- Section 2: upcoming birthdays of connections ---
      const { data: conns } = await supabase
        .from("connections")
        .select("requester_id, recipient_id, status")
        .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
        .eq("status", "accepted");

      const otherParentIds = (conns || []).map((c) =>
        c.requester_id === userId ? c.recipient_id : c.requester_id
      );

      let feed = [];
      if (otherParentIds.length > 0) {
        // Map connected parents -> their households.
        const { data: theirHms } = await supabase
          .from("household_members")
          .select("parent_id, household_id")
          .in("parent_id", otherParentIds);
        const householdIds = [...new Set((theirHms || []).map((h) => h.household_id))];

        if (householdIds.length > 0) {
          // Names for display (one representative parent name per household).
          const { data: parentRows } = await supabase
            .from("parents")
            .select("id, name")
            .in("id", otherParentIds);
          const nameByParent = {};
          for (const p of (parentRows || [])) nameByParent[p.id] = p.name;
          const nameByHousehold = {};
          for (const h of (theirHms || [])) {
            if (!nameByHousehold[h.household_id] && nameByParent[h.parent_id]) {
              nameByHousehold[h.household_id] = nameByParent[h.parent_id];
            }
          }

          const { data: bdays } = await supabase
            .from("household_birthdays")
            .select("household_id, month, day, label")
            .in("household_id", householdIds);

          feed = (bdays || []).map((b) => {
            const days = daysUntil(b.month, b.day);
            return {
              householdId: b.household_id,
              familyName: nameByHousehold[b.household_id] || "A family",
              label: b.label,
              month: b.month,
              day: b.day,
              days,
            };
          }).sort((a, b) => a.days - b.days);
        }
      }
      setUpcoming(feed);

      // --- Section 3: inbound birthday invites (event_type = birthday) ---
      const { data: myInv } = await supabase
        .from("playdate_invites")
        .select("*, playdates(*)")
        .eq("household_id", hhId);

      const bdayInvites = [];
      for (const inv of (myInv || [])) {
        const pd = inv.playdates;
        if (!pd) continue;
        if (pd.event_type !== "birthday") continue;
        if (pd.organizer_household_id === hhId) continue;
        if (new Date(pd.proposed_date).getTime() < Date.now()) continue;
        // organizer label
        let organizerLabel = "A family";
        const { data: orgMembers } = await supabase
          .from("household_members")
          .select("parent_id")
          .eq("household_id", pd.organizer_household_id)
          .limit(1);
        if (orgMembers && orgMembers[0]) {
          const { data: op } = await supabase
            .from("parents").select("name").eq("id", orgMembers[0].parent_id).maybeSingle();
          if (op?.name) organizerLabel = op.name;
        }
        bdayInvites.push({ invite: inv, playdate: pd, organizerLabel });
      }
      bdayInvites.sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));
      setInvites(bdayInvites);
    } catch (e) {
      // best-effort
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [session]);

  const respond = async (inviteId, rsvp) => {
    setBusy(true);
    try {
      await supabase.from("playdate_invites").update({ rsvp }).eq("id", inviteId);
      setMessage(rsvp === "yes" ? "You're going! 🎉" : "Response sent.");
      if (typeof onChanged === "function") onChanged();
      await load();
    } catch (e) {
      setMessage("Something went wrong.");
    }
    setBusy(false);
  };

  // --- Create flow: load families I can invite (my connections) ---
  const openCreate = async () => {
    setCreating(true);
    setPickLoading(true);
    setSelectedIds([]);
    try {
      const userId = session.user.id;
      const { data } = await supabase
        .from("connections")
        .select(`requester_id, recipient_id, status,
                 requester:parents!connections_requester_id_fkey(id, name, photo_url),
                 recipient:parents!connections_recipient_id_fkey(id, name, photo_url)`)
        .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
        .eq("status", "accepted");
      const people = (data || []).map((c) => {
        const isReq = c.requester_id === userId;
        return isReq ? c.recipient : c.requester;
      }).filter(Boolean);
      setPickPeople(people);
    } catch (e) {
      setPickPeople([]);
    }
    setPickLoading(false);
  };

  const toggleSelect = (p) => {
    setSelectedIds((prev) =>
      prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
    );
  };

  const continueToForm = () => {
    const chosen = pickPeople.filter((p) => selectedIds.includes(p.id));
    if (chosen.length === 0) return;
    setLaunchRecipients(chosen.map((p) => ({ id: p.id, name: p.name, photo_url: p.photo_url })));
  };

  // When the birthday form is open, render it.
  if (launchRecipients) {
    return (
      <PlaydateRequest
        session={session}
        recipients={launchRecipients}
        eventType="birthday"
        onBack={() => { setLaunchRecipients(null); }}
        onSent={() => {
          setLaunchRecipients(null);
          setCreating(false);
          setMessage("Birthday invite sent! 🎂");
          if (typeof onChanged === "function") onChanged();
          load();
        }}
      />
    );
  }

  const fmtInviteDate = (iso) => {
    try {
      return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
      <TopBar
        title="Birthdays"
        notificationCount={notificationCount}
        onBellClick={onBellClick}
        onSearchClick={onSearchClick}
        onProfileClick={onProfileClick}
        avatarUrl={avatarUrl}
        initial="?"
      />

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* Create a birthday invite */}
        <button onClick={openCreate}
          style={{ width: "100%", padding: "0.95rem", borderRadius: "12px", border: "none", background: "#7C5CBF", color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          🎂 Set up a birthday invite
        </button>

        {message && (
          <div style={{ background: "#2A1E3D", border: "1px solid #7C5CBF", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1.25rem" }}>
            <p style={{ color: "#B8A4E0", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : (
          <>
            {/* Section 3: invites sent to you */}
            {invites.length > 0 && (
              <div style={{ marginBottom: "2rem" }}>
                <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.06em", margin: "0 0 0.75rem" }}>INVITED TO</p>
                {invites.map(({ invite, playdate, organizerLabel }) => (
                  <div key={invite.id} style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "1rem", marginBottom: "0.75rem" }}>
                    <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: "0 0 4px" }}>
                      🎂 {organizerLabel}'s birthday celebration
                    </p>
                    <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 2px" }}>{fmtInviteDate(playdate.proposed_date)}</p>
                    {playdate.location_name && (
                      <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>
                        <Icon name="location_on" size={16} style={{ verticalAlign: "-3px", marginRight: 2 }} />{playdate.location_name}
                      </p>
                    )}
                    {invite.rsvp === "invited" ? (
                      <div style={{ display: "flex", gap: "8px", marginTop: "0.85rem" }}>
                        <button disabled={busy} onClick={() => respond(invite.id, "yes")}
                          style={{ flex: 1, padding: "0.6rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontWeight: "700", cursor: "pointer" }}>
                          Going
                        </button>
                        <button disabled={busy} onClick={() => respond(invite.id, "no")}
                          style={{ flex: 1, padding: "0.6rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontWeight: "600", cursor: "pointer" }}>
                          Can't make it
                        </button>
                      </div>
                    ) : (
                      <p style={{ color: invite.rsvp === "yes" ? "#02C39A" : "#607080", fontSize: "0.85rem", fontWeight: "600", margin: "0.85rem 0 0" }}>
                        {invite.rsvp === "yes" ? "You're going 🎉" : "You declined"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Section 2: upcoming birthdays of connections */}
            <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.06em", margin: "0 0 0.75rem" }}>UPCOMING IN YOUR NETWORK</p>
            {upcoming.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
                <p style={{ margin: "0 0 0.75rem" }}><Icon name="cake" size={40} color="#3E5A7F" /></p>
                <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
                  No birthdays saved yet by families you've connected with. As your network adds their birthdays, they'll show up here.
                </p>
              </div>
            ) : (
              upcoming.map((b, i) => {
                const friendly = friendlyWhen(b.days);
                const dateStr = `${MONTHS[b.month - 1]} ${b.day}`;
                return (
                  <div key={`${b.householdId}-${i}`} style={{ display: "flex", alignItems: "center", gap: "12px", background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.85rem 1rem", marginBottom: "0.6rem" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#2A1E3D", border: "1px solid #7C5CBF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "1.1rem" }}>🎂</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "600", margin: 0 }}>
                        {b.label ? b.label : `${b.familyName}'s family`}
                      </p>
                      <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "2px 0 0" }}>{dateStr}</p>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <p style={{ color: b.days <= 7 ? "#02C39A" : "#8AAEC8", fontSize: "0.8rem", fontWeight: "600", margin: 0 }}>
                        {friendly || dateStr}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Create: family picker overlay */}
      {creating && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#0F2044", zIndex: 60, overflowY: "auto" }}>
          <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B", display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={() => setCreating(false)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex" }}>
              <Icon name="arrow_back" size={22} color="#8AAEC8" />
            </button>
            <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>🎂 Invite families</h1>
          </div>
          <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: "0 0 1rem" }}>
              Choose which families to invite to the birthday celebration.
            </p>
            <input
              type="text"
              value={pickFilter}
              onChange={(e) => setPickFilter(e.target.value)}
              placeholder="Search families…"
              style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.95rem", marginBottom: "1rem", boxSizing: "border-box" }}
            />
            {selectedIds.length > 0 && (
              <button onClick={continueToForm}
                style={{ width: "100%", padding: "0.95rem", borderRadius: "12px", border: "none", background: "#7C5CBF", color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer", marginBottom: "1.25rem" }}>
                Continue with {selectedIds.length} {selectedIds.length === 1 ? "family" : "families"} →
              </button>
            )}
            {pickLoading ? (
              <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
            ) : pickPeople.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
                <p style={{ margin: "0 0 0.75rem" }}><Icon name="group" size={40} color="#3E5A7F" /></p>
                <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
                  You'll be able to invite families once you've connected with some. Head to your network to connect.
                </p>
              </div>
            ) : (
              pickPeople
                .filter((p) => !pickFilter.trim() || (p.name || "").toLowerCase().includes(pickFilter.trim().toLowerCase()))
                .map((p) => {
                const sel = selectedIds.includes(p.id);
                return (
                  <div key={p.id} onClick={() => toggleSelect(p)}
                    style={{ display: "flex", alignItems: "center", gap: "12px", background: sel ? "#2A1E3D" : "#162D50", border: `1px solid ${sel ? "#7C5CBF" : "#2A4A6B"}`, borderRadius: "12px", padding: "0.75rem 1rem", marginBottom: "0.6rem", cursor: "pointer" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#028090", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontWeight: "600", flexShrink: 0 }}>
                      {p.photo_url ? <img src={p.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (p.name?.charAt(0) || "?")}
                    </div>
                    <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: 0, flex: 1 }}>{p.name}</p>
                    {sel && <Icon name="check_circle" size={22} color="#7C5CBF" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}