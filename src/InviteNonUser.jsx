import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Button from "./Button";
import Icon from "./Icon";
import InviteFamily from "./InviteFamily";

// Streamlined flow for inviting someone who ISN'T on Huddle to a playdate.
// Creates a playdate (host-only guest list), then fires create-pending-invite,
// which emails the non-user a tokenized landing page (+ .ics). Surfaces the
// backend safety codes (already_user / already_invited / opted_out /
// monthly_limit). On monthly_limit we roll the playdate back and offer the
// existing connection-invite flow (InviteFamily) instead.
export default function InviteNonUser({ session, inviterName, onBack, onDone }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [email, setEmail] = useState("");
  const [inviteeName, setInviteeName] = useState("");
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // Over-cap: when true we show the "invite them to Huddle instead" path.
  const [showConnectionInvite, setShowConnectionInvite] = useState(false);
  const [capMessage, setCapMessage] = useState("");

  const locations = [
    { name: "Local Park", address: "Nearby park" },
    { name: "School Playground", address: "School grounds" },
    { name: "Community Center", address: "Community center" },
    { name: "Our House", address: "My home" },
    { name: "Their House", address: "Their home" },
  ];

  // Time slots 7am–9pm every 30 min, mirroring PlaydateRequest.
  const timeSlots = [];
  for (let h = 7; h <= 21; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? "AM" : "PM";
      timeSlots.push({ value, label: `${hour12}:${String(m).padStart(2, "0")} ${ampm}` });
    }
  }

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box",
  };

  const isPresetSelected = locations.some((l) => l.name === locationName);
  const accent = "#02C39A";

  const validEmail = (s) => {
    const c = (s || "").trim().toLowerCase();
    return c.includes("@") && c.includes(".") && !c.endsWith("@");
  };

  const send = async () => {
    // ---- Validate ----
    if (!date || !time || !locationName) {
      setError("Please fill in date, time and location.");
      return;
    }
    const startsAt = new Date(`${date}T${time}`);
    if (isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError("Please pick a date and time in the future.");
      return;
    }
    if (!validEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError("");

    let createdPlaydateId = null;
    try {
      // 1) My household.
      const { data: myHm, error: myErr } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .single();
      if (myErr) throw myErr;

      const proposedDate = startsAt.toISOString();

      // 2) Create the playdate.
      const { data: playdate, error: pdErr } = await supabase
        .from("playdates")
        .insert({
          organizer_household_id: myHm.household_id,
          organizer_parent_id: session.user.id,
          proposed_date: proposedDate,
          location_name: locationName,
          location_address: locationAddress,
          note: note || null,
          status: "pending",
          event_type: "playdate",
          recurrence: "none",
        })
        .select()
        .single();
      if (pdErr) throw pdErr;
      createdPlaydateId = playdate.id;

      // 3) Host's own invite row (rsvp=yes), matching the normal send flow.
      const { error: invErr } = await supabase.from("playdate_invites").insert({
        playdate_id: playdate.id,
        household_id: myHm.household_id,
        invited_by_household_id: myHm.household_id,
        invited_parent_id: session.user.id,
        rsvp: "yes",
      });
      if (invErr) throw invErr;

      // 4) Host's own calendar copy (best-effort), matching PlaydateRequest.
      supabase.functions.invoke("send-host-calendar", {
        body: { playdate_id: playdate.id },
      }).catch(() => {});

      // 5) Fire the non-user invite.
      const { data: result, error: fnErr } = await supabase.functions.invoke(
        "create-pending-invite",
        {
          body: {
            playdate_id: playdate.id,
            invitee_email: email.trim().toLowerCase(),
            invitee_name: inviteeName.trim() || null,
          },
        }
      );

      // supabase.functions.invoke surfaces non-2xx as fnErr with the body in context;
      // we also defensively read result.code when present.
      const code = result?.code || (fnErr ? await extractCode(fnErr) : null);

      if (result?.ok) {
        setSent(true);
        setLoading(false);
        return;
      }

      // ---- Handle safety codes ----
      if (code === "monthly_limit") {
        // Roll back the just-created playdate (option B: clean connection invite).
        if (createdPlaydateId) {
          await supabase.from("playdates").delete().eq("id", createdPlaydateId);
          createdPlaydateId = null;
        }
        setCapMessage(
          "You've reached your limit of 4 playdate invites to people not yet on Huddle this month. You can still invite them to join Huddle — once they're on, you'll be connected and can set up a playdate together."
        );
        setShowConnectionInvite(true);
        setLoading(false);
        return;
      }

      // For every other failure, roll back the playdate so we don't leave an
      // orphan, then show the specific message.
      if (createdPlaydateId) {
        await supabase.from("playdates").delete().eq("id", createdPlaydateId);
        createdPlaydateId = null;
      }

      if (code === "already_user") {
        setError("This person is already on Huddle. Use Search to find them by email and connect — then you can invite them to a playdate directly.");
      } else if (code === "already_invited") {
        setError("You've already invited this person to a playdate — they have a pending invite.");
      } else if (code === "opted_out") {
        setError("This person has opted out of Huddle invite emails, so we can't send them one.");
      } else {
        setError(result?.error || (fnErr && fnErr.message) || "Something went wrong sending the invite. Please try again.");
      }
      setLoading(false);
    } catch (err) {
      if (createdPlaydateId) {
        await supabase.from("playdates").delete().eq("id", createdPlaydateId);
      }
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  // Best-effort extraction of a { code } from a FunctionsHttpError.
  const extractCode = async (fnErr) => {
    try {
      if (fnErr?.context && typeof fnErr.context.json === "function") {
        const body = await fnErr.context.json();
        return body?.code || null;
      }
    } catch (_e) { /* ignore */ }
    return null;
  };

  // ---- Over-cap: reuse the existing connection-invite flow ----
  if (showConnectionInvite) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
          <button onClick={onBack} style={{ background: "transparent", border: "none", color: accent, fontSize: "1rem", cursor: "pointer" }}>
            <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back
          </button>
          <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Invite to Huddle</h1>
          <div style={{ width: "60px" }} />
        </div>
        <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>
          <div style={{ background: "#3D2A0A", border: "1px solid #854F0B", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
            <p style={{ color: "#F59E0B", fontSize: "0.9rem", margin: 0, lineHeight: "1.5" }}>{capMessage}</p>
          </div>
        </div>
        <InviteFamily
          session={session}
          inviterName={inviterName}
          onClose={onDone}
        />
      </div>
    );
  }

  // ---- Success ----
  if (sent) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div style={{ textAlign: "center", maxWidth: "360px" }}>
          <div style={{ fontSize: "3.5rem", margin: "0 0 1rem", animation: "huddlePop 450ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>🎉</div>
          <h2 style={{ color: accent, fontSize: "1.5rem", fontWeight: "700", margin: "0 0 0.5rem" }}>Invite sent!</h2>
          <p style={{ color: "#8AAEC8", fontSize: "0.95rem", margin: "0 0 1.75rem", lineHeight: "1.5" }}>
            We emailed <span style={{ color: "#FFFFFF" }}>{email.trim().toLowerCase()}</span> a playdate invite with a calendar file. They can reply right from the email — no account needed. You'll see their reply in your notifications.
          </p>
          <Button variant="secondary" onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  // ---- Main form ----
  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: accent, fontSize: "1rem", cursor: "pointer" }}>
          <Icon name="arrow_back" size={18} style={{ verticalAlign: "-3px", marginRight: 4 }} />Back
        </button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Invite someone not on Huddle</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>

        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: 0, lineHeight: "1.5" }}>
            Invite a family who isn't on Huddle yet. We'll email them the playdate details and a calendar invite — they can reply without signing up.
          </p>
        </div>

        {/* WHO */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>WHO ARE YOU INVITING?</p>
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Their email</label>
          <input
            type="email"
            placeholder="parent@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Their name (optional)</label>
          <input
            type="text"
            placeholder="e.g. Sam"
            value={inviteeName}
            onChange={(e) => setInviteeName(e.target.value)}
            maxLength={60}
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>

        {/* DATE & TIME */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>DATE & TIME</p>
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            style={inputStyle}
          />
          <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Time</label>
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ ...inputStyle, appearance: "auto", cursor: "pointer", marginBottom: 0 }}
          >
            <option value="" disabled>Select a time</option>
            {timeSlots.map((slot) => (
              <option key={slot.value} value={slot.value}>{slot.label}</option>
            ))}
          </select>
        </div>

        {/* LOCATION */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>LOCATION</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1rem" }}>
            {locations.map((loc) => {
              const selected = locationName === loc.name;
              return (
                <button
                  key={loc.name}
                  onClick={() => { setLocationName(loc.name); setLocationAddress(loc.address); }}
                  style={{
                    padding: "0.6rem", borderRadius: "8px", border: "1px solid",
                    borderColor: selected ? accent : "#2A4A6B",
                    background: selected ? "#0F3D2E" : "transparent",
                    color: selected ? accent : "#8AAEC8",
                    fontSize: "0.8rem", cursor: "pointer", textAlign: "left",
                  }}
                >
                  {loc.name}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "0.25rem 0 0.85rem" }}>
            <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
            <span style={{ color: "#607080", fontSize: "0.75rem" }}>or enter a specific place</span>
            <div style={{ flex: 1, height: "1px", background: "#2A4A6B" }} />
          </div>

          <input
            type="text"
            placeholder="e.g. Howarth Park, Santa Rosa"
            value={isPresetSelected ? "" : locationName}
            onChange={(e) => { setLocationName(e.target.value); setLocationAddress(""); }}
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>

        {/* NOTE */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>ADD A NOTE (optional)</p>
          <textarea
            placeholder="e.g. Our kids are in the same class — thought they'd love a playdate!"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none", marginBottom: 0 }}
          />
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem", lineHeight: "1.5" }}>{error}</p>}

        <Button
          fullWidth
          onClick={send}
          disabled={loading}
          style={{ background: loading ? "#028090" : accent, color: "#0F2044" }}
        >
          {loading ? "Sending..." : "Send invite →"}
        </Button>
      </div>
    </div>
  );
}