import { useState } from "react";

export default function App() {
  const [phone, setPhone] = useState("");

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0F2044",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ color: "#02C39A", fontSize: "3rem", fontWeight: "700", margin: "0 0 0.5rem" }}>
        Huddle
      </h1>
      <p style={{ color: "#B0C4D8", fontSize: "1rem", margin: "0 0 3rem" }}>
        The social app for school families
      </p>

      <div style={{
        background: "#162D50",
        borderRadius: "16px",
        padding: "2rem",
        width: "100%",
        maxWidth: "400px"
      }}>
        <h2 style={{ color: "#FFFFFF", fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
          Welcome
        </h2>
        <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Enter your phone number to get started
        </p>

        <input
          type="tel"
          placeholder="(555) 000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{
            width: "100%",
            padding: "0.85rem 1rem",
            borderRadius: "10px",
            border: "1px solid #2A4A6B",
            background: "#0F2044",
            color: "#FFFFFF",
            fontSize: "1rem",
            marginBottom: "1rem",
            boxSizing: "border-box"
          }}
        />

        <button
          style={{
            width: "100%",
            padding: "0.85rem",
            borderRadius: "10px",
            border: "none",
            background: "#02C39A",
            color: "#0F2044",
            fontSize: "1rem",
            fontWeight: "600",
            cursor: "pointer"
          }}
        >
          Send verification code →
        </button>
      </div>
    </div>
  );
}
