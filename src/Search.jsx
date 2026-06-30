import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Search({ session, avatarUrl, onProfileClick }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
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

  const search = async (q) => {
    setQuery(q);
    setEmailResult(null);
    setEmailSearched(false);

    if (q.length < 2) {
      setResults([]);
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
            setEmailResult(data.parent);
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

  const grades = ["K","1st","2nd","3rd","4th","5th","6th"];

  const connectionControl = (parentId, sameHousehold) => {
    if (sameHousehold) {
      return <span style={{ color: "#8AAEC8", fontSize: "0.8rem", flexShrink: 0 }}>In your household</span>;
    }
    const conn = getConnectionStatus(parentId);
    if (!conn) {
      return (
        <button
          onClick={() => sendRequest(parentId)}
          style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
          Connect
        </button>
      );
    }
    if (conn.status === "pending" && conn.isRequester) {
      return <span style={{ color: "#607080", fontSize: "0.8rem", flexShrink: 0 }}>Pending...</span>;
    }
    if (conn.status === "pending" && !conn.isRequester) {
      return (
        <button
          onClick={() => acceptRequest(parentId)}
          style={{ background: "#02C39A", border: "none", color: "#0F2044", padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.85rem", fontWeight: "600", cursor: "pointer", flexShrink: 0 }}>
          Accept
        </button>
      );
    }
    if (conn.status === "accepted") {
      return <span style={{ color: "#02C39A", fontSize: "0.8rem", flexShrink: 0 }}>✓ Connected</span>;
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
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Find Parents</h1>
          {profileAvatar()}
        </div>
        <input
          type="text"
          placeholder="Search by name, or enter an email..."
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
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>📭</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>No one found with that email</p>
            <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
              Double-check the spelling, or invite them to Huddle from the Home tab.
            </p>
          </div>
        )}

        {!loading && !emailSearched && query.length >= 2 && results.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>🔍</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>No parents found</p>
            <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
              Only parents at your school show up by name. To connect with someone at another school, enter their exact email.
            </p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 1rem" }}>👋</p>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", margin: "0 0 0.5rem" }}>Find parents to connect with</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Type a name, or an email address</p>
          </div>
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
              {connectionControl(parent.id, sameHousehold)}
            </div>
          );
        })}
      </div>
    </div>
  );
}