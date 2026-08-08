import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Button from "./Button";
import Icon from "./Icon";
import { getHiddenParentIds } from "./blocks";

export default function Inbox({ session, onBack, onPlanPlaydate }) {
  const [connectionRequests, setConnectionRequests] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadOnOpen, setUnreadOnOpen] = useState([]); // ids unread when inbox opened
  const [keptUnread, setKeptUnread] = useState([]);      // ids user chose to keep unread
  const [repliedGift, setRepliedGift] = useState({}); // notifId -> chosen category (local)
  const [actorMap, setActorMap] = useState({});        // actor_id -> {name, photo_url}
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchAll(); }, []);

  const shortName = (fullName) => {
    if (!fullName) return "A parent";
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  const fmtWhen = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const fetchAll = async () => {
    setLoading(true);

    const hiddenReqs = await getHiddenParentIds();

    const { data: conns } = await supabase
      .from("connections")
      .select("*, requester:parents!connections_requester_id_fkey(*)")
      .eq("recipient_id", session.user.id)
      .eq("status", "pending");
    setConnectionRequests((conns || []).filter((c) => c.requester?.id && !hiddenReqs.has(c.requester.id)));

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
      setJoinRequests((joins || []).filter((j) => j.requester?.id && !hiddenReqs.has(j.requester.id)));
    } else {
      setJoinRequests([]);
    }

    const { data: rawNotifs } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", session.user.id)
      .order("created_at", { ascending: false });

    // Suppress notifications from blocked people (either direction).
    const hidden = await getHiddenParentIds();
    const notifs = (rawNotifs || []).filter((n) => !n.actor_id || !hidden.has(n.actor_id));

    // Look up sender (actor) photos so notifications can show who they're from.
    const actorIds = [...new Set((notifs || []).map((n) => n.actor_id).filter(Boolean))];
    if (actorIds.length > 0) {
      const { data: actors } = await supabase
        .from("parents")
        .select("id, name, photo_url")
        .in("id", actorIds);
      const map = {};
      for (const a of (actors || [])) map[a.id] = a;
      setActorMap(map);
    }
    setNotifications(notifs || []);

    setLoading(false);

    // Remember which notifications were unread when the user opened the inbox.
    // They STAY highlighted while reading; we only mark them read when the user
    // leaves (see handleBack) — unless they explicitly keep one unread.
    const unreadIds = (notifs || []).filter((n) => !n.read).map((n) => n.id);
    setUnreadOnOpen(unreadIds);
  };

  // Notifications the user explicitly chose to KEEP unread — excluded from the
  // mark-read-on-leave sweep.
  const keepUnread = (notifId) => {
    setKeptUnread((prev) => (prev.includes(notifId) ? prev : [...prev, notifId]));
    setMessage("Kept as unread.");
    setTimeout(() => setMessage(""), 2000);
  };

  // Flip an already-read notification back to unread (persists immediately).
  const reMarkUnread = async (notifId) => {
    try {
      await supabase.from("notifications").update({ read: false }).eq("id", notifId);
      setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, read: false } : n));
      // Treat it as unread-on-open and keep it that way so the leave-sweep won't re-read it.
      setUnreadOnOpen((prev) => (prev.includes(notifId) ? prev : [...prev, notifId]));
      setKeptUnread((prev) => (prev.includes(notifId) ? prev : [...prev, notifId]));
      setMessage("Marked as unread.");
      setTimeout(() => setMessage(""), 2000);
    } catch (e) {
      setMessage("Couldn't update, please try again.");
      setTimeout(() => setMessage(""), 2500);
    }
  };

  // On leaving the inbox: mark everything that was unread-on-open as read,
  // except any the user chose to keep unread.
  const handleBack = async () => {
    const toMark = unreadOnOpen.filter((id) => !keptUnread.includes(id));
    if (toMark.length > 0) {
      try {
        await supabase.from("notifications").update({ read: true }).in("id", toMark);
      } catch (e) { /* best-effort */ }
    }
    if (typeof onBack === "function") onBack();
  };

  // Act on a playdate ping: mark it read, then open the playdate planner
  // pre-filled with the pinger as the recipient (funnel into the existing flow).
  const planFromPing = async (n) => {
    const actor = n.actor_id ? actorMap[n.actor_id] : null;
    if (!n.actor_id || !actor) {
      setMessage("Couldn't find that person — they may have left Huddle.");
      setTimeout(() => setMessage(""), 3000);
      return;
    }
    // Mark this ping read so it doesn't keep nagging.
    try { await supabase.from("notifications").update({ read: true }).eq("id", n.id); } catch (e) { /* best-effort */ }
    // Mark the tracked ping row as responded (so the sender sees it moved).
    try {
      await supabase.from("playdate_pings")
        .update({ status: "responded" })
        .eq("sender_id", n.actor_id)
        .eq("recipient_id", session.user.id)
        .eq("status", "pending");
    } catch (e) { /* best-effort */ }
    if (typeof onPlanPlaydate === "function") {
      onPlanPlaydate({ id: n.actor_id, name: actor.name, photo_url: actor.photo_url });
    }
  };

  // Reply to a gift question with a category — routes back to the asker (actor_id).
  const replyGift = async (n, category) => {
    if (!n.actor_id) return;
    try {
      const { data: me } = await supabase
        .from("parents").select("name").eq("id", session.user.id).maybeSingle();
      const myFirst = (me?.name || "A family").trim().split(/\s+/)[0];
      const body = category === "Please don't — just come"
        ? `${myFirst}'s family says: no gifts needed — just come celebrate! 🎉`
        : `${myFirst}'s family suggests: ${category}`;
      await supabase.from("notifications").insert({
        recipient_id: n.actor_id,
        type: "gift_reply",
        actor_id: session.user.id,
        title: "Gift idea 🎁",
        body,
      });
      setRepliedGift((prev) => ({ ...prev, [n.id]: category }));
      setMessage("Your suggestion was sent! 🎁");
      setTimeout(() => setMessage(""), 3000);
    } catch (e) {
      setMessage("Couldn't send, please try again.");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const accept = async (connectionId) => {
    await supabase.from("connections").update({ status: "accepted" }).eq("id", connectionId);

    // Notify the requester that I accepted (non-blocking).
    try {
      const { data: conn } = await supabase
        .from("connections")
        .select("requester_id")
        .eq("id", connectionId)
        .single();

      // My display name (the accepter).
      const { data: me } = await supabase
        .from("parents")
        .select("name")
        .eq("id", session.user.id)
        .single();
      const myLabel = shortName(me?.name);

      if (conn?.requester_id) {
        await supabase.from("notifications").insert({
          recipient_id: conn.requester_id,
          actor_id: session.user.id,
          type: "connection_accepted",
          title: "Connection accepted 🤝",
          body: `${myLabel} accepted your connection. You can now set up playdates together.`,
        });
      }
    } catch (notifErr) {
      // Best-effort.
    }

    setMessage("Connection accepted!");
    fetchAll();
    setTimeout(() => setMessage(""), 3000);
  };

  const decline = async (connectionId) => {
    await supabase.from("connections").delete().eq("id", connectionId);
    setMessage("Request declined");
    fetchAll();
    setTimeout(() => setMessage(""), 3000);
  };

  const approveJoin = async (req) => {
    setMessage("");
    try {
      // Atomic server-side merge: moves the requester into my household,
      // carries their classrooms, cleans up their old household, marks the
      // request approved — all in one SECURITY DEFINER transaction. Replaces
      // the old client-side cross-household writes (which RLS correctly blocks).
      const { error } = await supabase.rpc("approve_household_join", {
        p_request_id: req.id,
      });
      if (error) throw error;

      // Notify the requester they were added (non-blocking).
      try {
        const { data: me } = await supabase
          .from("parents")
          .select("name")
          .eq("id", session.user.id)
          .single();
        const myLabel = shortName(me?.name);
        await supabase.from("notifications").insert({
          recipient_id: req.requesting_parent_id,
          actor_id: session.user.id,
          type: "household_joined",
          title: "You joined a household 🏡",
          body: `${myLabel} added you to their household. Your classrooms are now shared.`,
        });
      } catch (notifErr) {
        // Best-effort.
      }

      setMessage(`${shortName(req.requester?.name)} is now part of your household!`);
      fetchAll();
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
    fetchAll();
    setTimeout(() => setMessage(""), 3000);
  };

  const nothing = connectionRequests.length === 0 && joinRequests.length === 0 && notifications.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>

      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={handleBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}><Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back</button>
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
        ) : nothing ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ margin: "0 0 1rem" }}><Icon name="notifications" size={44} color="#3E5A7F" /></p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No new notifications</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>You're all caught up!</p>
          </div>
        ) : (
          <>
            {/* Actionable requests first */}
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
                      <Button variant="secondary" onClick={() => declineJoin(req)} style={{ flex: 1 }}>
                        Decline
                      </Button>
                      <Button variant="primary" onClick={() => approveJoin(req)} style={{ flex: 2 }}>
                        Approve
                      </Button>
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
                      <Button variant="secondary" onClick={() => decline(req.id)} style={{ flex: 1 }}>
                        Decline
                      </Button>
                      <Button variant="primary" onClick={() => accept(req.id)} style={{ flex: 2 }}>
                        Accept
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Informational notifications */}
            {notifications.length > 0 && (
              <>
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: (joinRequests.length + connectionRequests.length) > 0 ? "1.5rem 0 0.75rem" : "0 0 0.75rem", letterSpacing: "0.05em" }}>NOTIFICATIONS</p>
                {notifications.map((n) => {
                  // An item looks "new" (highlighted) if it's unread this session:
                  // it was unread on open, is still marked unread, or the user
                  // explicitly kept/re-marked it unread. The leave-sweep (handleBack)
                  // marks unreadOnOpen items read EXCEPT those in keptUnread.
                  const showNew = unreadOnOpen.includes(n.id) || !n.read || keptUnread.includes(n.id);
                  const kept = keptUnread.includes(n.id);
                  const actor = n.actor_id ? actorMap[n.actor_id] : null;
                  return (
                  <div key={n.id} style={{ background: showNew ? "#162D50" : "#13233F", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "10px", border: showNew ? "1px solid #02C39A" : "1px solid #2A4A6B" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flex: 1 }}>
                        {actor && (
                          <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#028090", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontWeight: "600", fontSize: "0.9rem" }}>
                            {actor.photo_url ? <img src={actor.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (actor.name?.charAt(0) || "?")}
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            {showNew && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#02C39A", flexShrink: 0 }} />}
                            <p style={{ color: "#FFFFFF", fontSize: "0.95rem", fontWeight: "500", margin: 0 }}>{n.title}</p>
                          </div>
                        {n.body && <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "0 0 6px", lineHeight: "1.5" }}>{n.body}</p>}
                        <p style={{ color: "#607080", fontSize: "0.7rem", margin: 0 }}>{fmtWhen(n.created_at)}</p>

                        {n.type === "playdate_ping" && (
                          <div style={{ marginTop: "0.75rem" }}>
                            <Button variant="primary" size="sm" onClick={() => planFromPing(n)}>
                              Let's plan it →
                            </Button>
                          </div>
                        )}

                        {n.type === "gift_ask" && (
                          repliedGift[n.id] ? (
                            <p style={{ color: "#02C39A", fontSize: "0.82rem", fontWeight: "600", margin: "0.6rem 0 0" }}>
                              You suggested: {repliedGift[n.id]} 🎁
                            </p>
                          ) : (
                            <div style={{ marginTop: "0.75rem" }}>
                              <p style={{ color: "#607080", fontSize: "0.72rem", fontWeight: "600", margin: "0 0 6px" }}>Tap to suggest a gift idea:</p>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {["Toys", "Books", "Clothes", "Gift card", "Anything they'd love", "Please don't — just come"].map((cat) => (
                                  <button key={cat} onClick={() => replyGift(n, cat)}
                                    style={{ padding: "0.45rem 0.8rem", borderRadius: "999px", border: "1px solid #7C5CBF", background: "transparent", color: "#B8A4E0", fontSize: "0.8rem", fontWeight: "600", cursor: "pointer" }}>
                                    {cat}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )
                        )}
                        </div>
                      </div>
                    </div>
                    {/* Unread control. */}
                    {!showNew && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <Button variant="secondary" size="sm" onClick={() => reMarkUnread(n.id)}>
                          Mark unread
                        </Button>
                      </div>
                    )}
                    {showNew && !kept && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <Button variant="secondary" size="sm" onClick={() => keepUnread(n.id)}>
                          Keep unread
                        </Button>
                      </div>
                    )}
                    {kept && (
                      <p style={{ color: "#607080", fontSize: "0.72rem", margin: "0.6rem 0 0", fontStyle: "italic" }}>
                        Kept as unread
                      </p>
                    )}
                  </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}