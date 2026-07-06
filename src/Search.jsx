import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Button from "./Button";
import Icon from "./Icon";
import { getHiddenParentIds } from "./blocks";
import PersonMenu from "./PersonMenu";

export default function Search({ session, avatarUrl, onProfileClick, onBack }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [eventResults, setEventResults] = useState([]); // matching past events
  const [loading, setLoading] = useState(false);
  const [mySchoolIds, setMySchoolIds] = useState([]);
  const [myHouseholdId, setMyHouseholdId] = useState(null);
  const [connections, setConnections] = useState([]);
  const [message, setMessage] = useState("");
  const [emailResult, setEmailResult] = useState(null); // cross-school match by email
  const [emailSearched, setEmailSearched] = useState(false);
  const [myName, setMyName] = useState("");

  useEffect(() => {
    fetchMyData();
  }, []);

  // Privacy-safe short name: "Nick Psaros" -> "Nick P."
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  // Profile avatar button for the header (top-right). Taps through to ProfileScreen.
  const profileAvatar = () => (
    <button
      onClick={() => { if (typeof onProfileClick === "function") onProfileClick(); }}
      aria-label="Open your profile"
      style={{
        width: "38px", height: "38px", borderRadius: "50%", padding: 0,
        border: "2px solid #02C39A", background: "#028090", cursor: "pointer",
        overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center",
        justifyContent: "center", color: "#FFFFFF", fontSize: "1rem", fontWeight: "600",
      }}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        (myName && myName.charAt(0)) || "👤"
      )}
    </button>
  );

  const fetchMyData = async () => {
    const { data: me } = await supabase
      .from("parents")
      .select("name")
      .eq("id", session.user.id)
      .maybeSingle();
    setMyName(me?.name || "");

    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .single();

    if (!hm) return;
    setMyHouseholdId(hm.household_id);

    const { data: memberships } = await supabase
      .from("classroom_members")
      .select("classrooms(school_id)")
      .eq("household_id", hm.household_id);

    const schoolIds = [...new Set((memberships || []).map(m => m.classrooms?.school_id).filter(Boolean))];
    setMySchoolIds(schoolIds);

    const { data: conns } = await supabase
      .from("connections")
      .select("*")
      .or(`requester_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`);
    setConnections(conns || []);
  };

  const isEmail = (s) => s.includes("@") && s.includes(".") && !s.endsWith("@");

  // Search the user's PAST events (playdates + birthdays) by location, title,
  // notes, guest names, or date. Only events this household hosted or was invited to.
  const searchEvents = async (q) => {
    try {
      const term = q.trim().toLowerCase();
      const nowIso = new Date().toISOString();

      // My household.
      const { data: hm } = await supabase
        .from("household_members").select("household_id").eq("parent_id", session.user.id).maybeSingle();
      if (!hm) { setEventResults([]); return; }
      const hhId = hm.household_id;

      // Past events I hosted.
      const { data: hosted } = await supabase
        .from("playdates")
        .select("*")
        .eq("organizer_household_id", hhId)
        .lt("proposed_date", nowIso);

      // Past events I was invited to.
      const { data: myInvites } = await supabase
        .from("playdate_invites")
        .select("playdates(*)")
        .eq("household_id", hhId);
      const invitedPast = (myInvites || [])
        .map((i) => i.playdates)
        .filter((pd) => pd && new Date(pd.proposed_date) < new Date(nowIso));

      // Merge + de-dupe by id.
      const byId = {};
      for (const pd of [...(hosted || []), ...invitedPast]) { if (pd) byId[pd.id] = pd; }
      const events = Object.values(byId);
      if (events.length === 0) { setEventResults([]); return; }

      // Enrich each with guest names (for name-based matching + display).
      const enriched = [];
      for (const pd of events) {
        const { data: invRows } = await supabase
          .from("playdate_invites").select("household_id").eq("playdate_id", pd.id);
        const otherHhIds = [...new Set((invRows || []).map((r) => r.household_id).filter((id) => id && id !== hhId))];
        let guestNames = [];
        let guestPeople = []; // { name, photo_url }
        if (otherHhIds.length > 0) {
          const { data: gm } = await supabase
            .from("household_members").select("household_id, parents(name, photo_url)").in("household_id", otherHhIds);
          const seenH = new Set();
          for (const m of (gm || [])) {
            if (!m.parents?.name) continue;
            // one representative person per guest household for the avatar row
            if (!seenH.has(m.household_id)) {
              seenH.add(m.household_id);
              guestPeople.push({ name: m.parents.name, photo_url: m.parents.photo_url });
            }
            guestNames.push(m.parents.name);
          }
          guestNames = [...new Set(guestNames)];
        }
        // If I was a guest, also include the host's name + photo.
        if (pd.organizer_household_id !== hhId) {
          const { data: om } = await supabase
            .from("household_members").select("parents(name, photo_url)").eq("household_id", pd.organizer_household_id);
          for (const m of (om || [])) {
            if (m.parents?.name) {
              guestNames.push(m.parents.name);
              if (!guestPeople.some((p) => p.name === m.parents.name)) {
                guestPeople.push({ name: m.parents.name, photo_url: m.parents.photo_url });
              }
            }
          }
        }

        const dateStr = new Date(pd.proposed_date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        const haystack = [
          pd.location_name, pd.location_address, pd.title, pd.note,
          dateStr, ...guestNames,
        ].filter(Boolean).join(" ").toLowerCase();

        if (haystack.includes(term)) {
          enriched.push({ ...pd, guestNames, guestPeople, dateStr });
        }
      }
      enriched.sort((a, b) => new Date(b.proposed_date) - new Date(a.proposed_date));
      setEventResults(enriched);
    } catch (e) {
      setEventResults([]);
    }
  };

  const search = async (q) => {
    setQuery(q);
    setEmailResult(null);
    setEmailSearched(false);

    if (q.length < 2) {
      setResults([]);
      setEventResults([]);
      return;
    }

    if (isEmail(q.trim())) {
      setResults([]);
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("lookup-user-by-email", {
          body: { email: q.trim().toLowerCase() },
        });
        if (!error && data && data.found && data.hasProfile && data.parent) {
          if (data.parent.id !== session.user.id) {
            const hidden = await getHiddenParentIds();
            if (!hidden.has(data.parent.id)) {
              setEmailResult(data.parent);
            }
          }
        }
      } catch (e) {
        // Best-effort — no match shown on error.
      }
      setEmailSearched(true);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Search past events in parallel with the people search.
    searchEvents(q);

    const { data: parents } = await supabase
      .from("parents")
      .select("*")
      .ilike("name", "%" + q + "%")
      .neq("id", session.user.id)
      .limit(20);

    if (!parents || parents.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    const hidden = await getHiddenParentIds();

    const enriched = [];
    for (const parent of parents) {
      if (hidden.has(parent.id)) continue; // blocked either direction — hide
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", parent.id)
        .single();
      if (!hm) continue;

      const { data: memberships } = await supabase
        .from("classroom_members")
        .select("classrooms(teacher_name, grade, schools(id, name))")
        .eq("household_id", hm.household_id);

      const sharedClassrooms = (memberships || []).filter(m =>
        mySchoolIds.includes(m.classrooms?.schools?.id)
      );

      if (sharedClassrooms.length > 0) {
        enriched.push({
          ...parent,
          householdId: hm.household_id,
          classrooms: sharedClassrooms,
        });
      }
    }

    setResults(enriched);
    setLoading(false);
  };

  const getConnectionStatus = (parentId) => {
    const conn = connections.find(c =>
      (c.requester_id === session.user.id && c.recipient_id === parentId) ||
      (c.recipient_id === session.user.id && c.requester_id === parentId)
    );
    if (!conn) return null;
    return {
      status: conn.status,
      isRequester: conn.requester_id === session.user.id
    };
  };

  const sendRequest = async (recipientId) => {
    const { error } = await supabase.from("connections").insert({
      requester_id: session.user.id,
      recipient_id: recipientId,
      status: "pending"
    });
    if (!error) {
      setMessage("Connection request sent!");
      fetchMyData();
      setTimeout(() => setMessage(""), 3000);
    } else {
      setMessage("Couldn't send request: " + error.message);
      setTimeout(() => setMessage(""), 4000);
    }
  };

  const acceptRequest = async (requesterId) => {
    await supabase.from("connections")
      .update({ status: "accepted" })
      .eq("requester_id", requesterId)
      .eq("recipient_id", session.user.id);
    fetchMyData();
    setMessage("Connection accepted!");
    setTimeout(() => setMessage(""), 3000);
  };

  const grades = ["TK","K","1st","2nd","3rd","4th","5th"];

  const connectionControl = (parentId, sameHousehold) => {
    if (sameHousehold) {
      return <span style={{ color: "#8AAEC8", fontSize: "0.8rem", flexShrink: 0 }}>In your household</span>;
    }
    const conn = getConnectionStatus(parentId);
    if (!conn) {
      return (
        <Button variant="primary" size="sm" onClick={() => sendRequest(parentId)} style={{ flexShrink: 0 }}>
          Connect
        </Button>
      );
    }
    if (conn.status === "pending" && conn.isRequester) {
      return <span style={{ color: "#607080", fontSize: "0.8rem", flexShrink: 0 }}>Pending...</span>;
    }
    if (conn.status === "pending" && !conn.isRequester) {
      return (
        <Button variant="primary" size="sm" onClick={() => acceptRequest(parentId)} style={{ flexShrink: 0 }}>
          Accept
        </Button>
      );
    }
    if (conn.status === "accepted") {
      return <span style={{ color: "#02C39A", fontSize: "0.8rem", flexShrink: 0 }}><Icon name="check" size={16} color="#02C39A" style={{ verticalAlign: "-2px", marginRight: 2 }} />Connected</span>;
    }
    return null;
  };

  const avatar = (photo_url, name, size) => (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size === "48px" ? "1.2rem" : "1rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
      {photo_url ? (
        <img src={photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        name ? name.trim().charAt(0) : "?"
      )}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {typeof onBack === "function" && (
              <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}>
                <Icon name="arrow_back" size={22} color="#8AAEC8" />
              </button>
            )}
            <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Find Parents</h1>
          </div>
          {profileAvatar()}
        </div>
        <input
          type="text"
          placeholder="Search people, past events, or an email..."
          value={query}
          onChange={(e) => search(e.target.value)}
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            borderRadius: "10px",
            border: "1px solid #2A4A6B",
            background: "#0F2044",
            color: "#FFFFFF",
            fontSize: "1rem",
            boxSizing: "border-box"
          }}
        />
        <p style={{ color: "#607080", fontSize: "0.78rem", margin: "0.6rem 0 0", lineHeight: "1.4" }}>
          Search by name for parents at your school — or enter someone's exact email to connect with them at any school.
        </p>
      </div>

      <div style={{ padding: "1rem 1.5rem", maxWidth: "600px", margin: "0 auto"}}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {loading && (
          <p style={{ color: "#607080", fontSize: "0.9rem", textAlign: "center", padding: "2rem" }}>Searching...</p>
        )}

        {!loading && emailResult && (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.75rem", letterSpacing: "0.05em", margin: "0 0 0.75rem" }}>FOUND BY EMAIL</p>
            <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #02C39A", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {avatar(emailResult.photo_url, emailResult.name, "48px")}
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(emailResult.name)}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>On Huddle</p>
                </div>
              </div>
              {connectionControl(emailResult.id, myHouseholdId && emailResult.id === session.user.id)}
            </div>
          </>
        )}

        {!loading && emailSearched && !emailResult && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ margin: "0 0 1rem" }}><Icon name="mail" size={40} color="#3E5A7F" /></p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>No one found with that email</p>
            <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
              Double-check the spelling, or invite them to Huddle from the Home tab.
            </p>
          </div>
        )}

        {!loading && !emailSearched && query.length >= 2 && results.length === 0 && eventResults.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ margin: "0 0 1rem" }}><Icon name="search" size={40} color="#3E5A7F" /></p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>No matches found</p>
            <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
              Search for parents at your school by name, past events by place or who was there, or enter an exact email to connect across schools.
            </p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ margin: "0 0 1rem" }}><Icon name="waving_hand" size={40} color="#3E5A7F" /></p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>Find parents to connect with</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Type a name, or an email address</p>
          </div>
        )}

        {/* Your past events section */}
        {eventResults.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.06em", margin: "0 0 0.75rem" }}>YOUR PAST EVENTS</p>
            {eventResults.map((ev) => {
              const isBday = ev.event_type === "birthday";
              return (
                <div key={ev.id} style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "12px", padding: "1rem", marginBottom: "0.6rem" }}>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "600", margin: "0 0 4px" }}>
                    {isBday ? "🎂 " : "🧸 "}{ev.title || (isBday ? "Birthday party" : "Playdate")}
                  </p>
                  <p style={{ color: "#8AAEC8", fontSize: "0.82rem", margin: "0 0 2px" }}>{ev.dateStr}</p>
                  {ev.location_name && (
                    <p style={{ color: "#8AAEC8", fontSize: "0.82rem", margin: "0 0 2px" }}>
                      <Icon name="location_on" size={15} style={{ verticalAlign: "-3px", marginRight: 2 }} />{ev.location_name}{ev.location_address ? ` — ${ev.location_address}` : ""}
                    </p>
                  )}
                  {ev.guestPeople && ev.guestPeople.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {ev.guestPeople.slice(0, 5).map((g, gi) => (
                          <div key={gi} title={g.name} style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#028090", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontWeight: "600", fontSize: "0.72rem", border: "2px solid #162D50", marginLeft: gi === 0 ? 0 : "-8px", flexShrink: 0 }}>
                            {g.photo_url ? <img src={g.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (g.name?.charAt(0) || "?")}
                          </div>
                        ))}
                      </div>
                      <span style={{ color: "#607080", fontSize: "0.78rem" }}>
                        {ev.guestNames.slice(0, 3).map((n) => n.split(/\s+/)[0]).join(", ")}{ev.guestNames.length > 3 ? ` +${ev.guestNames.length - 3}` : ""}
                      </span>
                    </div>
                  )}
                  {ev.note && (
                    <p style={{ color: "#607080", fontSize: "0.78rem", margin: "4px 0 0", fontStyle: "italic" }}>"{ev.note}"</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {results.length > 0 && (
          <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.06em", margin: "0 0 0.75rem" }}>PEOPLE</p>
        )}
        {results.map((parent) => {
          const sameHousehold = myHouseholdId && parent.householdId === myHouseholdId;
          const classroomLabel = (parent.classrooms || []).map(c =>
            `${c.classrooms?.teacher_name} (${grades[c.classrooms?.grade] || "?"})`
          ).join(", ");

          return (
            <div key={parent.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {avatar(parent.photo_url, parent.name, "48px")}
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(parent.name)}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>{classroomLabel || "Same school"}</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                {connectionControl(parent.id, sameHousehold)}
                {!sameHousehold && (
                  <PersonMenu session={session} targetId={parent.id} targetName={parent.name} onDone={() => search(query)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}