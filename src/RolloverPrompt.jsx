import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Button from "./Button";
import Icon from "./Icon";

// Elementary grades (must match the app-wide grades arrays: TK–5th).
const GRADES = ["TK", "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade"];

// One-screen rollover prompt. Shows a household's stale (last-year) classrooms,
// each pre-filled with a next-grade guess (teacher blank/required). Per classroom
// the parent picks ONE of: "Moving up" (confirm grade+teacher), "Not returning",
// or "Don't know yet" (defer just this one). Submits once, handling the mix.
//
// On submit:
//   - "up"      -> find-or-create the new-year classroom + join it.
//   - "leaving" -> do nothing (last-year membership stays as history).
//   - "unknown" -> do nothing, left stale -> re-prompts next login.
//   - parents.rolled_over_year is set to currentYear ONLY IF zero classrooms
//     were deferred ("unknown"). If any deferred, leave it null so the prompt
//     returns next login for just those (App filters out already-resolved ones).
//
// Props: session, householdId, currentYear, memberships[], onDone(), onRemindLater()
export default function RolloverPrompt({ session, householdId, currentYear, memberships, onDone, onRemindLater }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const seeded = (memberships || []).map((m) => {
      const c = m.classrooms || {};
      const lastGrade = typeof c.grade === "number" ? c.grade : 0;
      const nextGrade = Math.min(lastGrade + 1, GRADES.length - 1);
      const atTop = lastGrade >= GRADES.length - 1; // was 5th -> leaving elementary
      return {
        membershipId: m.id,
        lastClassroomId: c.id,
        lastLabel: `${c.teacher_name || "?"} · ${GRADES[lastGrade] || "?"}`,
        schoolId: c.schools?.id || c.school_id,
        schoolName: c.schools?.name || "your school",
        choice: null, // "up" | "leaving" | "unknown"
        grade: nextGrade,
        teacher: "",
        atTop,
      };
    });
    setRows(seeded);
  }, [memberships]);

  const setRow = (id, patch) =>
    setRows((prev) => prev.map((r) => (r.membershipId === id ? { ...r, ...patch } : r)));

  const allDecided = rows.length > 0 && rows.every((r) => r.choice !== null);
  const upRowsValid = rows.filter((r) => r.choice === "up").every((r) => r.teacher.trim().length > 0);
  const canSubmit = allDecided && upRowsValid && !busy;
  const anyDeferred = rows.some((r) => r.choice === "unknown");

  // Find-or-create the new-year classroom and join it (mirrors Home.commitClassroom).
  const commitOne = async (row) => {
    const cleanTeacher = row.teacher.trim().replace(/\s+/g, " ");
    const { data: existing } = await supabase
      .from("classrooms")
      .select("id, teacher_name, grade")
      .eq("school_id", row.schoolId)
      .eq("school_year", currentYear);
    const match = (existing || []).find(
      (c) =>
        c.grade === row.grade &&
        (c.teacher_name || "").trim().replace(/\s+/g, " ").toLowerCase() === cleanTeacher.toLowerCase()
    );

    let classroomId = match?.id;
    if (!classroomId) {
      const { data: created, error: cErr } = await supabase
        .from("classrooms")
        .insert({ school_id: row.schoolId, teacher_name: cleanTeacher, grade: row.grade, school_year: currentYear })
        .select()
        .single();
      if (cErr) throw cErr;
      classroomId = created.id;
    }

    const { error: mErr } = await supabase
      .from("classroom_members")
      .insert({ household_id: householdId, classroom_id: classroomId, school_year: currentYear });
    if (mErr && !mErr.message.includes("duplicate")) throw mErr;
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      for (const row of rows) {
        if (row.choice === "up") await commitOne(row);
        // "leaving" and "unknown": no write. "unknown" stays stale -> re-prompts.
      }
      // Only mark fully rolled over if NOTHING was deferred. If any classroom is
      // "don't know yet", leave rolled_over_year null so the prompt returns next
      // login (App excludes the ones already resolved).
      if (!anyDeferred) {
        const { error: pErr } = await supabase
          .from("parents")
          .update({ rolled_over_year: currentYear })
          .eq("id", session.user.id);
        if (pErr) throw pErr;
      }
      onDone();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const choiceBtn = (active, label, onClick, activeBg, activeColor) => (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "0.55rem 0.4rem", borderRadius: "10px", border: "none",
        background: active ? activeBg : "#1B3A5C",
        color: active ? activeColor : "#8AAEC8",
        fontSize: "0.8rem", fontWeight: active ? "700" : "500", cursor: "pointer",
        lineHeight: "1.2",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#162D50", padding: "1.1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.35rem", fontWeight: "700", margin: 0, letterSpacing: "-0.01em" }}>
          New school year 🎒
        </h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.85rem", margin: "4px 0 0", lineHeight: "1.5" }}>
          Let's get your {currentYear} classrooms set up so you can find this year's families.
        </p>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto" }}>
        {rows.length === 0 ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Loading your classrooms...</p>
        ) : (
          rows.map((r) => (
            <div key={r.membershipId} style={{ background: "#162D50", border: "1px solid #22355A", borderRadius: "12px", padding: "1.1rem 1.25rem", marginBottom: "12px" }}>
              <p style={{ color: "#8AAEC8", fontSize: "0.72rem", margin: "0 0 2px", letterSpacing: "0.05em" }}>LAST YEAR</p>
              <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: "0 0 0.9rem" }}>
                <Icon name="school" size={18} color="#B8CCE0" style={{ verticalAlign: "-3px", marginRight: 4 }} />{r.schoolName} · {r.lastLabel}
              </p>

              <div style={{ display: "flex", gap: "6px", marginBottom: r.choice === "up" ? "1rem" : (r.choice ? "0.85rem" : 0) }}>
                {choiceBtn(r.choice === "up", "Moving up", () => setRow(r.membershipId, { choice: "up" }), "#02C39A", "#0F2044")}
                {choiceBtn(r.choice === "leaving", r.atTop ? "Middle school" : "Not returning", () => setRow(r.membershipId, { choice: "leaving" }), "#7C5CBF", "#FFFFFF")}
                {choiceBtn(r.choice === "unknown", "Don't know yet", () => setRow(r.membershipId, { choice: "unknown" }), "#1B3A5C", "#FFFFFF")}
              </div>

              {r.choice === "up" && (
                <div style={{ borderTop: "1px solid #22355A", paddingTop: "1rem" }}>
                  <label style={{ color: "#8AAEC8", fontSize: "0.8rem", display: "block", marginBottom: "0.4rem" }}>Grade this year</label>
                  <select
                    value={r.grade}
                    onChange={(e) => setRow(r.membershipId, { grade: parseInt(e.target.value, 10) })}
                    style={{ width: "100%", padding: "0.75rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.95rem", marginBottom: "0.85rem", boxSizing: "border-box", cursor: "pointer" }}
                  >
                    {GRADES.map((g, idx) => (
                      <option key={idx} value={idx}>{g}</option>
                    ))}
                  </select>

                  <label style={{ color: "#8AAEC8", fontSize: "0.8rem", display: "block", marginBottom: "0.4rem" }}>This year's teacher</label>
                  <input
                    type="text"
                    placeholder="e.g. Ms. Rodriguez"
                    value={r.teacher}
                    onChange={(e) => setRow(r.membershipId, { teacher: e.target.value })}
                    style={{ width: "100%", padding: "0.75rem", borderRadius: "10px", border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF", fontSize: "0.95rem", boxSizing: "border-box" }}
                  />
                  <p style={{ color: "#607080", fontSize: "0.72rem", margin: "0.5rem 0 0", lineHeight: "1.4" }}>
                    Same school. If you've changed schools, you can adjust it on your profile after.
                  </p>
                </div>
              )}

              {r.choice === "leaving" && (
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: 0, lineHeight: "1.5" }}>
                  {r.atTop
                    ? "Congrats on finishing elementary! We'll keep your existing connections in your Network."
                    : "No problem — we'll keep your existing connections in your Network."}
                </p>
              )}

              {r.choice === "unknown" && (
                <p style={{ color: "#8AAEC8", fontSize: "0.8rem", margin: 0, lineHeight: "1.5" }}>
                  No problem — we'll ask again next time you open Huddle. This classroom stays as-is for now.
                </p>
              )}
            </div>
          ))
        )}

        {error && <p style={{ color: "#F87171", fontSize: "0.85rem", margin: "0 0 1rem" }}>{error}</p>}

        <div style={{ marginTop: "0.5rem" }}>
          <Button fullWidth variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? "Saving..." : anyDeferred ? "Save what I know" : "Confirm my classrooms"}
          </Button>
          <p style={{ color: "#607080", fontSize: "0.72rem", textAlign: "center", margin: "0.7rem 0 0", lineHeight: "1.4" }}>
            {anyDeferred
              ? "We'll ask again about the classrooms you're not sure of yet. Everything keeps working in the meantime."
              : "Pick an option for each classroom to continue."}
          </p>
        </div>
      </div>
    </div>
  );
}