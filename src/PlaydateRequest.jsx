import { useState } from "react";
import { supabase } from "./supabase";

export default function PlaydateRequest({ session, recipient, onBack, onSent }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const locations = [
    { name: "Local Park", address: "Nearby park" },
    { name: "School Playground", address: "School grounds" },
    { name: "Community Center", address: "Community center" },
    { name: "Our House", address: "My home" },
    { name: "Their House", address: "Their home" },
    { name: "Custom location", address: "" },
  ];

  const sendRequest = async () => {
    if (!date || !time || !locationName) {
      setError("Please fill in date, time and location");
      return;
    }
    setLoading(true);
    setError("");

    const proposedDate = new Date(`${date}T${time}`).toISOString();

    const { error: reqError } = await supabase
      .from("playdates")
      .insert({
        requester_id: session.user.id,
        recipient_id: recipient.id,
        proposed_date: proposedDate,
        location_name: locationName,
        location_address: locationAddress,
        status: "pending",
      });

    if (reqError) {
      setError(reqError.message);
      setLoading(false);
      return;
    }

    onSent();
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#162D50", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#02C39A", fontSize: "1rem", cursor: "pointer" }}>← Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.1rem", fontWeight: "500", margin: 0 }}>Request a Playdate</h1>
        <div style={{ width: "60px" }} />
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "500px", margin: "0 auto" }}>

        {/* Recipient card */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#028090", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "600", color: "#FFFFFF", overflow: "hidden", flexShrink: 0 }}>
            {recipient.photo_url ? (
              <img src={recipient.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              recipient.name?.charAt(0) || "?"
            )}
          </div>
          <div>
            <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "500", margin: "0 0 2px" }}>{recipient.name}</p>
            <p style={{ color: "#607080", fontSize: "0.8rem", margin: 0 }}>Sending a playdate request</p>
          </div>
        </div>

        {/* Date & Time */}
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
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Location */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>LOCATION</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1rem" }}>
            {locations.map((loc) => (
              <button
                key={loc.name}
                onClick={() => { setLocationName(loc.name); setLocationAddress(loc.address); }}
                style={{
                  padding: "0.6rem", borderRadius: "8px", border: "1px solid",
                  borderColor: locationName === loc.name ? "#02C39A" : "#2A4A6B",
                  background: locationName === loc.name ? "#0F3D2E" : "transparent",
                  color: locationName === loc.name ? "#02C39A" : "#8AAEC8",
                  fontSize: "0.8rem", cursor: "pointer", textAlign: "left"
                }}
              >
                {loc.name}
              </button>
            ))}
          </div>
          {locationName === "Custom location" && (
            <>
              <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Location name</label>
              <input type="text" placeholder="e.g. Howarth Park" onChange={(e) => setLocationName(e.target.value)} style={inputStyle} />
              <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Address</label>
              <input type="text" placeholder="Full address" onChange={(e) => setLocationAddress(e.target.value)} style={inputStyle} />
            </>
          )}
        </div>

        {/* Note */}
        <div style={{ background: "#162D50", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem", border: "1px solid #2A4A6B" }}>
          <p style={{ color: "#8AAEC8", fontSize: "0.75rem", margin: "0 0 1rem", letterSpacing: "0.05em" }}>ADD A NOTE (optional)</p>
          <textarea
            placeholder="e.g. Our kids seem to get along great!"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none", marginBottom: 0 }}
          />
        </div>

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

        <button
          onClick={sendRequest}
          disabled={loading}
          style={{
            width: "100%", padding: "0.85rem", borderRadius: "10px",
            border: "none", background: loading ? "#028090" : "#02C39A",
            color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Sending..." : "Send playdate request →"}
        </button>

      </div>
    </div>
  );
}