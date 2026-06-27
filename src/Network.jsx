import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import PlaydateRequest from "./PlaydateRequest";
import InviteFamily from "./InviteFamily";
import ConfirmModal from "./ConfirmModal";

export default function Network({ session }) {
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [myName, setMyName] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [petsByHousehold, setPetsByHousehold] = useState({});

  useEffect(() => { fetchConnections(); }, []);

  // Privacy-safe short name: "Lee Parker" -> "Lee P."
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  // Small inline pet badges for a household (🐕🐈🐴🐾). Returns null if none set.
  const petBadges = (hhId) => {
    const p = petsByHousehold[hhId];
    if (!p) return null;
    const icons = [];
    if (p.has_dog) icons.push("🐕");
    if (p.has_cat) icons.push("🐈");
    if (p.has_horse) icons.push("🐴");
    if (p.has_other) icons.push("🐾");
    if (icons.length === 0) return null;
    return (
      <span style={{ fontSize: "0.85rem", marginLeft: "6px", whiteSpace: "nowrap" }} title={p.has_other && p.other_label ? p.other_label : undefined}>
        {icons.join(" ")}
      </span>
    );
  };

  const fetchConnections = async () => {
    setLoading(true);
    const userId = session.user.id;

    const { data: me } = await supabase
      .from("parents")
      .select("name")
      .eq("id", userId)
      .single();
    setMyName(me?.name || "");

    const { data } = await supabase
      .from("connections")
      .select(`
        *,
        requester:parents!connections_requester_id_fkey(*),
        recipient:parents!connections_recipient_id_fkey(*)
      `)
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
      .eq("status", "accepted");

    // Each connection row → the OTHER person + the connection id (for per-parent removal).
    const connectedPeople = (data || []).map((conn) => {
      const isRequester = conn.requester_id === userId;
      return {
        connectionId: conn.id,
        person: isRequester ? conn.recipient : conn.requester,
        connectedSince: conn.created_at,
      };
    });

    // Resolve each connected person's household, then GROUP BY household so two
    // co-parents you're both connected to collapse into ONE card.
    // householdsMap: { [householdId]: { householdId, classrooms, members: [...] } }
    // members carry: { id, name, photo_url, connectionId|null }
    //   connectionId set => you're connected to this parent (gets Huddle + Remove)
    //   connectionId null => co-parent you're NOT connected to (shown for context)
    const householdsMap = {};
    const loosePeople = []; // connected people with no household row (edge case)

    for (const c of connectedPeople) {
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", c.person.id)
        .maybeSingle();

      if (!hm) {
        loosePeople.push(c);
        continue;
      }

      const hhId = hm.household_id;
      if (!householdsMap[hhId]) {
        householdsMap[hhId] = { householdId: hhId, classrooms: [], members: [], _seen: new Set() };
      }
      // Mark this specific parent as connected (carry their connectionId).
      householdsMap[hhId]._connectedById = householdsMap[hhId]._connectedById || {};
      householdsMap[hhId]._connectedById[c.person.id] = {
        connectionId: c.connectionId,
        person: c.person,
      };
    }

    // For each household: load classrooms once + the FULL member list (so we can
    // show both co-parents, flagging which ones you're connected to).
    const householdIds = Object.keys(householdsMap);
    for (const hhId of householdIds) {
      const { data: memberships } = await supabase
        .from("classroom_members")
        .select("*, classrooms(teacher_name, grade, schools(name))")
        .eq("household_id", hhId);
      householdsMap[hhId].classrooms = memberships || [];

      const { data: allMembers } = await supabase
        .from("household_members")
        .select("parents(id, name, photo_url)")
        .eq("household_id", hhId);

      const connectedById = householdsMap[hhId]._connectedById || {};
      const members = [];
      for (const row of (allMembers || [])) {
        const p = row.parents;
        if (!p || !p.id) continue;
        if (p.id === userId) continue; // never list myself
        const link = connectedById[p.id];
        members.push({
          id: p.id,
          name: p.name,
          photo_url: p.photo_url,
          connectionId: link ? link.connectionId : null, // null = not connected to me
        });
      }
      // Connected parents first, then the rest; stable-ish by name.
      members.sort((a, b) => {
        if (!!a.connectionId !== !!b.connectionId) return a.connectionId ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
      });
      householdsMap[hhId].members = members;
    }

    const grouped = Object.values(householdsMap)
      .map(({ _seen, _connectedById, ...rest }) => rest)
      .filter((h) => h.members.length > 0);

    // Batch-fetch pet preferences for all connected households (one query).
    if (householdIds.length > 0) {
      const { data: prefs } = await supabase
        .from("household_preferences")
        .select("household_id, has_dog, has_cat, has_horse, has_other, other_label")
        .in("household_id", householdIds);
      const map = {};
      for (const row of (prefs || [])) map[row.household_id] = row;
      setPetsByHousehold(map);
    }

    // Append loose connected people (no household) as single-member pseudo-cards.
    for (const c of loosePeople) {
      grouped.push({
        householdId: `loose-${c.person.id}`,
        classrooms: [],
        members: [{
          id: c.person.id,
          name: c.person?.name,
          photo_url: c.person?.photo_url,
          connectionId: c.connectionId,
        }],
      });
    }

    setHouseholds(grouped);
    setLoading(false);
  };

  // The actual removal work (runs after the user confirms in the modal).
  const doRemoveConnection = async (connectionId) => {
    await supabase.from("connections").delete().eq("id", connectionId);
    fetchConnections();
  };

  // Opens the in-app confirm modal (replaces window.confirm, which fails on mobile).
  const removeConnection = (connectionId, personName) => {
    setConfirm({
      title: "Remove this connection?",
      body: `You'll no longer be able to set up playdates with ${shortName(personName)} unless you reconnect.`,
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      tone: "danger",
      onConfirm: () => doRemoveConnection(connectionId),
    });
  };

  const grades = ["K","1st","2nd","3rd","4th","5th","6th"];

  // If huddling, render the playdate request screen (self-contained, like Home does).
  if (requestingPlaydate) {
    return (
      <PlaydateRequest
        session={session}
        recipient={requestingPlaydate}
        onBack={() => setRequestingPlaydate(null)}
        onSent={() => setRequestingPlaydate(null)}
      />
    );
  }

  const connectedCount = households.reduce(
    (n, h) => n + h.members.filter((m) => m.connectionId).length,
    0
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Your Network</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "4px 0 0" }}>
          Parents you've connected with outside your classrooms
        </p>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : households.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🤝</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No connections yet</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Use Search to find other parents at your school, or invite a parent below. They'll show up here so you can set up playdates across classrooms.</p>
          </div>
        ) : (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>
              {connectedCount} {connectedCount === 1 ? "CONNECTION" : "CONNECTIONS"}
            </p>
            {households.map((hh) => (
              <div key={hh.householdId} style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "12px", border: "1px solid #2A4A6B" }}>

                {/* Household classrooms (shown once, shared by everyone in the household) */}
                {hh.classrooms.length > 0 && (
                  <div style={{ background: "#0F2A45", borderRadius: "10px", padding: "0.75rem 1rem", border: "1px solid #2A4A6B", marginBottom: "1rem" }}>
                    <p style={{ color: "#8AAEC8", fontSize: "0.7rem", margin: "0 0 0.5rem", letterSpacing: "0.05em", display: "flex", alignItems: "center" }}>
                      CLASSROOMS{petBadges(hh.householdId)}
                    </p>
                    {hh.classrooms.map((c, idx) => (
                      <p key={idx} style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: idx > 0 ? "4px 0 0" : 0 }}>
                        🏫 {c.classrooms?.schools?.name} · {c.classrooms?.teacher_name} · {grades[c.classrooms?.grade] || "?"}
                      </p>
                    ))}
                  </div>
                )}

                {/* Each parent in the household — connected ones get a Huddle button */}
                {hh.members.map((m, idx) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", paddingTop: idx > 0 ? "0.85rem" : 0, marginTop: idx > 0 ? "0.85rem" : 0, borderTop: idx > 0 ? "1px solid #2A4A6B" : "none" }}>
                    <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                      {m.photo_url ? (
                        <img src={m.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        m.name?.charAt(0) || "?"
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>
                        {shortName(m.name)}
                      </p>
                      <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>
                        {m.connectionId ? "In your network" : "Co-parent"}
                      </p>
                    </div>
                    {m.connectionId && (
                      <button onClick={() => setRequestingPlaydate({ id: m.id, name: m.name, photo_url: m.photo_url })}
                        style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
                        Huddle →
                      </button>
                    )}
                  </div>
                ))}

                {/* Per-parent remove (each connection is its own row) */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.85rem" }}>
                  {hh.members.filter((m) => m.connectionId).map((m) => (
                    <button key={m.id} onClick={() => removeConnection(m.connectionId, m.name)}
                      style={{ background: "transparent", border: "none", color: "#607080", fontSize: "0.75rem", cursor: "pointer", padding: "2px 0" }}>
                      Remove {shortName(m.name)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Invite — placed below the list (actions follow content) */}
        {!loading && (
          <button onClick={() => setInviting(true)}
            style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer", marginTop: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            ➕ Invite a parent to Huddle
          </button>
        )}
      </div>

      {inviting && (
        <InviteFamily
          session={session}
          inviterName={myName}
          onClose={() => setInviting(false)}
        />
      )}

      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}