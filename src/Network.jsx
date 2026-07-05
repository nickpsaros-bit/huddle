import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import PlaydateRequest from "./PlaydateRequest";
import InviteFamily from "./InviteFamily";
import ConfirmModal from "./ConfirmModal";
import { blockParent, getHiddenParentIds, submitReport } from "./blocks";
import Button from "./Button";
import Icon from "./Icon";
import TopBar from "./TopBar";

export default function Network({ session, avatarUrl, onProfileClick, onSearchClick, onBellClick, notificationCount = 0, onGoHome }) {
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestingPlaydate, setRequestingPlaydate] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [myName, setMyName] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [message, setMessage] = useState("");
  const [reporting, setReporting] = useState(null); // { personId, personName }
  const [reportCategory, setReportCategory] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportAlsoBlock, setReportAlsoBlock] = useState(true);
  const [reportBusy, setReportBusy] = useState(false);
  const [petsByHousehold, setPetsByHousehold] = useState({});

  useEffect(() => { fetchConnections(); }, []);

  // Privacy-safe short name: "Lee Parker" -> "Lee P."
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

    const hiddenNet = await getHiddenParentIds();
    const connectedPeople = (data || []).map((conn) => {
      const isRequester = conn.requester_id === userId;
      return {
        connectionId: conn.id,
        person: isRequester ? conn.recipient : conn.requester,
        connectedSince: conn.created_at,
      };
    }).filter((c) => c.person?.id && !hiddenNet.has(c.person.id));

    const householdsMap = {};
    const loosePeople = [];

    // Batch: one query for ALL connected people's households instead of one-per-person.
    const connectedParentIds = connectedPeople.map((c) => c.person.id);
    const hmByParent = {};
    if (connectedParentIds.length > 0) {
      const { data: allHms } = await supabase
        .from("household_members")
        .select("parent_id, household_id")
        .in("parent_id", connectedParentIds);
      for (const row of (allHms || [])) hmByParent[row.parent_id] = row.household_id;
    }

    for (const c of connectedPeople) {
      const hhId = hmByParent[c.person.id];
      if (!hhId) {
        loosePeople.push(c);
        continue;
      }
      if (!householdsMap[hhId]) {
        householdsMap[hhId] = { householdId: hhId, classrooms: [], members: [], _seen: new Set() };
      }
      householdsMap[hhId]._connectedById = householdsMap[hhId]._connectedById || {};
      householdsMap[hhId]._connectedById[c.person.id] = {
        connectionId: c.connectionId,
        person: c.person,
      };
    }

    const householdIds = Object.keys(householdsMap);
    // Run each household's two queries in parallel across ALL households.
    await Promise.all(householdIds.map(async (hhId) => {
      const [membershipsRes, allMembersRes] = await Promise.all([
        supabase.from("classroom_members").select("*, classrooms(teacher_name, grade, schools(name))").eq("household_id", hhId),
        supabase.from("household_members").select("parents(id, name, photo_url)").eq("household_id", hhId),
      ]);
      householdsMap[hhId].classrooms = membershipsRes.data || [];

      const connectedById = householdsMap[hhId]._connectedById || {};
      const members = [];
      for (const row of (allMembersRes.data || [])) {
        const p = row.parents;
        if (!p || !p.id) continue;
        if (p.id === userId) continue;
        const link = connectedById[p.id];
        members.push({
          id: p.id,
          name: p.name,
          photo_url: p.photo_url,
          connectionId: link ? link.connectionId : null,
        });
      }
      members.sort((a, b) => {
        if (!!a.connectionId !== !!b.connectionId) return a.connectionId ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
      });
      householdsMap[hhId].members = members;
    }));

    const grouped = Object.values(householdsMap)
      .map(({ _seen, _connectedById, ...rest }) => rest)
      .filter((h) => h.members.length > 0);

    if (householdIds.length > 0) {
      const { data: prefs } = await supabase
        .from("household_preferences")
        .select("household_id, has_dog, has_cat, has_horse, has_other, other_label")
        .in("household_id", householdIds);
      const map = {};
      for (const row of (prefs || [])) map[row.household_id] = row;
      setPetsByHousehold(map);
    }

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

  const doRemoveConnection = async (connectionId) => {
    await supabase.from("connections").delete().eq("id", connectionId);
    fetchConnections();
  };

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

  const blockPerson = (personId, personName) => {
    setConfirm({
      title: `Block ${shortName(personName)}?`,
      body: `You won't see each other or be able to invite each other on Huddle, and your connection will be removed. They won't be notified. (This won't change the fact that your children may share a classroom in real life.)`,
      confirmLabel: "Block",
      cancelLabel: "Cancel",
      tone: "danger",
      onConfirm: () => doBlockPerson(personId, personName),
    });
  };

  const doBlockPerson = async (personId, personName) => {
    setConfirm(null);
    const res = await blockParent(session.user.id, personId);
    if (res.ok) {
      setMessage(`${shortName(personName)} has been blocked.`);
      fetchConnections();
      setTimeout(() => setMessage(""), 3000);
    } else {
      setMessage("Couldn't block, please try again.");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const openReport = (personId, personName) => {
    setReportCategory("");
    setReportDetails("");
    setReportAlsoBlock(true);
    setReporting({ personId, personName });
  };

  const submitReportNow = async () => {
    if (!reportCategory || !reporting) return;
    setReportBusy(true);
    const res = await submitReport(session.user.id, reporting.personId, reportCategory, reportDetails, reportAlsoBlock);
    setReportBusy(false);
    if (res.ok) {
      setReporting(null);
      setMessage(reportAlsoBlock
        ? `Report submitted and ${shortName(reporting.personName)} blocked. Thank you for keeping Huddle safe.`
        : "Report submitted. Thank you for keeping Huddle safe.");
      fetchConnections();
      setTimeout(() => setMessage(""), 4000);
    } else {
      setMessage("Couldn't submit the report, please try again.");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  const grades = ["TK","K","1st","2nd","3rd","4th","5th"];

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
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px", animation: "huddleFadeInUp 340ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>

      <TopBar
        title="Your Network"
        notificationCount={notificationCount}
        onBellClick={onBellClick}
        onSearchClick={onSearchClick}
        onProfileClick={onProfileClick}
        onLogoClick={onGoHome}
        avatarUrl={avatarUrl}
        initial={(myName && myName.charAt(0)) || "?"}
      />
      <p style={{ color: "#8AAEC8", fontSize: "0.82rem", margin: 0, padding: "0.75rem 1.5rem 0", maxWidth: "600px", marginLeft: "auto", marginRight: "auto" }}>
        Parents you've connected with across classrooms
      </p>

      {message && (
        <div style={{ maxWidth: "600px", margin: "0.75rem auto 0", padding: "0 1.5rem" }}>
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "10px", padding: "0.7rem 1rem" }}>
            <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0 }}>{message}</p>
          </div>
        </div>
      )}

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>

        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading...</p>
        ) : households.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ margin: "0 0 1rem" }}><Icon name="group" size={44} color="#3E5A7F" /></p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No connections yet</p>
            <p style={{ color: "#607080", fontSize: "0.85rem" }}>Use Search to find other parents at your school, or invite a parent below. They'll show up here so you can set up playdates across classrooms.</p>
          </div>
        ) : (
          <>
            <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: "0 0 0.75rem", letterSpacing: "0.05em" }}>
              {connectedCount} {connectedCount === 1 ? "CONNECTION" : "CONNECTIONS"}
            </p>
            {households.map((hh) => (
              <div key={hh.householdId} style={{ marginBottom: "1.5rem" }}>

                {hh.classrooms.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", padding: "0 4px 8px" }}>
                    <Icon name="school" size={16} color="#8AAEC8" />
                    {hh.classrooms.map((c, idx) => (
                      <span key={idx} style={{ color: idx === 0 ? "#B8CCE0" : "#607080", fontSize: "0.82rem" }}>
                        {idx > 0 && <span style={{ color: "#3A4D68", margin: "0 2px" }}>·</span>}
                        {c.classrooms?.teacher_name}, {grades[c.classrooms?.grade] || "?"}
                      </span>
                    ))}
                    {petBadges(hh.householdId)}
                  </div>
                )}

                <div style={{ background: "#162D50", borderRadius: "12px", border: "1px solid #22355A", overflow: "hidden" }}>
                  {hh.members.map((m, idx) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0.85rem 1rem", borderTop: idx > 0 ? "1px solid #22355A" : "none" }}>
                      <div style={{ width: "46px", height: "46px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
                        {m.photo_url ? (
                          <img src={m.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          m.name?.charAt(0) || "?"
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: 0 }}>
                          {shortName(m.name)}
                        </p>
                        {!m.connectionId && (
                          <p style={{ color: "#607080", fontSize: "0.78rem", margin: "2px 0 0" }}>Co-parent</p>
                        )}
                        {m.connectionId && (
                          <div style={{ display: "flex", gap: "12px", marginTop: "1px" }}>
                            <button onClick={() => removeConnection(m.connectionId, m.name)}
                              style={{ background: "transparent", border: "none", color: "#4A5D78", fontSize: "0.75rem", cursor: "pointer", padding: "2px 0 0" }}>
                              Remove
                            </button>
                            <button onClick={() => blockPerson(m.id, m.name)}
                              style={{ background: "transparent", border: "none", color: "#7A3B3B", fontSize: "0.75rem", cursor: "pointer", padding: "2px 0 0" }}>
                              Block
                            </button>
                            <button onClick={() => openReport(m.id, m.name)}
                              style={{ background: "transparent", border: "none", color: "#7A3B3B", fontSize: "0.75rem", cursor: "pointer", padding: "2px 0 0" }}>
                              Report
                            </button>
                          </div>
                        )}
                      </div>
                      {m.connectionId && (
                        <Button variant="primary" size="sm" onClick={() => setRequestingPlaydate({ id: m.id, name: m.name, photo_url: m.photo_url })} style={{ flexShrink: 0 }}>
                          Huddle →
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {!loading && (
          <Button fullWidth onClick={() => setInviting(true)}
            style={{ border: "1px dashed #02C39A", background: "#0F3D2E", color: "#02C39A", borderRadius: "12px", marginTop: "1.5rem" }}>
            <Icon name="add" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Invite a parent to Huddle
          </Button>
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

      {reporting && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(6,16,36,0.85)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div style={{ background: "#162D50", border: "1px solid #2A4A6B", borderRadius: "16px", padding: "1.5rem", maxWidth: "400px", width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.15rem", fontWeight: "700", margin: "0 0 0.35rem" }}>
              Report {shortName(reporting.personName)}
            </h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.82rem", lineHeight: "1.5", margin: "0 0 1.1rem" }}>
              Reports are sent privately to the Huddle team for review. Your report is confidential.
            </p>

            <p style={{ color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", letterSpacing: "0.05em", margin: "0 0 0.5rem" }}>WHAT'S THE CONCERN?</p>
            {[
              { key: "harassment", label: "Harassment or bullying" },
              { key: "inappropriate", label: "Inappropriate behavior or messages" },
              { key: "spam_scam", label: "Spam or scam" },
              { key: "child_safety", label: "Concern about a child's safety" },
              { key: "other", label: "Something else" },
            ].map((opt) => (
              <div key={opt.key} onClick={() => setReportCategory(opt.key)}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.7rem 0.9rem", borderRadius: "10px", border: `1px solid ${reportCategory === opt.key ? "#02C39A" : "#2A4A6B"}`, background: reportCategory === opt.key ? "#12352C" : "transparent", marginBottom: "0.5rem", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `2px solid ${reportCategory === opt.key ? "#02C39A" : "#4A5D78"}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {reportCategory === opt.key && <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#02C39A" }} />}
                </div>
                <span style={{ color: "#FFFFFF", fontSize: "0.88rem" }}>{opt.label}</span>
              </div>
            ))}

            <textarea
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Add any details that would help us (optional)"
              rows={3}
              style={{ width: "100%", padding: "0.7rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.85rem", marginTop: "0.5rem", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
            />

            <div onClick={() => setReportAlsoBlock(!reportAlsoBlock)}
              style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.7rem 0", cursor: "pointer" }}>
              <div style={{ width: "20px", height: "20px", borderRadius: "6px", border: `2px solid ${reportAlsoBlock ? "#02C39A" : "#4A5D78"}`, background: reportAlsoBlock ? "#02C39A" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {reportAlsoBlock && <Icon name="check" size={14} color="#0F2044" />}
              </div>
              <span style={{ color: "#FFFFFF", fontSize: "0.88rem" }}>Also block {shortName(reporting.personName)}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "1rem" }}>
              <button disabled={!reportCategory || reportBusy} onClick={submitReportNow}
                style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: (!reportCategory || reportBusy) ? "#28405F" : "#C0504D", color: "#FFFFFF", fontWeight: "700", cursor: (!reportCategory || reportBusy) ? "default" : "pointer", fontSize: "0.9rem" }}>
                {reportBusy ? "Submitting..." : "Submit report"}
              </button>
              <button onClick={() => setReporting(null)}
                style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "transparent", color: "#8AAEC8", fontWeight: "600", cursor: "pointer", fontSize: "0.9rem" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}