import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Icon from "./Icon";
import TopBar from "./TopBar";
import PlaydateRequest from "./PlaydateRequest";
import ConfirmModal from "./ConfirmModal";
import { getHiddenParentIds } from "./blocks";

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
  session, avatarUrl, onProfileClick, onSearchClick, onBellClick, notificationCount = 0, onChanged, onGoHome,
}) {
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState([]);   // connections' birthdays, sorted soonest-first
  const [invites, setInvites] = useState([]);      // inbound birthday invites
  const [hosting, setHosting] = useState([]);      // birthdays I'm hosting
  const [myHouseholdId, setMyHouseholdId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connectPrompt, setConnectPrompt] = useState(null); // { hostParentId, hostName }
  const [activeBday, setActiveBday] = useState(null); // the feed item whose action menu is open
  const [wishedIds, setWishedIds] = useState({});     // birthday_id -> true (already wished this year)
  const [askedIds, setAskedIds] = useState({});       // birthday_id -> true (already asked this year)

  // Per-tab help screen
  const [showHelp, setShowHelp] = useState(false);
  const [helpBugText, setHelpBugText] = useState("");
  const [helpBugBusy, setHelpBugBusy] = useState(false);
  const [helpBugSent, setHelpBugSent] = useState(false);

  // Create flow: opens the birthday invite form (family picker first).
  const [creating, setCreating] = useState(false);
  const [pickPeople, setPickPeople] = useState([]);
  const [myRooms, setMyRooms] = useState([]);          // my classrooms (browse cards)
  const [peopleByRoom, setPeopleByRoom] = useState({}); // classroom_id -> people
  const [viewingRoom, setViewingRoom] = useState(null); // a room object when drilled in
  const [emailMatch, setEmailMatch] = useState(null);   // exact email lookup result
  const [emailSearching, setEmailSearching] = useState(false);
  const [extraSelected, setExtraSelected] = useState([]); // email-found people not in pickPeople
  const [pickLoading, setPickLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [pickFilter, setPickFilter] = useState("");
  const [launchRecipients, setLaunchRecipients] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingRecipients, setEditingRecipients] = useState([]);
  const [confirm, setConfirm] = useState(null);

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

      const hiddenFeed = await getHiddenParentIds();
      const otherParentIds = (conns || [])
        .map((c) => c.requester_id === userId ? c.recipient_id : c.requester_id)
        .filter((pid) => !hiddenFeed.has(pid));

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
            .select("id, household_id, month, day, label")
            .in("household_id", householdIds);

          feed = (bdays || []).map((b) => {
            const days = daysUntil(b.month, b.day);
            return {
              id: b.id,
              householdId: b.household_id,
              familyName: nameByHousehold[b.household_id] || "A family",
              label: b.label,
              month: b.month,
              day: b.day,
              days,
            };
          }).sort((a, b) => a.days - b.days);

          // Which of these have I already wished this year?
          const bdayIds = (bdays || []).map((b) => b.id);
          if (bdayIds.length > 0) {
            const { data: myWishes } = await supabase
              .from("birthday_wishes")
              .select("birthday_id")
              .eq("wisher_id", userId)
              .eq("year", new Date().getFullYear())
              .in("birthday_id", bdayIds);
            const wished = {};
            for (const w of (myWishes || [])) wished[w.birthday_id] = true;
            setWishedIds(wished);
          }
        }
      }
      setUpcoming(feed);

      // --- Section 3: inbound birthday invites (event_type = birthday) ---
      const { data: myInv } = await supabase
        .from("playdate_invites")
        .select("*, playdates(*)")
        .eq("household_id", hhId);

      // Figure out which invites qualify, then BATCH-load all organizer names at once.
      const qualifyingInvites = (myInv || []).filter((inv) => {
        const pd = inv.playdates;
        if (!pd) return false;
        if (pd.event_type !== "birthday") return false;
        if (pd.organizer_household_id === hhId) return false;
        if (new Date(pd.proposed_date).getTime() < Date.now()) return false;
        return true;
      });

      // One batched query: all members of all organizer households.
      const orgHhIds = [...new Set(qualifyingInvites.map((inv) => inv.playdates.organizer_household_id))];
      const namesByHh = {};
      if (orgHhIds.length > 0) {
        const { data: orgMembersAll } = await supabase
          .from("household_members")
          .select("household_id, parents(name)")
          .in("household_id", orgHhIds);
        for (const row of (orgMembersAll || [])) {
          const first = (row.parents?.name || "").trim().split(/\s+/)[0];
          if (first) (namesByHh[row.household_id] = namesByHh[row.household_id] || []).push(first);
        }
      }
      const labelFor = (hhIdKey) => {
        const names = namesByHh[hhIdKey] || [];
        if (names.length === 0) return "A family";
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} & ${names[1]}`;
        return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
      };

      const bdayInvites = qualifyingInvites.map((inv) => ({
        invite: inv,
        playdate: inv.playdates,
        organizerLabel: labelFor(inv.playdates.organizer_household_id),
      }));
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
      if ((myHosted || []).length > 0) {
        // Load ALL invites for ALL hosted parties in one query.
        const hostedIds = myHosted.map((pd) => pd.id);
        const { data: allInvites } = await supabase
          .from("playdate_invites")
          .select("*")
          .in("playdate_id", hostedIds);

        // Batch-load names for every guest household across all parties.
        const guestHhIds = [...new Set((allInvites || [])
          .map((inv) => inv.household_id)
          .filter((id) => id && id !== hhId))];
        const guestNameByHh = {};
        if (guestHhIds.length > 0) {
          const { data: guestMembers } = await supabase
            .from("household_members")
            .select("household_id, parents(name)")
            .in("household_id", guestHhIds);
          for (const row of (guestMembers || [])) {
            if (!guestNameByHh[row.household_id] && row.parents?.name) {
              guestNameByHh[row.household_id] = row.parents.name;
            }
          }
        }

        for (const pd of myHosted) {
          const guests = (allInvites || []).filter((inv) => inv.playdate_id === pd.id && inv.household_id !== hhId);
          const roster = guests.map((inv) => ({
            ...inv,
            label: guestNameByHh[inv.household_id] || "A family",
          }));
          hostedList.push({
            playdate: pd,
            roster,
            goingCount: roster.filter((r) => r.rsvp === "yes").length,
          });
        }
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

  // Self-reminder. NOTE: the app has no scheduled-notification system yet, so
  // this drops a note into your OWN inbox now ("remember to get a gift for X").
  // A true date-scheduled reminder would need a reminders table + a scheduler.
  const addGiftReminder = async (b) => {
    setBusy(true);
    try {
      const who = b.label ? b.label : `${b.familyName}'s family`;
      await supabase.from("notifications").insert({
        recipient_id: session.user.id,
        type: "self_reminder",
        title: "Gift reminder 🎁",
        body: `Remember to get a gift or card for ${who} — birthday on ${MONTHS[b.month - 1]} ${b.day}.`,
      });
      setMessage("Saved to your inbox as a reminder! 🎁");
      setActiveBday(null);
      if (typeof onChanged === "function") onChanged();
    } catch (e) {
      setMessage("Couldn't save the reminder, please try again.");
    }
    setBusy(false);
  };

  // Send a birthday wish to a family in the awareness feed.
  const sendWish = async (b) => {
    setBusy(true);
    try {
      // Notify each parent in the target household.
      const { data: members } = await supabase
        .from("household_members").select("parent_id").eq("household_id", b.householdId);
      // My first name for the message.
      const { data: me } = await supabase
        .from("parents").select("name").eq("id", session.user.id).maybeSingle();
      const myFirst = (me?.name || "A family").trim().split(/\s+/)[0];
      const rows = (members || []).map((m) => ({
        recipient_id: m.parent_id,
        actor_id: session.user.id,
        type: "birthday_wish",
        title: "Birthday wishes! 🎂",
        body: `${myFirst}'s family is thinking of your family this birthday month!`,
      }));
      if (rows.length > 0) await supabase.from("notifications").insert(rows);
      // Persist so it sticks.
      try {
        await supabase.from("birthday_wishes").insert({
          birthday_id: b.id,
          wisher_id: session.user.id,
          target_household_id: b.householdId,
          year: new Date().getFullYear(),
        });
      } catch (e) { /* duplicate = already wished, fine */ }
      setWishedIds((prev) => ({ ...prev, [b.id]: true }));
      setMessage("Birthday wishes sent! 🎉");
      setActiveBday(null);
      if (typeof onChanged === "function") onChanged();
    } catch (e) {
      setMessage("Couldn't send wishes, please try again.");
    }
    setBusy(false);
  };

  // Ask the family what their child would like (gift-idea nudge).
  const askGift = async (b) => {
    setBusy(true);
    try {
      const { data: members } = await supabase
        .from("household_members").select("parent_id").eq("household_id", b.householdId);
      const { data: me } = await supabase
        .from("parents").select("name").eq("id", session.user.id).maybeSingle();
      const myFirst = (me?.name || "A family").trim().split(/\s+/)[0];
      const rows = (members || []).map((m) => ({
        recipient_id: m.parent_id,
        type: "gift_ask",
        actor_id: session.user.id,
        title: "A gift question 🎁",
        body: `${myFirst}'s family asked: is there anything special your child would like for their birthday?`,
      }));
      if (rows.length > 0) await supabase.from("notifications").insert(rows);
      setAskedIds((prev) => ({ ...prev, [b.id]: true }));
      setMessage("Your question was sent! 🎁");
      setActiveBday(null);
      if (typeof onChanged === "function") onChanged();
    } catch (e) {
      setMessage("Couldn't send, please try again.");
    }
    setBusy(false);
  };

  // --- Create flow: load ALL families at my school(s) (not just connections) ---
  const openCreate = async () => {
    setCreating(true);
    setPickLoading(true);
    setSelectedIds([]);
    setViewingRoom(null);
    setPickFilter("");
    setEmailMatch(null);
    setExtraSelected([]);
    try {
      const userId = session.user.id;
      // My household.
      const { data: myHm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", userId)
        .maybeSingle();
      const myHhId = myHm?.household_id;

      // My classrooms -> my school ids. Keep MY classrooms for the browse-by-room UI.
      const { data: myCms } = await supabase
        .from("classroom_members")
        .select("classroom_id, classrooms(id, school_id, grade, teacher_name)")
        .eq("household_id", myHhId);
      const schoolIds = [...new Set((myCms || []).map((c) => c.classrooms?.school_id).filter(Boolean))];
      // My own classrooms (the ones shown as cards at the top).
      const myClassrooms = [];
      const myClassroomIds = new Set();
      for (const c of (myCms || [])) {
        const cr = c.classrooms;
        if (cr && !myClassroomIds.has(cr.id)) {
          myClassroomIds.add(cr.id);
          myClassrooms.push({ id: cr.id, grade: cr.grade, teacher: cr.teacher_name });
        }
      }
      setMyRooms(myClassrooms);
      if (schoolIds.length === 0) { setPickPeople([]); setPeopleByRoom({}); setPickLoading(false); return; }

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
      const roomsByHousehold = {}; // household_id -> Set(classroom_id) — for grouping by MY rooms
      const householdIds = new Set();
      for (const m of (allMemberships || [])) {
        if (m.household_id === myHhId) continue; // exclude self
        householdIds.add(m.household_id);
        if (!roomsByHousehold[m.household_id]) roomsByHousehold[m.household_id] = new Set();
        roomsByHousehold[m.household_id].add(m.classroom_id);
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

      const hidden = await getHiddenParentIds();
      const seen = new Set();
      const people = [];
      for (const m of (members || [])) {
        if (seen.has(m.household_id)) continue;
        const p = m.parents;
        if (!p) continue;
        if (hidden.has(p.id)) continue; // blocked either direction — hide
        seen.add(m.household_id);
        const cls = classByHousehold[m.household_id];
        people.push({
          id: p.id,
          householdId: m.household_id,
          name: p.name,
          photo_url: p.photo_url,
          rooms: roomsByHousehold[m.household_id] ? [...roomsByHousehold[m.household_id]] : [],
          classLabel: cls ? `${gradeLabel(cls.grade)}${cls.teacher ? " · " + cls.teacher : ""}` : "",
        });
      }
      people.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setPickPeople(people);

      // Group people by MY classrooms (for the browse-by-room cards).
      const byRoom = {};
      for (const rid of myClassroomIds) byRoom[rid] = [];
      for (const person of people) {
        for (const rid of person.rooms) {
          if (byRoom[rid]) byRoom[rid].push(person);
        }
      }
      setPeopleByRoom(byRoom);
    } catch (e) {
      setPickPeople([]);
    }
    setPickLoading(false);
  };

  const toggleSelect = (p) => {
    setSelectedIds((prev) =>
      prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
    );
    // If this person isn't in the school list (found by email), remember them.
    if (!pickPeople.some((sp) => sp.id === p.id)) {
      setExtraSelected((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    }
  };

  // Add all classmates from a room to the selection (additive, deduped).
  // If ALL classmates in the room are already selected, remove them all instead.
  const toggleWholeClass = (roomId, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const roomPeople = peopleByRoom[roomId] || [];
    if (roomPeople.length === 0) return;
    const roomIds = roomPeople.map((p) => p.id);
    const allSelected = roomIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      // Remove all classmates from this room.
      setSelectedIds((prev) => prev.filter((id) => !roomIds.includes(id)));
    } else {
      // Add missing ones (dedupe).
      setSelectedIds((prev) => {
        const next = [...prev];
        for (const id of roomIds) if (!next.includes(id)) next.push(id);
        return next;
      });
    }
  };

  // Is the query a full, complete email address?
  const looksLikeEmail = (s) => /^\S+@\S+\.\S+$/.test((s || "").trim());

  // Exact email lookup (finds a specific person, even cross-school) via the edge fn.
  const runEmailLookup = async (email) => {
    setEmailSearching(true);
    setEmailMatch(null);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-user-by-email", {
        body: { email: email.trim().toLowerCase() },
      });
      if (!error && data && data.found && data.hasProfile && data.parent && data.parent.id !== session.user.id) {
        const hidden = await getHiddenParentIds();
        if (!hidden.has(data.parent.id)) {
          setEmailMatch({
            id: data.parent.id,
            name: data.parent.name,
            photo_url: data.parent.photo_url,
            classLabel: "Found by email",
          });
        }
      }
    } catch (e) {
      setEmailMatch(null);
    }
    setEmailSearching(false);
  };

  // Reusable selectable person row (used in room-drill-in, name search, email match).
  const personRow = (p) => {
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
  };

  const continueToForm = () => {
    // Include both school families (pickPeople) and any email-found people (extraSelected).
    const fromSchool = pickPeople.filter((p) => selectedIds.includes(p.id));
    const fromEmail = extraSelected.filter((p) => selectedIds.includes(p.id) && !fromSchool.some((s) => s.id === p.id));
    const chosen = [...fromSchool, ...fromEmail];
    if (chosen.length === 0) return;
    setLaunchRecipients(chosen.map((p) => ({ id: p.id, name: p.name, photo_url: p.photo_url })));
  };

  // Open the editor for a birthday I'm hosting (change date/venue/notes/guests).
  const openEdit = async (pd) => {
    try {
      const { data: invRows } = await supabase
        .from("playdate_invites")
        .select("invited_parent_id, household_id")
        .eq("playdate_id", pd.id)
        .neq("household_id", pd.organizer_household_id);
      const parentIds = [...new Set((invRows || []).map((r) => r.invited_parent_id).filter(Boolean))];
      let recipients = [];
      if (parentIds.length > 0) {
        const { data: parents } = await supabase
          .from("parents")
          .select("id, name, photo_url")
          .in("id", parentIds);
        recipients = parents || [];
      }
      setEditingRecipients(recipients);
      setEditingEvent(pd);
    } catch (err) {
      setMessage("Couldn't open editor.");
    }
  };

  // Cancel a hosted birthday: cancellation .ics to everyone + in-app notice + delete.
  const doCancelBirthday = async (pd) => {
    setBusy(true);
    try {
      try {
        await supabase.functions.invoke("cancel-playdate-invite", { body: { playdate_id: pd.id } });
      } catch (calErr) { /* best-effort */ }

      const { data: invRows } = await supabase
        .from("playdate_invites").select("household_id").eq("playdate_id", pd.id);
      const invitedHouseholdIds = [...new Set((invRows || []).map((i) => i.household_id))]
        .filter((id) => id && id !== pd.organizer_household_id);

      try {
        // Host label (both parents) for the message.
        const { data: hostMembers } = await supabase
          .from("household_members").select("parent_id").eq("household_id", pd.organizer_household_id);
        const hostIds = (hostMembers || []).map((m) => m.parent_id).filter(Boolean);
        let hostLabel = "A family";
        if (hostIds.length > 0) {
          const { data: hp } = await supabase.from("parents").select("name").in("id", hostIds);
          const names = (hp || []).map((p) => (p.name || "").trim().split(/\s+/)[0]).filter(Boolean);
          if (names.length === 1) hostLabel = names[0];
          else if (names.length >= 2) hostLabel = `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
        }
        if (invitedHouseholdIds.length > 0) {
          const { data: guestParents } = await supabase
            .from("household_members").select("parent_id").in("household_id", invitedHouseholdIds);
          const rows = (guestParents || []).map((m) => ({
            recipient_id: m.parent_id,
            actor_id: session.user.id,
            type: "birthday_cancelled",
            title: "Birthday party cancelled",
            body: `${hostLabel}'s birthday party has been cancelled and removed from your calendar.`,
          }));
          if (rows.length > 0) await supabase.from("notifications").insert(rows);
        }
      } catch (notifErr) { /* best-effort */ }

      await supabase.from("playdate_invites").delete().eq("playdate_id", pd.id);
      await supabase.from("playdates").delete().eq("id", pd.id);

      setMessage("Birthday party cancelled. Everyone's been notified.");
      if (typeof onChanged === "function") onChanged();
      await load();
      setTimeout(() => setMessage(""), 3500);
    } catch (err) {
      setMessage("Couldn't cancel, please try again.");
    }
    setBusy(false);
  };

  const cancelBirthday = (pd) => {
    setConfirm({
      title: "Cancel this birthday party?",
      body: "Everyone invited will be notified and it'll be removed from their calendars. This can't be undone.",
      confirmLabel: "Cancel party",
      cancelLabel: "Keep it",
      tone: "danger",
      onConfirm: () => { setConfirm(null); doCancelBirthday(pd); },
    });
  };

  // Report an issue from the help screen — reuses the existing bug_reports flow,
  // pre-tagged with the tab so we know where it came from.
  const submitHelpBug = async () => {
    if (!helpBugText.trim()) return;
    setHelpBugBusy(true);
    try {
      await supabase.from("bug_reports").insert({
        reporter_parent_id: session.user.id,
        description: helpBugText.trim(),
        screen: "Birthdays",
        user_agent: (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : null,
        status: "new",
      });
      setHelpBugText("");
      setHelpBugSent(true);
    } catch (e) {
      // best-effort; leave the text so they can retry
    }
    setHelpBugBusy(false);
  };

  // When editing a hosted birthday, open the editor.
  if (editingEvent) {
    return (
      <PlaydateRequest
        session={session}
        editEvent={editingEvent}
        recipients={editingRecipients}
        onBack={() => { setEditingEvent(null); setEditingRecipients([]); }}
        onSent={() => {
          setEditingEvent(null);
          setEditingRecipients([]);
          setMessage("Birthday updated! 🎂");
          if (typeof onChanged === "function") onChanged();
          load();
        }}
      />
    );
  }

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

  // ---- HELP: how Birthdays work (concise, scrollable) ----
  if (showHelp) {
    const hSection = (label, body) => (
      <div style={{ marginBottom: "1.25rem" }}>
        <p style={{ color: "#02C39A", fontSize: "0.72rem", letterSpacing: "0.06em", fontWeight: 600, margin: "0 0 0.35rem" }}>{label}</p>
        <p style={{ color: "#B8CCE0", fontSize: "0.9rem", lineHeight: 1.55, margin: 0 }}>{body}</p>
      </div>
    );
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
          <button onClick={() => { setShowHelp(false); setHelpBugSent(false); }} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>
            <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back
          </button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>How Birthdays work</h1>
          <div style={{ width: "60px" }} />
        </div>

        <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
          {hSection("THROWING A BIRTHDAY", "Tap Set up a birthday invite, choose the families to invite, then pick your date and place. Browse your classrooms, search by name, or enter a full email to invite someone at another school.")}
          {hSection("INVITES YOU RECEIVE", "Parties you're invited to show under Invited to. Tap Going or Can't make it — hosts see your reply right away.")}
          {hSection("BIRTHDAYS YOU'RE HOSTING", "Under You're hosting, you'll see your guest list and who's coming. You can edit the details or cancel — cancelling notifies everyone and clears it from their calendars.")}
          {hSection("BIRTHDAYS IN YOUR NETWORK", "When families you're connected with save a birthday, they appear under Upcoming in your network. Tap one to wish them a happy birthday, ask what their child would like, or set yourself a gift reminder.")}
          {hSection("CONNECTING AT A PARTY", "If you say yes to a party from a family you're not connected with yet, Huddle offers to connect you — so you can plan together afterward.")}
          {hSection("WHERE BIRTHDAYS COME FROM", "You'll only see birthdays that families choose to save. Add your own family's birthday in your profile so your network can celebrate with you.")}

          {/* Report an issue */}
          <div style={{ marginTop: "1.5rem", borderTop: "1px solid #2A4A6B", paddingTop: "1.5rem" }}>
            {helpBugSent ? (
              <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "12px", padding: "1rem 1.25rem" }}>
                <p style={{ color: "#02C39A", fontSize: "0.9rem", margin: 0 }}>Thanks — your report was sent. 🙏</p>
              </div>
            ) : (
              <>
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", letterSpacing: "0.05em", margin: "0 0 0.6rem", fontWeight: 600 }}>SOMETHING NOT WORKING?</p>
                <textarea
                  placeholder="Tell us what went wrong on the Birthdays screen."
                  value={helpBugText}
                  onChange={(e) => setHelpBugText(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: "0.7rem 0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.9rem", boxSizing: "border-box", marginBottom: "0.75rem", resize: "vertical", fontFamily: "inherit" }}
                />
                <button onClick={submitHelpBug} disabled={!helpBugText.trim() || helpBugBusy}
                  style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: helpBugText.trim() ? "#02C39A" : "#2A4A6B", color: "#0F2044", fontSize: "0.95rem", fontWeight: 700, cursor: helpBugText.trim() && !helpBugBusy ? "pointer" : "default" }}>
                  {helpBugBusy ? "Sending..." : "Report an issue"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const fmtInviteDate = (iso) => {
    try {
      return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px", animation: "huddleFadeInUp 340ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
      <TopBar
        title="Birthdays"
        notificationCount={notificationCount}
        onBellClick={onBellClick}
        onSearchClick={onSearchClick}
        onProfileClick={onProfileClick}
        onLogoClick={onGoHome}
        onTutorialClick={() => setShowHelp(true)}
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
                      🎂 {organizerLabel} {organizerLabel.includes("&") ? "are" : "is"} throwing a birthday party
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
                    <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                      <button onClick={() => openEdit(playdate)}
                        style={{ padding: "0.55rem 1rem", borderRadius: "10px", border: "1px solid #7C5CBF", background: "transparent", color: "#B8A4E0", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <Icon name="edit" size={16} color="#B8A4E0" />Edit birthday
                      </button>
                      <button onClick={() => cancelBirthday(playdate)}
                        style={{ padding: "0.55rem 1rem", borderRadius: "10px", border: "1px solid #7A3B3B", background: "transparent", color: "#E39A9A", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <Icon name="cancel" size={16} color="#E39A9A" />Cancel
                      </button>
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
                  <div key={`${b.householdId}-${i}`} onClick={() => setActiveBday(b)} style={{ display: "flex", alignItems: "center", gap: "12px", background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "0.85rem 1rem", marginBottom: "0.6rem", cursor: "pointer" }}>
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

      {/* Birthday action menu */}
      {activeBday && (
        <div onClick={() => setActiveBday(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(6,16,36,0.8)", zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "huddleFadeInUp 160ms ease both" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#162D50", borderTopLeftRadius: "20px", borderTopRightRadius: "20px", padding: "1.5rem", width: "100%", maxWidth: "600px", borderTop: "2px solid #7C5CBF", animation: "huddleSlideUp 260ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
            <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "2rem" }}>🎂</div>
              <p style={{ color: "#FFFFFF", fontSize: "1.05rem", fontWeight: "700", margin: "0.25rem 0 0" }}>
                {activeBday.label ? activeBday.label : `${activeBday.familyName}'s family`}
              </p>
              <p style={{ color: "#8AAEC8", fontSize: "0.82rem", margin: "2px 0 0" }}>
                {MONTHS[activeBday.month - 1]} {activeBday.day}
              </p>
            </div>

            <button disabled={busy || wishedIds[activeBday.id]} onClick={() => sendWish(activeBday)}
              style={{ width: "100%", padding: "0.9rem", borderRadius: "12px", border: "none", background: wishedIds[activeBday.id] ? "#28405F" : "#7C5CBF", color: "#FFFFFF", fontSize: "0.92rem", fontWeight: "600", cursor: wishedIds[activeBday.id] ? "default" : "pointer", marginBottom: "0.6rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <Icon name="celebration" size={18} color="#FFFFFF" />{wishedIds[activeBday.id] ? "Birthday wishes sent 🎉" : "Wish them a happy birthday"}
            </button>

            <button disabled={busy || askedIds[activeBday.id]} onClick={() => askGift(activeBday)}
              style={{ width: "100%", padding: "0.9rem", borderRadius: "12px", border: "1px solid #7C5CBF", background: "transparent", color: "#B8A4E0", fontSize: "0.92rem", fontWeight: "600", cursor: askedIds[activeBday.id] ? "default" : "pointer", marginBottom: "0.6rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <Icon name="card_giftcard" size={18} color="#B8A4E0" />{askedIds[activeBday.id] ? "Question sent 🎁" : "Ask what they'd like"}
            </button>

            <button disabled={busy} onClick={() => addGiftReminder(activeBday)}
              style={{ width: "100%", padding: "0.9rem", borderRadius: "12px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.92rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.6rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <Icon name="notifications" size={18} color="#8AAEC8" />Remind me to get a gift or card
            </button>

            <button onClick={() => setActiveBday(null)}
              style={{ width: "100%", padding: "0.8rem", borderRadius: "12px", border: "none", background: "transparent", color: "#607080", fontSize: "0.88rem", fontWeight: "600", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Connect-on-accept prompt */}
      {connectPrompt && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(6,16,36,0.8)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div style={{ background: "#162D50", border: "1px solid #7C5CBF", borderRadius: "16px", padding: "1.5rem", maxWidth: "360px", width: "100%", animation: "huddleScaleIn 200ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
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

      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />

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
            {selectedIds.length > 0 && (
              <button onClick={continueToForm}
                style={{ width: "100%", padding: "0.95rem", borderRadius: "12px", border: "none", background: "#7C5CBF", color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "700", cursor: "pointer", marginBottom: "1.25rem" }}>
                Continue with {selectedIds.length} {selectedIds.length === 1 ? "family" : "families"} →
              </button>
            )}

            <input
              type="text"
              value={pickFilter}
              onChange={(e) => {
                const v = e.target.value;
                setPickFilter(v);
                setEmailMatch(null);
                if (looksLikeEmail(v)) runEmailLookup(v);
              }}
              placeholder="Search by name, or enter a full email…"
              style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.95rem", marginBottom: "0.5rem", boxSizing: "border-box" }}
            />
            <p style={{ color: "#607080", fontSize: "0.75rem", margin: "0 0 1.25rem", lineHeight: "1.45", display: "flex", alignItems: "flex-start", gap: "6px" }}>
              <Icon name="lightbulb" size={14} color="#7C5CBF" style={{ marginTop: "1px", flexShrink: 0 }} />
              <span>Type a name to find families at your school. To invite someone at another school, enter their <strong style={{ color: "#8AAEC8" }}>full email address</strong>.</span>
            </p>

            {pickLoading ? (
              <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
            ) : pickFilter.trim() ? (
              // ---- SEARCH MODE ----
              looksLikeEmail(pickFilter) ? (
                // Full email → exact lookup (may be cross-school)
                emailSearching ? (
                  <p style={{ color: "#607080", textAlign: "center", padding: "2rem", fontSize: "0.85rem" }}>Looking up that email…</p>
                ) : emailMatch ? (
                  personRow(emailMatch)
                ) : (
                  <p style={{ color: "#607080", textAlign: "center", padding: "2rem", fontSize: "0.85rem", lineHeight: "1.5" }}>
                    No one on Huddle uses that exact email. Double-check the address, or invite by name.
                  </p>
                )
              ) : (
                // Partial text → live name filter over school families
                (() => {
                  const results = pickPeople.filter((p) => (p.name || "").toLowerCase().includes(pickFilter.trim().toLowerCase()));
                  if (results.length === 0) {
                    return <p style={{ color: "#607080", textAlign: "center", padding: "2rem", fontSize: "0.85rem" }}>No families match "{pickFilter}".</p>;
                  }
                  return results.map((p) => personRow(p));
                })()
              )
            ) : viewingRoom ? (
              // ---- DRILLED INTO A CLASSROOM ----
              <>
                <button onClick={() => setViewingRoom(null)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: "none", color: "#8AAEC8", fontSize: "0.85rem", cursor: "pointer", padding: "0 0 1rem" }}>
                  <Icon name="arrow_back" size={18} color="#8AAEC8" /> All classrooms
                </button>
                <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>
                  {gradeLabel(viewingRoom.grade)}{viewingRoom.teacher ? " · " + viewingRoom.teacher : ""}
                </p>
                <p style={{ color: "#607080", fontSize: "0.8rem", margin: "0 0 1.25rem" }}>Tap classmates to invite them.</p>
                {(peopleByRoom[viewingRoom.id] || []).length === 0 ? (
                  <p style={{ color: "#607080", textAlign: "center", padding: "2rem", fontSize: "0.85rem", lineHeight: "1.5" }}>
                    No other families from this classroom are on Huddle yet. As they join, they'll appear here.
                  </p>
                ) : (
                  (peopleByRoom[viewingRoom.id] || []).map((p) => personRow(p))
                )}
              </>
            ) : (
              // ---- CLASSROOM CARDS (default view) ----
              <>
                {myRooms.length > 0 && (
                  <>
                    <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.05em", margin: "0 0 0.75rem" }}>YOUR CLASSROOMS</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.5rem" }}>
                      {myRooms.map((room) => {
                        const roomPeople = peopleByRoom[room.id] || [];
                        const count = roomPeople.length;
                        const selInRoom = roomPeople.filter((p) => selectedIds.includes(p.id)).length;
                        const allSelected = count > 0 && selInRoom === count;
                        const hasAny = count > 0;
                        return (
                          <div key={room.id} onClick={() => setViewingRoom(room)}
                            style={{ background: "linear-gradient(135deg, #1E2F52 0%, #253A63 100%)", border: `1px solid ${allSelected ? "#7C5CBF" : "#2A4A6B"}`, borderRadius: "16px", padding: "1.1rem", cursor: "pointer", position: "relative", minHeight: "116px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                            <div style={{ width: "42px", height: "42px", borderRadius: "12px", background: "#7C5CBF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Icon name="school" size={24} color="#FFFFFF" />
                            </div>
                            <div>
                              <p style={{ color: "#FFFFFF", fontSize: "0.92rem", fontWeight: "600", margin: "0.6rem 0 2px" }}>{gradeLabel(room.grade)}</p>
                              {room.teacher && <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: 0 }}>{room.teacher}</p>}
                              <p style={{ color: "#607080", fontSize: "0.72rem", margin: "4px 0 0" }}>
                                {count} {count === 1 ? "family" : "families"}
                                {selInRoom > 0 && (
                                  <span style={{ color: "#B8A4E0", fontWeight: 600 }}> · {selInRoom}/{count} selected</span>
                                )}
                              </p>
                              {hasAny && (
                                <button
                                  onClick={(e) => toggleWholeClass(room.id, e)}
                                  style={{
                                    marginTop: "0.6rem",
                                    width: "100%",
                                    padding: "0.45rem 0.6rem",
                                    borderRadius: "8px",
                                    border: `1px solid ${allSelected ? "#7C5CBF" : "#2A4A6B"}`,
                                    background: allSelected ? "#2A1E3D" : "transparent",
                                    color: allSelected ? "#B8A4E0" : "#8AAEC8",
                                    fontSize: "0.76rem",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px",
                                  }}
                                >
                                  {allSelected ? (
                                    <>
                                      <Icon name="check_circle" size={14} color="#B8A4E0" />
                                      Whole class added
                                    </>
                                  ) : (
                                    <>+ Add whole class</>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <p style={{ color: "#607080", fontSize: "0.78rem", textAlign: "center", margin: 0, lineHeight: "1.5" }}>
                  Tap a classroom to invite specific families, or use “Add whole class” to invite everyone.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}