import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Search({ session }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mySchoolIds, setMySchoolIds] = useState([]);
  const [myHouseholdId, setMyHouseholdId] = useState(null);
  const [connections, setConnections] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchMyData();
  }, []);

  const fetchMyData = async () => {
    // Get my household
    const { data: hm } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .single();

    if (!hm) return;
    setMyHouseholdId(hm.household_id);

    // Get my classroom memberships to find my school IDs
    const { data: memberships } = await supabase
      .from("classroom_members")
      .select("classrooms(school_id)")
      .eq("household_id", hm.household_id);

    const schoolIds = [...new Set((memberships || []).map(m => m.classrooms?.school_id).filter(Boolean))];
    setMySchoolIds(schoolIds);

    // Get my connections
    const { data: conns } = await supabase
      .from("connections")
      .select("*")
      .or(`requester_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`);
    setConnections(conns || []);
  };

  const search = async (q) => {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);

    // Find parents whose name matches
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

    // For each parent, find their household and check if they share a school with me
    const enriched = [];
    for (const parent of parents) {
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

  const grades = ["K","1st","2nd","3rd","4th","5th","6th"];

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: "0 0 1rem" }}>Find Parents</h1>
        <input
          type="text"
          placeholder="Search by parent name..."
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
      </div>

      <div style={{ padding: "1rem 1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {loading && (
          <p style={{ color: "#607080", fontSize: "0.9rem", textAlign: "center", padding: "2rem" }}>Searching...</p>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>🔍</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>No parents found</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Try searching by a different name</p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>👋</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>Find parents at your school</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Type a name to search</p>
          </div>
        )}

        {results.map((parent) => {
          const conn = getConnectionStatus(parent.id);
          const classroomLabel = (parent.classrooms || []).map(c =>
            `${c.classrooms?.teacher_name} (${grades[c.classrooms?.grade] || "?"})`
          ).join(", ");

          return (
            <div key={parent.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                  {parent.photo_url ? (
                    <img src={parent.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    parent.name ? parent.name.charAt(0) : "?"
                  )}
                </div>
                <div>
                  <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{parent.name}</p>
                  <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>{classroomLabel || "Same school"}</p>
                </div>
              </div>

              {!conn && (
                <button
                  onClick={() => sendRequest(parent.id)}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
                  Connect
                </button>
              )}
              {conn && conn.status === "pending" && conn.isRequester && (
                <span style={{ color: "#607080", fontSize: "0.8rem", flexShrink: 0 }}>Pending...</span>
              )}
              {conn && conn.status === "pending" && !conn.isRequester && (
                <button
                  onClick={() => acceptRequest(parent.id)}
                  style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
                  Accept
                </button>
              )}
              {conn && conn.status === "accepted" && (
                <span style={{ color: "#02C39A", fontSize: "0.8rem", flexShrink: 0 }}>✓ Connected</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}