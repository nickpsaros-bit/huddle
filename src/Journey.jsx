import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { currentSchoolYear, earliestStartMonth } from "./schoolYear";

const GRADES = ["TK", "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function gradeLabel(g) {
  return typeof g === "number" && GRADES[g] ? GRADES[g] : "Classroom";
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

// Sort helper: school-year label "2025-2026" -> starting year number for ordering.
function yearNum(label) {
  const n = parseInt((label || "").split("-")[0], 10);
  return Number.isFinite(n) ? n : 0;
}

// Your Huddle journey: classrooms (backbone, per year) + playdates + birthday
// parties (real dated events) + the household's recurring birthday (generic marker).
// All assembled newest-first into one timeline.
export default function Journey({ session, onBack }) {
  const [loading, setLoading] = useState(true);
  const [householdId, setHouseholdId] = useState(null);
  const [years, setYears] = useState([]); // [{ year, classrooms:[], events:[] }]
  const [startMonthState, setStartMonthState] = useState(8);

  useEffect(() => {
    (async () => {
      try {
        const userId = session.user.id;
        const { data: hm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", userId)
          .maybeSingle();
        if (!hm) { setLoading(false); return; }
        const hhId = hm.household_id;
        setHouseholdId(hhId);

        // 1) Classroom memberships across all years (the backbone).
        const { data: memberships } = await supabase
          .from("classroom_members")
          .select("id, school_year, classrooms(id, teacher_name, grade, schools(id, name, school_start_month))")
          .eq("household_id", hhId);

        const startMonths = (memberships || [])
          .map((m) => m.classrooms?.schools?.school_start_month)
          .filter((n) => typeof n === "number");
        const startMonth = earliestStartMonth(startMonths);

        // Count classmates per membership (families huddled with that year).
        // One batched query instead of a per-classroom count loop: fetch all
        // members of the relevant classrooms, then tally in memory.
        const classmateCounts = {};
        const classroomIds = [...new Set(
          (memberships || []).map((m) => m.classrooms?.id).filter(Boolean)
        )];
        if (classroomIds.length > 0) {
          const { data: allMembers } = await supabase
            .from("classroom_members")
            .select("classroom_id, school_year, household_id")
            .in("classroom_id", classroomIds);

          // Tally distinct OTHER households per (classroom_id + school_year).
          const tally = {}; // key: `${classroom_id}|${school_year}` -> Set of household_ids
          for (const row of (allMembers || [])) {
            if (row.household_id === hhId) continue; // exclude self
            const key = `${row.classroom_id}|${row.school_year}`;
            if (!tally[key]) tally[key] = new Set();
            tally[key].add(row.household_id);
          }

          // Map each membership to its count.
          for (const m of (memberships || [])) {
            const key = `${m.classrooms?.id}|${m.school_year}`;
            classmateCounts[m.id] = tally[key] ? tally[key].size : 0;
          }
        }

        // 2) Playdates + birthday parties this household was part of (as host or invitee).
        const { data: myInvites } = await supabase
          .from("playdate_invites")
          .select("playdate_id")
          .eq("household_id", hhId);
        const invitedIds = [...new Set((myInvites || []).map((i) => i.playdate_id))];

        // Also include ones this household organized (may not have a self-invite row).
        const { data: hosted } = await supabase
          .from("playdates")
          .select("id")
          .eq("organizer_household_id", hhId);
        const hostedIds = (hosted || []).map((p) => p.id);
        const allPdIds = [...new Set([...invitedIds, ...hostedIds])];

        let playdateEvents = [];
        if (allPdIds.length > 0) {
          const { data: pds } = await supabase
            .from("playdates")
            .select("id, proposed_date, location_name, event_type, title, status, organizer_household_id")
            .in("id", allPdIds);
          playdateEvents = (pds || [])
            .filter((p) => p.status !== "cancelled" && p.proposed_date)
            .map((p) => {
              const isBday = p.event_type === "birthday";
              return {
                kind: isBday ? "birthday_party" : "playdate",
                date: p.proposed_date,
                label: isBday
                  ? "Birthday celebration"
                  : (p.location_name ? `Playdate at ${p.location_name}` : "Playdate"),
                hosted: p.organizer_household_id === hhId,
              };
            });
        }

        // 3) The household's own birthday (generic recurring marker, no year stored).
        const { data: bdays } = await supabase
          .from("household_birthdays")
          .select("month, day")
          .eq("household_id", hhId);
        const householdBdays = (bdays || []).map((b) => ({
          month: b.month,
          monthName: MONTHS[(b.month || 1) - 1] || "",
        }));

        // ---- Assemble per-year buckets ----
        const byYear = {};
        const ensureYear = (label) => {
          if (!byYear[label]) byYear[label] = { year: label, classrooms: [], events: [] };
          return byYear[label];
        };

        for (const m of (memberships || [])) {
          const bucket = ensureYear(m.school_year);
          bucket.classrooms.push({
            teacher: m.classrooms?.teacher_name || "Classroom",
            grade: m.classrooms?.grade,
            school: m.classrooms?.schools?.name || "",
            familyCount: classmateCounts[m.id] || 0,
          });
        }

        // Place playdate/birthday events into the school-year bucket their date falls in.
        // We infer the year label from the event date using the app's boundary.
        for (const ev of playdateEvents) {
          const label = currentSchoolYear(startMonth, new Date(ev.date));
          ensureYear(label).events.push(ev);
        }

        // Recurring household birthday: show each ONCE (not repeated per year).
        // Attach to the most recent year bucket so it appears near the top.
        const yearLabelsSorted = Object.keys(byYear).sort((a, b) => yearNum(b) - yearNum(a));
        const topYear = yearLabelsSorted[0];
        if (topYear) {
          for (const hb of householdBdays) {
            byYear[topYear].events.push({
              kind: "household_birthday",
              sortMonth: hb.month,
              label: `Birthday · ${hb.monthName}`,
            });
          }
        }

        // Sort events within a year (dated ones by date desc; birthday markers last).
        for (const yl of Object.keys(byYear)) {
          byYear[yl].events.sort((a, b) => {
            if (a.date && b.date) return new Date(b.date) - new Date(a.date);
            if (a.date) return -1;
            if (b.date) return 1;
            return 0;
          });
        }

        const ordered = Object.values(byYear).sort((a, b) => yearNum(b.year) - yearNum(a.year));
        setStartMonthState(startMonth);
        setYears(ordered);
      } catch (e) {
        // Best-effort; show whatever assembled.
      }
      setLoading(false);
    })();
  }, [session]);

  const curYear = currentSchoolYear(startMonthState);
  const earliestLabel = years.length > 0 ? years[years.length - 1].year : null;

  const dot = (bg, border, emoji) => (
    <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: bg, border: border ? `1px solid ${border}` : "none", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", zIndex: 1, position: "relative" }}>
      {emoji}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", fontFamily: "system-ui, sans-serif", paddingBottom: "80px" }}>
      <div style={{ background: "#162D50", padding: "1.1rem 1.5rem", borderBottom: "1px solid #2A4A6B" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: "#8AAEC8", fontSize: "0.8rem", cursor: "pointer", padding: "0 0 0.5rem", display: "block" }}>‹ Back</button>
        <h1 style={{ color: "#FFFFFF", fontSize: "1.35rem", fontWeight: "700", margin: 0, letterSpacing: "-0.01em" }}>Your Huddle journey 🌱</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.82rem", margin: "4px 0 0" }}>Your family's path, year by year</p>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "600px", margin: "0 auto", position: "relative" }}>
        {loading ? (
          <p style={{ color: "#607080", textAlign: "center", padding: "2rem" }}>Building your journey...</p>
        ) : years.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 1rem" }}>🌱</p>
            <p style={{ color: "#FFFFFF", fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Your journey starts here</p>
            <p style={{ color: "#607080", fontSize: "0.85rem", lineHeight: "1.5" }}>
              As you add classrooms and set up playdates, they'll appear here as a record of your years on Huddle.
            </p>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: "18px", top: "18px", bottom: "18px", width: "2px", background: "#22355A" }}></div>

            {years.map((yb) => {
              const isCurrent = yb.year === curYear;
              const isEarliest = yb.year === earliestLabel;
              return (
                <div key={yb.year} style={{ marginBottom: "1.25rem" }}>
                  {yb.classrooms.map((c, ci) => (
                    <div key={ci} style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                      {dot(isCurrent ? "#02C39A" : (isEarliest ? "#1B3A5C" : "#1B3A5C"), null, isEarliest ? "🌱" : "🏫")}
                      <div style={{ flex: 1 }}>
                        <p style={{ color: isCurrent ? "#02C39A" : "#8AAEC8", fontSize: "0.72rem", fontWeight: "700", margin: "0 0 4px", letterSpacing: "0.04em" }}>
                          {yb.year}{isCurrent ? " · THIS YEAR" : ""}{isEarliest && !isCurrent ? " · WHERE IT BEGAN" : ""}
                        </p>
                        <div style={{ background: "#162D50", border: `1px solid ${isCurrent ? "#02C39A" : "#22355A"}`, borderRadius: "12px", padding: "0.85rem 1rem" }}>
                          <p style={{ color: "#FFFFFF", fontSize: "1rem", fontWeight: "600", margin: 0 }}>
                            {c.teacher} · {gradeLabel(c.grade)}
                          </p>
                          <p style={{ color: "#607080", fontSize: "0.78rem", margin: "6px 0 0" }}>
                            {isCurrent
                              ? "Just getting started — families appear as they join."
                              : `${c.familyCount} ${c.familyCount === 1 ? "family" : "families"} huddled with${isEarliest ? " · joined Huddle here" : ""}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {yb.events.map((ev, ei) => {
                    const isPlay = ev.kind === "playdate";
                    const isParty = ev.kind === "birthday_party";
                    const emoji = isPlay ? "🧸" : "🎂";
                    const dotBg = isPlay ? "#0F3D2E" : "#2A1E3D";
                    const dotBorder = isPlay ? "#02C39A" : "#7C5CBF";
                    return (
                      <div key={`e${ei}`} style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "0.6rem" }}>
                        {dot(dotBg, dotBorder, emoji)}
                        <div style={{ flex: 1, background: "#132840", borderRadius: "10px", padding: "0.6rem 0.9rem" }}>
                          <p style={{ color: "#B8CCE0", fontSize: "0.85rem", margin: 0 }}>
                            {ev.label}{ev.hosted && (isPlay || isParty) ? " (you hosted)" : ""}
                          </p>
                          {ev.date && (
                            <p style={{ color: "#607080", fontSize: "0.72rem", margin: "2px 0 0" }}>{fmtDate(ev.date)}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}