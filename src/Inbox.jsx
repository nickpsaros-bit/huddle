import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export default function Inbox({ session, onBack }) {
  const [connectionRequests, setConnectionRequests] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchRequests(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const fetchRequests = async () => {
    setLoading(true);

    const { data: conns } = await supabase
      .from("connections")
      .select("*, requester:parents!connections_requester_id_fkey(*)")
      .eq("recipient_id", session.user.id)
      .eq("status", "pending");
    setConnectionRequests(conns || []);

    const { data: myHh } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("parent_id", session.user.id)
      .maybeSingle();

    if (myHh) {
      const { data: joins } = await supabase
        .from("household_join_requests")
        .select("*, requester:parents!household_join_requests_requesting_parent_id_fkey(id, name, photo_url)")
        .eq("target_household_id", myHh.household_id)
        .eq("status", "pending");
      setJoinRequests(joins || []);
    } else {
      setJoinRequests([]);
    }

    setLoading(false);
  };

  const accept = async (connectionId) => {
    await supabase.from("connections")
      .update({ status: "accepted" })
      .eq("id", connectionId);
    setMessage("Connection accepted!");
    fetchRequests();
    setTimeout(() => setMessage(""), 3000);
  };

  const decline = async (connectionId) => {
    await supabase.from("connections")
      .delete()
      .eq("id", connectionId);
    setMessage("Request declined");
    fetchRequests();
    setTimeout(() => setMessage(""), 3000);
  };

  const approveJoin = async (req) => {
    setMessage("");
    try {
      const requesterId = req.requesting_parent_id;

      // 1. My (approver's) household — the destination.
      const { data: myHh, error: hhErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .single();
      if (hhErr) throw hhErr;
      const destHouseholdId = myHh.household_id;

      // 2. Requester's current household + their role there.
      const { data: theirMembership } = await supabase
        .from("household_members")
        .select("id, household_id, role")
        .eq("parent_id", requesterId)
        .maybeSingle();

      const oldHouseholdId = theirMembership?.household_id || null;

      // Guard: if they're somehow already in my household, just mark approved.
      if (oldHouseholdId === destHouseholdId) {
        await supabase.from("household_join_requests")
          .update({ status: "approved", resolved_at: new Date().toISOString() })
          .eq("id", req.id);
        setMessage(`${shortName(req.requester?.name)} is already in your household.`);
        fetchRequests();
        return;
      }

      // 3. Move the requester's old household's classroom memberships into mine
      //    (union — skip any my household already has).
      if (oldHouseholdId) {
        const { data: oldCms } = await supabase
          .from("classroom_members")
          .select("classroom_id, school_year")
          .eq("household_id", oldHouseholdId);

        const { data: myCms } = await supabase
          .from("classroom_members")
          .select("classroom_id")
          .eq("household_id", destHouseholdId);
        const haveClassroom = new Set((myCms || []).map((c) => c.classroom_id));

        for (const c of (oldCms || [])) {
          if (!haveClassroom.has(c.classroom_id)) {
            await supabase.from("classroom_members").insert({
              household_id: destHouseholdId,
              classroom_id: c.classroom_id,
              school_year: c.school_year,
            });
            haveClassroom.add(c.classroom_id);
          }
        }
      }

      // 4. Remove the requester from their old household.
      if (theirMembership) {
        await supabase.from("household_members").delete().eq("id", theirMembership.id);

        // 5. Clean up their old household: delete if empty, else promote if needed.
        const { data: remaining } = await supabase
          .from("household_members")
          .select("id, role, joined_at")
          .eq("household_id", oldHouseholdId)
          .order("joined_at", { ascending: true });

        if (!remaining || remaining.length === 0) {
          await supabase.from("classroom_members").delete().eq("household_id", oldHouseholdId);
          await supabase.from("households").delete().eq("id", oldHouseholdId);
        } else if (theirMembership.role === "primary" && !remaining.some((m) => m.role === "primary")) {
          await supabase.from("household_members")
            .update({ role: "primary" })
            .eq("id", remaining[0].id);
        }
      }

      // 6. Add the requester to my household as co-parent.
      const { error: memberErr } = await supabase
        .from("household_members")
        .insert({
          household_id: destHouseholdId,
          parent_id: requesterId,
          role: "co_parent",
        });
      if (memberErr && !memberErr.message.includes("duplicate")) throw memberErr;

      // 7. Mark the request approved.
      await supabase.from("household_join_requests")
        .update({ status: "approved", resolved_at: new Date().toISOString() })
        .eq("id", req.id);

      setMessage(`${shortName(req.requester?.name)} is now part of your household!`);
      fetchRequests();
      setTimeout(() => setMessage(""), 4000);
    } catch (err) {
      setMessage("Error: " + err.message);
    }
  };

  const declineJoin = async (req) => {
    await supabase
      .from("household_join_requests")
      .update({ status: "declined", resolved_at: new Date().toISOString() })
      .eq("id", req.id);
    setMessage("Link request declined");
    fetchRequests();
    setTimeout(() => setMessage(""), 3000);
  };

  const nothingPending = connectionRequests.length === 0 && joinRequests.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Notifications</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {message && (
          <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "10px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
            <p style={{ color: "#02C39A", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        )}

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : nothingPending ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🔔</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No new notifications</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>You're all caught up!</p>
          </div>
        ) : (
          <>
            {joinRequests.length > 0 && (
              <>
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>HOUSEHOLD LINK REQUESTS</p>
                {joinRequests.map((req) => (
                  <div key={req.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                        {req.requester?.photo_url ? (
                          <img src={req.requester.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          req.requester?.name?.charAt(0) || "?"
                        )}
                      </div>
                      <div>
                        <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(req.requester?.name)}</p>
                        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>wants to join your household</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => declineJoin(req)} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
                        Decline
                      </button>
                      <button onClick={() => approveJoin(req)} style={{ flex: 2, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer" }}>
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {connectionRequests.length > 0 && (
              <>
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: joinRequests.length > 0 ? "1.5rem 0 0.75rem" : "0 0 0.75rem", letterSpacing: "0.05em" }}>CONNECTION REQUESTS</p>
                {connectionRequests.map((req) => (
                  <div key={req.id} style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: "1px solid #2A4A6B" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "1rem" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                        {req.requester?.photo_url ? (
                          <img src={req.requester.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          req.requester?.name?.charAt(0) || "?"
                        )}
                      </div>
                      <div>
                        <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: "0 0 2px" }}>{shortName(req.requester?.name)}</p>
                        <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>wants to connect with you</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => decline(req.id)} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
                        Decline
                      </button>
                      <button onClick={() => accept(req.id)} style={{ flex: 2, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer" }}>
                        Accept
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}