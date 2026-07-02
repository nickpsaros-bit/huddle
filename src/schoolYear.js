// Shared school-year + rollover timing helpers.
//
// Why this exists: the app previously computed the school year as
// `${year}-${year+1}` off the calendar year, so ALL of 2026 read as
// "2026-2027" even in Jan–July (which is really still 2025-2026). Rollover
// needs a correct boundary anchored to when a school's year actually begins.
//
// Timing is PER-SCHOOL, driven by schools.school_start_month (default 8 =
// August). No external calendar API — deliberately: there's no single free
// source, district variation is huge, and manual rollover is forgiving.

// The month (1-12) a school year begins if we don't know a school's own value.
export const DEFAULT_START_MONTH = 8; // August

// How many weeks before the start month the rollover prompt begins appearing.
export const PROMPT_LEAD_WEEKS = 2;

// Given a start month (1-12) and a date, return the active school-year label
// like "2026-2027". The year "flips" to the new label once we reach the
// start month; before that, we're still in the previous school year.
//
//   startMonth = 8 (Aug):
//     Aug 2026 .. Jul 2027  -> "2026-2027"
//     Jan 2026 .. Jul 2026  -> "2025-2026"
export function currentSchoolYear(startMonth = DEFAULT_START_MONTH, d = new Date()) {
  const sm = clampMonth(startMonth);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  // If we've reached the start month this calendar year, the year that
  // started this year is the current one; otherwise it started last year.
  return m >= sm ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// Rollover timing for a given school. Returns:
//   { promptOpensOn, startsOn, isRolloverSeason }
// - startsOn:      first of the start month, IN THE CURRENT CALENDAR YEAR.
// - promptOpensOn: PROMPT_LEAD_WEEKS before that start.
// - isRolloverSeason: true once we're within the prompt window.
//
// The start month always falls in the current calendar year, so timing
// anchors there. e.g. Jul 10 (Aug school): startsOn = Aug 1 THIS year, and
// the prompt opens ~2 weeks before (mid-July) — not last year's start.
// Rollover season runs from the prompt window through the school year until
// the parent rolls over (shouldPromptRollover also checks rolled_over_year).
export function rolloverTiming(startMonth = DEFAULT_START_MONTH, d = new Date()) {
  const sm = clampMonth(startMonth);
  const y = d.getFullYear();
  const startsOn = new Date(y, sm - 1, 1);
  const promptOpensOn = new Date(startsOn);
  promptOpensOn.setDate(promptOpensOn.getDate() - PROMPT_LEAD_WEEKS * 7);
  return {
    promptOpensOn,
    startsOn,
    isRolloverSeason: d >= promptOpensOn,
  };
}

// Should we prompt this parent to roll over? True when we're in rollover
// season for the school AND the parent hasn't completed rollover for the
// current school year.
//   rolledOverYear: value of parents.rolled_over_year (string | null)
export function shouldPromptRollover(rolledOverYear, startMonth = DEFAULT_START_MONTH, d = new Date()) {
  const { isRolloverSeason } = rolloverTiming(startMonth, d);
  if (!isRolloverSeason) return false;
  return rolledOverYear !== currentSchoolYear(startMonth, d);
}

// For a household in classrooms across multiple schools (multiple kids),
// the earliest start month governs when the prompt first appears — so we
// never miss the earliest-starting school. Pass an array of start months.
export function earliestStartMonth(startMonths = []) {
  const valid = startMonths.map(clampMonth).filter((n) => Number.isFinite(n));
  if (valid.length === 0) return DEFAULT_START_MONTH;
  return Math.min(...valid);
}

function clampMonth(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return DEFAULT_START_MONTH;
  return Math.min(12, Math.max(1, Math.round(n)));
}