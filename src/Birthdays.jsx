import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Icon from "./Icon";
import TopBar from "./TopBar";
import PlaydateRequest from "./PlaydateRequest";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GRADES = ["TK", "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade"];
function gradeLabel(g) {
  return typeof g === "number" && GRADES[g] ? GRADES[g] : "Classroom";
}

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
  const [hosting, setHosting] = useState([]);      // birthdays I'm hosting
  const [myHouseholdId, setMyHouseholdId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connectPrompt, setConnectPrompt] = useState(null); // { hostParentId, hostName }

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

      // --- Section: birthdays I'm HOSTING ---
      const { data: myHosted } = await supabase
        .from("playdates")
        .select("*")
        .eq("organizer_household_id", hhId)
        .eq("event_type", "birthday")
        .gte("proposed_date", new Date(Date.now()).toISOString());

      const hostedList = [];
      for (const pd of (myHosted || [])) {
        const { data: pdInvites } = await supabase
          .from("playdate_invites")
          .select("*")
          .eq("playdate_id", pd.id);
        const guests = (pdInvites || []).filter((inv) => inv.household_id !== hhId);
        const roster = [];
        for (const inv of guests) {
          // lightweight household label (first parent's name)
          let label = "A family";
          const { data: gm } = await supabase
            .from("household_members").select("parent_id").eq("household_id", inv.household_id).limit(1);
          if (gm && gm[0]) {
            const { data: gp } = await supabase.from("parents").select("name").eq("id", gm[0].parent_id).maybeSingle();
            if (gp?.name) label = gp.name;
          }
          roster.push({ ...inv, label });
        }
        hostedList.push({
          playdate: pd,
          roster,
          goingCount: roster.filter((r) => r.rsvp === "yes").length,
        });
      }
      hostedList.sort((a, b) => new Date(a.playdate.proposed_date) - new Date(b.playdate.proposed_date));
      setHosting(hostedList);
    } catch (e) {
      // best-effort
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [session]);

  const respond = async (inviteId, rsvp, hostHouseholdId) => {
    setBusy(true);
    try {
      await supabase.from("playdate_invites").update({ rsvp }).eq("id", inviteId);
      setMessage(rsvp === "yes" ? "You're going! 🎉" : "Response sent.");
      if (typeof onChanged === "function") onChanged();

      // On acceptance, if we're not already connected to the host, offer to connect.
      if (rsvp === "yes" && hostHouseholdId) {
        const userId = session.user.id;
        // Find a host parent to connect with.
        const { data: hostMembers } = await supabase
          .from("household_members")
          .select("parent_id, parents(name)")
          .eq("household_id", hostHouseholdId)
          .limit(1);
        const hostParentId = hostMembers?.[0]?.parent_id;
        const hostName = hostMembers?.[0]?.parents?.name || "this family";
        if (hostParentId && hostParentId !== userId) {
          // Already connected (either direction, any status)?
          const { data: existing } = await supabase
            .from("connections")
            .select("id, status")
            .or(`and(requester_id.eq.${userId},recipient_id.eq.${hostParentId}),and(requester_id.eq.${hostParentId},recipient_id.eq.${userId})`);
          if (!existing || existing.length === 0) {
            setConnectPrompt({ hostParentId, hostName });
          }
        }
      }
      await load();
    } catch (e) {
      setMessage("Something went wrong.");
    }
    setBusy(false);
  };

  const acceptConnect = async () => {
    if (!connectPrompt) return;
    setBusy(true);
    try {
      // Both sides consented (host invited, guest chose to connect) -> accepted.
      await supabase.from("connections").insert({
        requester_id: session.user.id,
        recipient_id: connectPrompt.hostParentId,
        status: "accepted",
      });
      setMessage(`You're now connected with ${connectPrompt.hostName}! 🤝`);
      if (typeof onChanged === "function") onChanged();
    } catch (e) {
      setMessage("Couldn't connect, but you're still going to the party.");
    }
    setConnectPrompt(null);
    setBusy(false);
  };

  // --- Create flow: load ALL families at my school(s) (not just connections) ---
  const openCreate = async () => {
    setCreating(true);
    setPickLoading(true);
    setSelectedIds([]);
    try {
      const userId = session.user.id;
      // My household.
      const { data: myHm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", userId)
        .maybeSingle();
      const myHhId = myHm?.household_id;

      // My classrooms -> my school ids.
      const { data: myCms } = await supabase
        .from("classroom_members")
        .select("classrooms(school_id)")
        .eq("household_id", myHhId);
      const schoolIds = [...new Set((myCms || []).map((c) => c.classrooms?.school_id).filter(Boolean))];
      if (schoolIds.length === 0) { setPickPeople([]); setPickLoading(false); return; }

      // All classrooms at those schools.
      const { data: schoolClassrooms } = await supabase
        .from("classrooms")
        .select("id, grade, teacher_name")
        .in("school_id", schoolIds);
      const classroomIds = (schoolClassrooms || []).map((c) => c.id);
      const classroomById = {};
      for (const c of (schoolClassrooms || [])) classroomById[c.id] = c;
      if (classroomIds.length === 0) { setPickPeople([]); setPickLoading(false); return; }

      // All memberships in those classrooms -> household ids (+ remember a grade/class per household).
      const { data: allMemberships } = await supabase
        .from("classroom_members")
        .select("household_id, classroom_id")
        .in("classroom_id", classroomIds);

      const classByHousehold = {}; // household_id -> {grade, teacher}
      const householdIds = new Set();
      for (const m of (allMemberships || [])) {
        if (m.household_id === myHhId) continue; // exclude self
        householdIds.add(m.household_id);
        if (!classByHousehold[m.household_id]) {
          const cr = classroomById[m.classroom_id];
          if (cr) classByHousehold[m.household_id] = { grade: cr.grade, teacher: cr.teacher_name };
        }
      }
      const hhIdList = [...householdIds];
      if (hhIdList.length === 0) { setPickPeople([]); setPickLoading(false); return; }

      // A representative parent (name/photo) per household.
      const { data: members } = await supabase
        .from("household_members")
        .select("household_id, parents(id, name, photo_url)")
        .in("household_id", hhIdList);

      const seen = new Set();
      const people = [];
      for (const m of (members || [])) {
        if (seen.has(m.household_id)) continue;
        const p = m.parents;
        if (!p) continue;
        seen.add(m.household_id);
        const cls = classByHousehold[m.household_id];
        people.push({
          id: p.id,
          householdId: m.household_id,
          name: p.name,
          photo_url: p.photo_url,
          classLabel: cls ? `${gradeLabel(cls.grade)}${cls.teacher ? " · " + cls.teacher : ""}` : "",
        });
      }
      people.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
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
                        <button disabled={busy} onClick={() => respond(invite.id, "yes", playdate.organizer_household_id)}
                          style={{ flex: 1, padding: "0.6rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontWeight: "700", cursor: "pointer" }}>
                          Going
                        </button>
                        <button disabled={busy} onClick={() => respond(invite.id, "no", playdate.organizer_household_id)}
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

            {/* Section: birthdays you're hosting */}
            {hosting.length > 0 && (
              <div style={{ marginBottom: "2rem" }}>
                <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.06em", margin: "0 0 0.75rem" }}>YOU'RE HOSTING</p>
                {hosting.map(({ playdate, roster, goingCount }) => (
                  <div key={playdate.id} style={{ background: "#162D50", border: "1px solid #7C5CBF", borderRadius: "12px", padding: "1rem", marginBottom: "0.75rem" }}>
                    <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: "0 0 4px" }}>
                      🎂 {playdate.title || "Birthday celebration"}
                    </p>
                    <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 2px" }}>{fmtInviteDate(playdate.proposed_date)}</p>
                    {playdate.location_name && (
                      <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 8px" }}>
                        <Icon name="location_on" size={16} style={{ verticalAlign: "-3px", marginRight: 2 }} />{playdate.location_name}
                      </p>
                    )}
                    <div style={{ borderTop: "1px solid #2A4A6B", marginTop: "8px", paddingTop: "8px" }}>
                      <p style={{ color: "#607080", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.04em", margin: "0 0 6px" }}>
                        GUEST LIST · {goingCount} going
                      </p>
                      {roster.length === 0 ? (
                        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>No guests invited yet.</p>
                      ) : (
                        roster.map((r) => (
                          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                            <span style={{ color: "#B8CCE0", fontSize: "0.85rem" }}>{r.label}</span>
                            <span style={{ color: r.rsvp === "yes" ? "#02C39A" : r.rsvp === "no" ? "#607080" : "#8AAEC8", fontSize: "0.78rem", fontWeight: "600" }}>
                              {r.rsvp === "yes" ? "Going" : r.rsvp === "no" ? "Can't make it" : "Invited"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
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

      {/* Connect-on-accept prompt */}
      {connectPrompt && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(6,16,36,0.8)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div style={{ background: "#162D50", border: "1px solid #7C5CBF", borderRadius: "16px", padding: "1.5rem", maxWidth: "360px", width: "100%" }}>
            <p style={{ margin: "0 0 0.75rem", textAlign: "center" }}><Icon name="group_add" size={40} color="#7C5CBF" /></p>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.15rem", fontWeight: "700", margin: "0 0 0.5rem", textAlign: "center" }}>
              Connect with {connectPrompt.hostName}?
            </h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.88rem", lineHeight: "1.5", margin: "0 0 1.25rem", textAlign: "center" }}>
              You're going to their celebration! Connect on Huddle to plan playdates and stay in touch more easily.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button disabled={busy} onClick={acceptConnect}
                style={{ width: "100%", padding: "0.8rem", borderRadius: "10px", border: "none", background: "#7C5CBF", color: "#FFFFFF", fontWeight: "700", cursor: "pointer", fontSize: "0.9rem" }}>
                Yes, connect
              </button>
              <button disabled={busy} onClick={() => setConnectPrompt(null)}
                style={{ width: "100%", padding: "0.8rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontWeight: "600", cursor: "pointer", fontSize: "0.9rem" }}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

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
                  No other families found at your school yet. As more families join, they'll appear here to invite.
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: 0 }}>{p.name}</p>
                      {p.classLabel && <p style={{ color: "#8AAEC8", fontSize: "0.78rem", margin: "1px 0 0" }}>{p.classLabel}</p>}
                    </div>
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