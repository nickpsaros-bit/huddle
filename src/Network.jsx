import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import PlaydateRequest from "./PlaydateRequest";
import InviteFamily from "./InviteFamily";

export default function Network({ session }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [myName, setMyName] = useState("");

  useEffect(() => { fetchConnections(); }, []);

  // Privacy-safe short name: "Lee Parker" -> "Lee P."
  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
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

    const network = (data || []).map(conn => {
      const isRequester = conn.requester_id === userId;
      return {
        connectionId: conn.id,
        person: isRequester ? conn.recipient : conn.requester,
        connectedSince: conn.created_at,
      };
    });

    for (const conn of network) {
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", conn.person.id)
        .single();

      if (hm) {
        const { data: memberships } = await supabase
          .from("classroom_members")
          .select("*, classrooms(teacher_name, grade, schools(name))")
          .eq("household_id", hm.household_id);
        conn.classrooms = memberships || [];

        const { data: coParents } = await supabase
          .from("household_members")
          .select("parents(id, name, photo_url)")
          .eq("household_id", hm.household_id)
          .neq("parent_id", conn.person.id);
        conn.coParents = (coParents || []).map(c => c.parents).filter(Boolean);
      } else {
        conn.classrooms = [];
        conn.coParents = [];
      }
    }

    setConnections(network);
    setLoading(false);
  };

  const removeConnection = async (connectionId) => {
    if (!window.confirm("Remove this connection? You'll no longer be able to set up playdates with them unless you reconnect.")) return;
    await supabase.from("connections").delete().eq("id", connectionId);
    fetchConnections();
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

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Your Network</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "4px 0 0" }}>
          Parents you've connected with outside your classrooms
        </p>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {/* Invite a family */}
        <button onClick={() => setInviting(true)}
          style={{ width: "100%", padding: "0.85rem", borderRadius: "12px", border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", fontSize: "0.95rem", fontWeight: "600", cursor: "pointer", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          ➕ Invite a family to Huddle
        </button>

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : connections.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🤝</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No connections yet</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Use Search to find other parents at your school, or invite a family above. They'll show up here so you can set up playdates across classrooms.</p>
          </div>
        ) : (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>
              {connections.length} {connections.length === 1 ? "CONNECTION" : "CONNECTIONS"}
            </p>
            {connections.map((conn) => (
              <div key={conn.connectionId} style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "12px", border: "1px solid #2A4A6B" }}>

                {/* Primary person + Huddle button */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: conn.classrooms.length > 0 || conn.coParents.length > 0 ? "1rem" : 0 }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                    {conn.person?.photo_url ? (
                      <img src={conn.person.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      conn.person?.name?.charAt(0) || "?"
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(conn.person?.name)}</p>
                    <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>In your network</p>
                  </div>
                  <button onClick={() => setRequestingPlaydate(conn.person)}
                    style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
                    Huddle →
                  </button>
                </div>

                {/* Their classrooms (context) */}
                {conn.classrooms.length > 0 && (
                  <div style={{ background: "#0F2A45", borderRadius: "10px", padding: "0.75rem 1rem", border: "1px solid #2A4A6B", marginBottom: conn.coParents.length > 0 ? "0.5rem" : 0 }}>
                    <p style={{ color: "#8AAEC8", fontSize: "0.7rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>CLASSROOMS</p>
                    {conn.classrooms.map((c, idx) => (
                      <p key={idx} style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: idx > 0 ? "4px 0 0" : 0 }}>
                        🏫 {c.classrooms?.schools?.name} · {c.classrooms?.teacher_name} · {grades[c.classrooms?.grade] || "?"}
                      </p>
                    ))}
                  </div>
                )}

                {/* Co-parents (privacy-safe) */}
                {conn.coParents.length > 0 && (
                  <div style={{ background: "#0F2A45", borderRadius: "10px", padding: "0.75rem 1rem", border: "1px solid #2A4A6B" }}>
                    <p style={{ color: "#8AAEC8", fontSize: "0.7rem", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>CO-PARENTS</p>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      {conn.coParents.map((cp) => (
                        <div key={cp.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", overflow: "hidden", border: "2px solid #02C39A" }}>
                            {cp.photo_url ? (
                              <img src={cp.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : <span style={{ color: "#FFFFFF" }}>{cp.name?.charAt(0) || "?"}</span>}
                          </div>
                          <p style={{ color: "#FFFFFF", fontSize: "0.85rem", margin: 0 }}>{shortName(cp.name)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Remove */}
                <button onClick={() => removeConnection(conn.connectionId)}
                  style={{ marginTop: "0.75rem", background: "transparent", border: "none", color: "#607080", fontSize: "0.75rem", cursor: "pointer", padding: "2px 0" }}>
                  Remove connection
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {inviting && (
        <InviteFamily
          session={session}
          inviterName={myName}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}