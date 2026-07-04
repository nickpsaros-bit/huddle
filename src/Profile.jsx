import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { currentSchoolYear } from "./schoolYear";
import Icon from "./Icon";

export default function Profile({ session, onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Step 1: parent info
  const [parentName, setParentName] = useState("");

  // Step 2: classroom info
  const [grade, setGrade] = useState("");
  const [teacher, setTeacher] = useState("");
  const [schoolSearch, setSchoolSearch] = useState("");
  const [schoolResults, setSchoolResults] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [teacherResults, setTeacherResults] = useState([]);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);

  // Steps 3-5: photo, co-parent, birthdays (all skippable)
  const [householdId, setHouseholdId] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [coParentEmail, setCoParentEmail] = useState("");
  const [coParentMsg, setCoParentMsg] = useState("");
  const [bdayMonth, setBdayMonth] = useState("");
  const [bdayDay, setBdayDay] = useState("");
  const [bdayLabel, setBdayLabel] = useState("");
  const [bdayBusy, setBdayBusy] = useState(false);
  const [bdayAdded, setBdayAdded] = useState([]);

  const TOTAL_STEPS = 5;

  const grades = ["TK","Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade"];

  // GUARD: if this authenticated user ALREADY has a household, they already have
  // an account — do NOT let them run signup again (which would create a duplicate
  // household). Send them straight into the app.
  useEffect(() => {
    let cancelled = false;
    const checkExisting = async () => {
      try {
        const { data: hm } = await supabase
          .from("household_members")
          .select("household_id")
          .eq("parent_id", session.user.id)
          .maybeSingle();
        if (!cancelled && hm) {
          // Already set up — skip signup entirely.
          onComplete();
          return;
        }
      } catch (e) {
        // If the check fails, fall through to signup (safe default) but don't crash.
      }
      if (!cancelled) setCheckingExisting(false);
    };
    checkExisting();
    return () => { cancelled = true; };
  }, []);

  // Name validation: reject emails, junk, too-short. Returns an error string or "".
  const validateName = (raw) => {
    const name = (raw || "").trim();
    if (name.length < 2) return "Please enter your name.";
    if (/@/.test(name) || /\S+@\S+\.\S+/.test(name)) {
      return "That looks like an email. Please enter your name (e.g. Jane Smith).";
    }
    if (/^\d+$/.test(name)) return "Please enter your name, not just numbers.";
    if (/https?:\/\//i.test(name)) return "Please enter your name.";
    return "";
  };

  const searchSchools = async (query) => {
    setSchoolSearch(query);
    setSelectedSchool(null);
    setTeacherResults([]);
    setTeacher("");
    if (query.length < 2) { setSchoolResults([]); setShowSchoolDropdown(false); return; }
    // Normalize: drop common noise words + punctuation so "sun valley",
    // "Sun Valley Elementary", "sun valley school" all surface the same record.
    // This steers users to PICK an existing school instead of creating a near-duplicate.
    const noise = /\b(elementary|elem|school|academy|the|of|charter|primary|middle|high|k-?8|stem)\b/gi;
    const core = query.toLowerCase().replace(noise, "").replace(/[^a-z0-9 ]/g, "").trim();
    const terms = core.split(/\s+/).filter((t) => t.length >= 2);

    // Pull a broad candidate set, then rank by how many query terms match.
    const { data } = await supabase
      .from("schools")
      .select("*")
      .ilike("name", `%${(terms[0] || query).slice(0, 20)}%`)
      .limit(25);

    let ranked = (data || []);
    if (terms.length > 0) {
      ranked = ranked
        .map((s) => {
          const n = (s.name || "").toLowerCase();
          const hits = terms.filter((t) => n.includes(t)).length;
          return { s, hits };
        })
        .filter((r) => r.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .map((r) => r.s);
    }
    setSchoolResults(ranked.slice(0, 6));
    setShowSchoolDropdown(true);
  };

  const selectSchool = async (school) => {
    setSelectedSchool(school);
    setSchoolSearch(school.name);
    setShowSchoolDropdown(false);
    const { data } = await supabase.from("classrooms").select("teacher_name").eq("school_id", school.id).limit(20);
    const unique = [...new Set((data || []).map(c => c.teacher_name))];
    setTeacherResults(unique);
  };

  const teacherMismatch = teacherResults.length > 0 && teacher &&
    !teacherResults.find(t => t.toLowerCase() === teacher.toLowerCase());

  const saveStep1 = async () => {
    const nameError = validateName(parentName);
    if (nameError) { setError(nameError); return; }
    setLoading(true);
    setError("");
    try {
      const { error: parentErr } = await supabase.from("parents").upsert({
        id: session.user.id,
        name: parentName.trim(),
      });
      if (parentErr) throw parentErr;
      setStep(2);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const saveStep2 = async () => {
    setLoading(true);
    setError("");
    try {
      // DUPLICATE GUARD: re-check for an existing household right before creating one.
      // If the user already has a household (e.g. double-submit, or they got here
      // via a stale state), do NOT create a second one — just enter the app.
      const { data: existingHh } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .maybeSingle();
      if (existingHh) {
        onComplete();
        return;
      }

      const schoolYear = currentSchoolYear();

      // ATOMIC SIGNUP: one server-side transaction does the whole chain —
      // find-or-create school + classroom, create household, add primary member,
      // add classroom membership, write welcome notification. All-or-nothing, so
      // a half-failed signup can't leave orphan rows (critical once RLS is on).
      // The function find-or-creates the classroom on teacher+grade+year using the
      // same normalization as the unique index, so casing/spacing won't duplicate.
      //
      // Pass either an existing school id, or a name to create a new school.
      const { error: rpcErr } = await supabase.rpc("signup_atomic", {
        p_school_id: selectedSchool ? selectedSchool.id : null,
        p_school_name: selectedSchool ? null : schoolSearch.trim(),
        p_teacher_name: teacher,
        p_grade: grades.indexOf(grade),
        p_school_year: schoolYear,
      });

      if (rpcErr) {
        // The function raises 'User already has a household' if a household exists.
        // Treat that as "already done" rather than an error — just enter the app.
        if ((rpcErr.message || "").toLowerCase().includes("already has a household")) {
          onComplete();
          return;
        }
        throw rpcErr;
      }

      // Household now exists — grab its id for the skippable steps (photo/co-parent/
      // birthdays), then advance the wizard instead of dumping into the app.
      const { data: hm } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("parent_id", session.user.id)
        .maybeSingle();
      if (hm) setHouseholdId(hm.household_id);
      setStep(3);

    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `${session.user.id}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
      await supabase.from("parents").update({ photo_url: cacheBustedUrl }).eq("id", session.user.id);
      setPhotoUrl(cacheBustedUrl);
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  };

  const inviteCoParent = async () => {
    const email = coParentEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setCoParentMsg("Please enter a valid email."); return; }
    setCoParentMsg("");
    try {
      // Lightweight: send a co-parent invite by email (they'll link on signup).
      // Full co-parent linking also lives in Profile later.
      await supabase.functions.invoke("send-invite", {
        body: { email, inviter_id: session.user.id, kind: "coparent" },
      }).catch(() => {});
      setCoParentMsg(`Invite sent to ${email}! They can join your household when they sign up.`);
      setCoParentEmail("");
    } catch (e) {
      setCoParentMsg("Couldn't send the invite, but you can add a co-parent later in your profile.");
    }
  };

  const addBirthdayInline = async () => {
    const m = parseInt(bdayMonth, 10);
    const d = parseInt(bdayDay, 10);
    if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) { setError("Please pick a valid month and day."); return; }
    if (!householdId) return;
    setBdayBusy(true);
    setError("");
    try {
      const { error: bErr } = await supabase.from("household_birthdays").insert({
        household_id: householdId,
        month: m, day: d,
        label: bdayLabel.trim() || null,
      });
      if (bErr) throw bErr;
      setBdayAdded((prev) => [...prev, { month: m, day: d, label: bdayLabel.trim() }]);
      setBdayMonth(""); setBdayDay(""); setBdayLabel("");
    } catch (err) {
      setError(err.message);
    }
    setBdayBusy(false);
  };

  const inputStyle = {
    width: "100%", padding: "0.85rem 1rem", borderRadius: "10px",
    border: "1px solid #2A4A6B", background: "#0F2044", color: "#FFFFFF",
    fontSize: "1rem", marginBottom: "1rem", boxSizing: "border-box"
  };

  // While we check whether this user already has an account, show a neutral loader
  // (prevents a flash of the signup form for existing users).
  if (checkingExisting) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#02C39A", fontSize: "1.2rem" }}>Huddle</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0F2044", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: "1.5rem" }}>
      <div style={{ width: "100%", maxWidth: "440px" }}>

        <h1 style={{ color: "#02C39A", fontSize: "2rem", fontWeight: "700", margin: "0 0 0.5rem", textAlign: "center" }}>Huddle</h1>
        <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 2rem", textAlign: "center" }}>The social app for school families</p>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "2rem", justifyContent: "center" }}>
          {[1, 2, 3, 4, 5].map(n => (
            <div key={n} style={{
              width: step >= n ? "32px" : "8px",
              height: "8px",
              borderRadius: "4px",
              background: step >= n ? "#02C39A" : "#2A4A6B",
              transition: "all 0.3s"
            }} />
          ))}
        </div>

        {/* Step 1: Parent info */}
        {step === 1 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Welcome!</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Let's get to know you. What's your name?</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Your full name</label>
            <input type="text" placeholder="Jane Smith" value={parentName}
              onChange={(e) => { setParentName(e.target.value); if (error) setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && parentName && saveStep1()}
              style={inputStyle} />

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={saveStep1} disabled={!parentName || loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
                background: !parentName ? "#2A4A6B" : "#02C39A", color: "#0F2044",
                fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginTop: "0.5rem" }}>
              {loading ? "Saving..." : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 2: Classroom info */}
        {step === 2 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Add a classroom</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Tell us about your child's classroom. You can add more later.</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Grade</label>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} style={inputStyle}>
              <option value="">Select grade...</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>School name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text" placeholder="Start typing school name..." value={schoolSearch}
                onChange={(e) => searchSchools(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }} />
              {showSchoolDropdown && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10 }}>
                  {schoolResults.length > 0 && (
                    <div style={{ padding: "0.5rem 1rem 0.25rem", color: "#8AAEC8", fontSize: "0.72rem", fontWeight: "600" }}>
                      Is your school one of these? Tap to select it.
                    </div>
                  )}
                  {schoolResults.map(school => (
                    <div key={school.id} onClick={() => selectSchool(school)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      <Icon name="school" size={18} color="#B8CCE0" style={{ verticalAlign: "-3px", marginRight: 4 }} />{school.name}
                    </div>
                  ))}
                  <div onClick={() => { setSelectedSchool(null); setShowSchoolDropdown(false); }}
                    style={{ padding: "0.75rem 1rem", cursor: "pointer", color: schoolResults.length > 0 ? "#607080" : "#02C39A", fontSize: "0.82rem", fontWeight: schoolResults.length > 0 ? "400" : "600" }}>
                    {schoolResults.length > 0
                      ? `Not listed? + Add "${schoolSearch}" as new`
                      : `+ Add "${schoolSearch}" as a new school`}
                  </div>
                </div>
              )}
            </div>

            {selectedSchool && (
              <div style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
                <span style={{ color: "#02C39A", fontSize: "0.85rem" }}><Icon name="check" size={16} color="#02C39A" style={{ verticalAlign: "-2px", marginRight: 2 }} />{selectedSchool.name}</span>
              </div>
            )}

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Teacher's name</label>
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input type="text"
                placeholder={teacherResults.length > 0 ? "Select or type teacher name..." : "Mrs. Johnson"}
                value={teacher}
                onChange={(e) => { setTeacher(e.target.value); setShowTeacherDropdown(e.target.value.length > 0); }}
                onFocus={() => { if (teacherResults.length > 0) setShowTeacherDropdown(true); }}
                style={{ ...inputStyle, marginBottom: 0, borderColor: teacherMismatch ? "#854F0B" : "#2A4A6B" }} />
              {showTeacherDropdown && teacherResults.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1A3A5C", borderRadius: "0 0 10px 10px", border: "1px solid #2A4A6B", borderTop: "none", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
                  {teacherResults.filter(t => t.toLowerCase().includes(teacher.toLowerCase())).map(t => (
                    <div key={t} onClick={() => { setTeacher(t); setShowTeacherDropdown(false); }}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#FFFFFF", fontSize: "0.9rem", borderBottom: "1px solid #2A4A6B" }}>
                      <Icon name="menu_book" size={18} color="#B8CCE0" style={{ verticalAlign: "-3px", marginRight: 4 }} />{t}
                    </div>
                  ))}
                  {teacherMismatch && (
                    <div onClick={() => setShowTeacherDropdown(false)}
                      style={{ padding: "0.75rem 1rem", cursor: "pointer", color: "#8AAEC8", fontSize: "0.85rem", borderTop: "1px solid #2A4A6B" }}>
                      + Add "{teacher}" as a new teacher
                    </div>
                  )}
                </div>
              )}
            </div>

            {teacherMismatch && (
              <div style={{ background: "#3D1F0A", border: "1px solid #854F0B", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "1rem", marginTop: "-0.5rem" }}>
                <p style={{ color: "#F59E0B", fontSize: "0.8rem", margin: 0 }}>
                  <Icon name="warning" size={16} color="#F5A623" style={{ verticalAlign: "-3px", marginRight: 4 }} />This teacher isn't in our system yet. Double-check spelling or select from the list above.
                </p>
              </div>
            )}

            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={saveStep2} disabled={!grade || !schoolSearch || !teacher || loading}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none",
                background: (!grade || !schoolSearch || !teacher) ? "#2A4A6B" : "#02C39A",
                color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer" }}>
              {loading ? "Saving..." : "Continue →"}
            </button>
          </div>
        )}

        {/* Step 3: Profile photo (skippable) */}
        {step === 3 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Add a photo</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>A photo helps other families recognize you. You can always add one later.</p>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
              <label style={{ cursor: "pointer" }}>
                <div style={{ width: "120px", height: "120px", borderRadius: "50%", background: "#162D50", border: "2px dashed #2A4A6B", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {photoUrl ? (
                    <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Icon name="add_a_photo" size={36} color="#4A5D78" />
                  )}
                </div>
                <input type="file" accept="image/*" onChange={uploadPhoto} style={{ display: "none" }} />
              </label>
            </div>
            {uploading && <p style={{ color: "#8AAEC8", fontSize: "0.85rem", textAlign: "center", marginBottom: "1rem" }}>Uploading...</p>}
            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem", textAlign: "center" }}>{error}</p>}

            <button onClick={() => { setError(""); setStep(4); }}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem" }}>
              Continue →
            </button>
            <button onClick={() => { setError(""); setStep(4); }}
              style={{ width: "100%", padding: "0.6rem", borderRadius: "10px", border: "none", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
              Skip for now
            </button>
          </div>
        )}

        {/* Step 4: Co-parent (skippable) */}
        {step === 4 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Add a co-parent?</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>If you share parenting with a partner, invite them to your household so you're both in the loop. Optional — you can do this anytime.</p>

            <label style={{ color: "#8AAEC8", fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>Co-parent's email</label>
            <input type="email" placeholder="partner@email.com" value={coParentEmail}
              onChange={(e) => { setCoParentEmail(e.target.value); setCoParentMsg(""); }}
              style={inputStyle} />
            {coParentMsg && <p style={{ color: "#02C39A", fontSize: "0.82rem", marginBottom: "1rem" }}>{coParentMsg}</p>}

            <button onClick={inviteCoParent} disabled={!coParentEmail}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: coParentEmail ? "#02C39A" : "#2A4A6B", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: coParentEmail ? "pointer" : "not-allowed", marginBottom: "0.75rem" }}>
              Send invite
            </button>
            <button onClick={() => { setError(""); setStep(5); }}
              style={{ width: "100%", padding: "0.6rem", borderRadius: "10px", border: "none", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
              {coParentMsg ? "Continue →" : "Skip for now"}
            </button>
          </div>
        )}

        {/* Step 5: Birthdays (skippable) */}
        {step === 5 && (
          <div>
            <h2 style={{ color: "#FFFFFF", fontSize: "1.3rem", fontWeight: "500", margin: "0 0 0.5rem" }}>Add a birthday 🎂</h2>
            <p style={{ color: "#8AAEC8", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>Add your family's birthday so your network can celebrate. Just the month and day — no year needed.</p>

            {bdayAdded.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                {bdayAdded.map((b, i) => (
                  <div key={i} style={{ background: "#0F3D2E", border: "1px solid #02C39A", borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "0.5rem" }}>
                    <span style={{ color: "#02C39A", fontSize: "0.85rem" }}>🎂 {b.label ? b.label + " — " : ""}{["","January","February","March","April","May","June","July","August","September","October","November","December"][b.month]} {b.day}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginBottom: "1rem" }}>
              <select value={bdayMonth} onChange={(e) => setBdayMonth(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
                <option value="">Month</option>
                {["January","February","March","April","May","June","July","August","September","October","November","December"].map((mn, i) => (
                  <option key={mn} value={i + 1}>{mn}</option>
                ))}
              </select>
              <input type="number" min="1" max="31" placeholder="Day" value={bdayDay}
                onChange={(e) => setBdayDay(e.target.value)} style={{ ...inputStyle, marginBottom: 0, width: "90px" }} />
            </div>
            <input type="text" placeholder="Whose birthday? (optional, e.g. 'Emma')" value={bdayLabel}
              onChange={(e) => setBdayLabel(e.target.value)} style={inputStyle} />
            {error && <p style={{ color: "#F87171", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</p>}

            <button onClick={addBirthdayInline} disabled={!bdayMonth || !bdayDay || bdayBusy}
              style={{ width: "100%", padding: "0.75rem", borderRadius: "10px", border: "1px solid #02C39A", background: "transparent", color: "#02C39A", fontSize: "0.92rem", fontWeight: "600", cursor: (!bdayMonth || !bdayDay) ? "not-allowed" : "pointer", marginBottom: "1rem", opacity: (!bdayMonth || !bdayDay) ? 0.5 : 1 }}>
              {bdayBusy ? "Adding..." : "+ Add birthday"}
            </button>

            <button onClick={onComplete}
              style={{ width: "100%", padding: "0.85rem", borderRadius: "10px", border: "none", background: "#02C39A", color: "#0F2044", fontSize: "1rem", fontWeight: "600", cursor: "pointer", marginBottom: "0.75rem" }}>
              {bdayAdded.length > 0 ? "All set — enter Huddle →" : "Finish →"}
            </button>
            {bdayAdded.length === 0 && (
              <button onClick={onComplete}
                style={{ width: "100%", padding: "0.6rem", borderRadius: "10px", border: "none", background: "transparent", color: "#8AAEC8", fontSize: "0.9rem", cursor: "pointer" }}>
                Skip for now
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}