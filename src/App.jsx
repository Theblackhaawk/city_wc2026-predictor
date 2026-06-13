import { useState, useEffect, useCallback } from "react";
import "./App.css";

// ── Config ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://nkqavfpbwdaqmzkcsufx.supabase.co";
const SUPABASE_KEY = "sb_publishable_-zcCan8Yn75xr1RtVzNHPA_REQuFXwo";
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
const SCORES_API = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const FOOTBALL_API_KEY = "";
const DEFAULT_RESET_PASSWORD = "1234";

// ── Password hashing ───────────────────────────────────────────────────────────
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password + "wc2026_salt_citybank");
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Supabase client ────────────────────────────────────────────────────────────
const sb = {
  async query(path, opts = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: opts.prefer || "return=representation",
        ...opts.headers,
      },
      ...opts,
    });
    if (!res.ok) { const err = await res.text(); throw new Error(err); }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  },
  get: (t, p = "") => sb.query(`${t}?${p}`),
  post: (t, b) => sb.query(t, { method: "POST", body: JSON.stringify(b) }),
  patch: (t, p, b) => sb.query(`${t}?${p}`, { method: "PATCH", body: JSON.stringify(b), prefer: "return=representation" }),
  upsert: (t, b) => sb.query(t, { method: "POST", body: JSON.stringify(b), prefer: "resolution=merge-duplicates,return=representation" }),
};

// ── Device fingerprint ─────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem("wc_device_id");
  if (!id) { id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("wc_device_id", id); }
  return id;
}
function getFingerprint() {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  ctx.textBaseline = "top"; ctx.font = "14px Arial"; ctx.fillText("WC2026", 2, 2);
  return [navigator.userAgent, navigator.language, screen.width + "x" + screen.height, new Date().getTimezoneOffset(), c.toDataURL().slice(-40)].join("|");
}
function parseUA(ua) {
  if (/iPhone|iPad/.test(ua)) return "📱 iOS";
  if (/Android/.test(ua)) return "📱 Android";
  if (/Windows/.test(ua)) return "💻 Windows";
  if (/Mac/.test(ua)) return "💻 Mac";
  return "🖥️ Other";
}
function parseBrowser(ua) {
  if (/Edg/.test(ua)) return "Edge";
  if (/Chrome/.test(ua)) return "Chrome";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Safari/.test(ua)) return "Safari";
  return "Unknown";
}

// ── Session ────────────────────────────────────────────────────────────────────
const getSession = () => { try { return JSON.parse(localStorage.getItem("wc_session")); } catch { return null; } };
const setSession = (s) => localStorage.setItem("wc_session", JSON.stringify(s));
const clearSession = () => localStorage.removeItem("wc_session");

// ── Audit ──────────────────────────────────────────────────────────────────────
async function audit(empId, action, detail = "") {
  try { await sb.post("audit_log", { emp_id: empId, action, detail }); } catch {}
}

// ── Flags ──────────────────────────────────────────────────────────────────────
const FLAGS = {
  "Mexico":"🇲🇽","USA":"🇺🇸","United States":"🇺🇸","Canada":"🇨🇦","Argentina":"🇦🇷",
  "Brazil":"🇧🇷","France":"🇫🇷","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Germany":"🇩🇪","Spain":"🇪🇸",
  "Portugal":"🇵🇹","Netherlands":"🇳🇱","Belgium":"🇧🇪","Italy":"🇮🇹","Croatia":"🇭🇷",
  "Morocco":"🇲🇦","Japan":"🇯🇵","South Korea":"🇰🇷","Australia":"🇦🇺","Senegal":"🇸🇳",
  "Ghana":"🇬🇭","Nigeria":"🇳🇬","Algeria":"🇩🇿","Egypt":"🇪🇬","Saudi Arabia":"🇸🇦",
  "Iran":"🇮🇷","Qatar":"🇶🇦","Poland":"🇵🇱","Serbia":"🇷🇸","Switzerland":"🇨🇭",
  "Denmark":"🇩🇰","Sweden":"🇸🇪","Norway":"🇳🇴","Austria":"🇦🇹","Türkiye":"🇹🇷",
  "Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","Uruguay":"🇺🇾","Colombia":"🇨🇴","Ecuador":"🇪🇨",
  "Venezuela":"🇻🇪","Peru":"🇵🇾","Panama":"🇵🇦","Costa Rica":"🇨🇷","Jamaica":"🇯🇲",
  "Côte d'Ivoire":"🇨🇮","Tunisia":"🇹🇳","South Africa":"🇿🇦","Congo DR":"🇨🇩",
  "Iraq":"🇮🇶","Jordan":"🇯🇴","Uzbekistan":"🇺🇿","New Zealand":"🇳🇿",
  "Bosnia and Herzegovina":"🇧🇦","Czechia":"🇨🇿","Cape Verde":"🇨🇻",
};
const flag = (n) => FLAGS[n] || "🏳️";

// ── Scoring ────────────────────────────────────────────────────────────────────
function scoreOutcome(h, a) { return h > a ? "home" : a > h ? "away" : "draw"; }
function calcPoints(pred, match) {
  if (match.status !== "completed") return null;
  const hs = match.home_score, as = match.away_score;
  if (hs == null || as == null) return null;
  let pts = 0;
  if (pred.outcome === scoreOutcome(hs, as)) pts++;
  if (parseInt(pred.home_score) === hs && parseInt(pred.away_score) === as) pts++;
  return pts;
}

// ── Match normalise ────────────────────────────────────────────────────────────
// Playoff winner name corrections (openfootball uses placeholder names)
const TEAM_FIXES = {
  "UEFA Path A winner": "Bosnia and Herzegovina",
  "UEFA Path B winner": "Sweden",
  "UEFA Path C winner": "Türkiye",
  "UEFA Path D winner": "Czechia",
  "IC Path 1 winner": "DR Congo",
  "IC Path 2 winner": "Iraq",
};
function fixTeam(name) { return TEAM_FIXES[name] || name; }

function normalise(m, idx) {
  // openfootball format: { team1, team2, date, time, group, score: { ft: [h, a] }, round }
  const home = fixTeam(m.team1 || "TBD");
  const away = fixTeam(m.team2 || "TBD");
  // Convert "13:00 UTC-6" to proper UTC ISO datetime
  let dt = "";
  if (m.date) {
    if (m.time) {
      const raw = m.time.trim();
      const parts = raw.split(" ");
      const localTime = parts[0]; // "13:00"
      const offsetStr = parts[1] || "UTC+0"; // "UTC-6"
      const offsetMatch = offsetStr.match(/UTC([+-]\d+)/);
      const offset = offsetMatch ? parseInt(offsetMatch[1]) : 0;
      const hh = parseInt(localTime.split(":")[0]);
      const mm = parseInt(localTime.split(":")[1]);
      let utcH = hh - offset;
      if (utcH >= 24) utcH -= 24;
      if (utcH < 0) utcH += 24;
      dt = m.date + "T" + String(utcH).padStart(2,"0") + ":" + String(mm).padStart(2,"0") + ":00Z";
    } else {
      dt = m.date + "T00:00:00Z";
    }
  }
  const hasScore = m.score && m.score.ft && m.score.ft.length === 2;
  const hs = hasScore ? m.score.ft[0] : null;
  const as_ = hasScore ? m.score.ft[1] : null;
  const done = hasScore;
  const group = m.group ? m.group.replace("Group ","") : "";
  const round = m.round || "";
  const stageLabel = round.includes("Round of 16") || round.includes("Last 16") ? "Round of 16"
    : round.includes("Quarter") ? "Quarter Final"
    : round.includes("Semi") ? "Semi Final"
    : round.includes("Final") && !round.includes("Semi") && !round.includes("Third") ? "Final"
    : round.includes("Third") || round.includes("3rd") ? "3rd Place"
    : "Group Stage";
  return {
    id: String(idx + 1),
    home, away, datetime: dt,
    home_score: done ? hs : null,
    away_score: done ? as_ : null,
    status: done ? "completed" : "scheduled",
    stage: stageLabel,
    group,
  };
}

// ── Time helpers ───────────────────────────────────────────────────────────────
function isPredOpen(dt) {
  if (!dt) return true;
  const ko = new Date(dt);
  return isNaN(ko) ? true : Date.now() < ko.getTime() - 15 * 60 * 1000;
}
function fmtTime(dt) {
  if (!dt) return "TBD";
  const d = new Date(dt);
  if (isNaN(d)) return dt;
  // Convert to BDT (UTC+6)
  const bdt = new Date(d.getTime() + 6 * 60 * 60 * 1000);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = months[bdt.getUTCMonth()];
  const day = bdt.getUTCDate();
  let hours = bdt.getUTCHours();
  const minutes = String(bdt.getUTCMinutes()).padStart(2,"0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${month} ${day}, ${hours}:${minutes} ${ampm} BDT`;
}
function countdownStr(dt) {
  if (!dt) return null;
  const diff = new Date(dt) - Date.now();
  if (diff <= 0 || diff > 72 * 3600000) return null;
  const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function timeAgo(dt) {
  const diff = Date.now() - new Date(dt);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}


// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, []);
  return <div className="toast">{msg}</div>;
}

// ══════════════════════════════════════════════════════════════════════════════
// FORCE PASSWORD CHANGE SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function ForcePasswordChange({ user, onDone }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErr("");
    if (pw.length < 4) { setErr("Password must be at least 4 characters."); return; }
    if (pw === DEFAULT_RESET_PASSWORD) { setErr("Please choose a different password than the default."); return; }
    if (pw !== confirm) { setErr("Passwords don't match."); return; }
    setLoading(true);
    try {
      const hash = await hashPassword(pw);
      await sb.patch("users", `emp_id=eq.${user.empId}`, { password_hash: hash });
      await audit(user.empId, "pw_change", "Changed password after reset");
      onDone();
    } catch { setErr("Something went wrong. Please try again."); }
    setLoading(false);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">🔑</div>
        <div className="auth-title">Set New Password</div>
        <div className="auth-sub">Your password was reset by admin. Please set a new one to continue.</div>
        <div className="info-box">⚠️ You cannot use <strong>1234</strong> as your password. Choose something personal.</div>
        <div className="field">
          <label>New Password (min. 4 characters)</label>
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} value={pw}
              onChange={e => setPw(e.target.value)} placeholder="Enter new password"
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
            <button className="pw-eye" onClick={() => setShowPw(p => !p)} type="button">{showPw ? "🙈" : "👁️"}</button>
          </div>
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} value={confirm}
              onChange={e => setConfirm(e.target.value)} placeholder="Repeat password"
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          {confirm && pw !== confirm && <div style={{fontSize:11,color:"var(--red)",marginTop:3}}>Passwords don't match</div>}
          {confirm && pw === confirm && pw.length >= 4 && <div style={{fontSize:11,color:"var(--green)",marginTop:3}}>✓ Passwords match</div>}
        </div>
        {err && <div className="err-box">⚠️ {err}</div>}
        <button className="auth-submit" onClick={submit} disabled={loading}>
          {loading ? "⏳ Saving..." : "SET PASSWORD & CONTINUE"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════════
function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() { setErr(""); setPassword(""); setConfirmPw(""); setName(""); }

  async function submit() {
    setErr(""); setLoading(true);
    const id = empId.trim().toUpperCase();
    if (!id) { setErr("Employee ID is required."); setLoading(false); return; }
    if (!password) { setErr("Password is required."); setLoading(false); return; }
    try {
      if (mode === "signup") {
        if (!name.trim()) { setErr("Full name is required."); setLoading(false); return; }
        if (password.length < 4) { setErr("Password must be at least 4 characters."); setLoading(false); return; }
        if (password !== confirmPw) { setErr("Passwords don't match."); setLoading(false); return; }
        const existing = await sb.get("users", `emp_id=eq.${id}`);
        if (existing.length > 0) { setErr("This Employee ID is already registered."); setLoading(false); return; }
        const deviceId = getDeviceId();
        const devCheck = await sb.get("sessions", `device_id=eq.${deviceId}&select=emp_id`);
        if (devCheck.length > 0 && devCheck[0].emp_id !== id) {
          setErr(`This device is already registered to another employee (${devCheck[0].emp_id}).`);
          setLoading(false); return;
        }
        const hash = await hashPassword(password);
        await sb.post("users", { emp_id: id, name: name.trim(), password_hash: hash });
        await sb.post("sessions", { emp_id: id, device_id: deviceId, fingerprint: getFingerprint(), user_agent: navigator.userAgent });
        await audit(id, "signup", `New registration: ${name.trim()}`);
        setSession({ empId: id, name: name.trim() });
        onLogin({ empId: id, name: name.trim(), needsPwChange: false });
      } else {
        const rows = await sb.get("users", `emp_id=eq.${id}`);
        if (rows.length === 0) { setErr("Employee ID not found. Please sign up first."); setLoading(false); return; }
        const hash = await hashPassword(password);
        if (rows[0].password_hash !== hash) {
          await audit(id, "login_failed", `Wrong password — ${parseUA(navigator.userAgent)}`);
          setErr("Incorrect password."); setLoading(false); return;
        }
        const deviceId = getDeviceId();
        await sb.post("sessions", { emp_id: id, device_id: deviceId, fingerprint: getFingerprint(), user_agent: navigator.userAgent });
        await audit(id, "login", `Signed in — ${parseUA(navigator.userAgent)} / ${parseBrowser(navigator.userAgent)}`);
        const needsPwChange = password === DEFAULT_RESET_PASSWORD;
        setSession({ empId: id, name: rows[0].name });
        onLogin({ empId: id, name: rows[0].name, needsPwChange });
      }
    } catch (e) { setErr("Something went wrong. Please try again."); console.error(e); }
    setLoading(false);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">⚽</div>
        <div className="auth-title">WC 2026</div>
        <div className="auth-sub">CITY BANK · OFFICE PREDICTION LEAGUE</div>
        <div className="field">
          <label>Employee ID</label>
          <input value={empId} onChange={e => setEmpId(e.target.value)} placeholder="e.g. CB-10042"
            onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
        </div>
        {mode === "signup" && (
          <div className="field">
            <label>Full Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name"
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
        )}
        <div className="field">
          <label>Password {mode === "signup" ? "(min. 4 characters)" : ""}</label>
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Create a password" : "Your password"}
              onKeyDown={e => e.key === "Enter" && submit()} />
            <button className="pw-eye" onClick={() => setShowPw(p => !p)} type="button">{showPw ? "🙈" : "👁️"}</button>
          </div>
        </div>
        {mode === "signup" && (
          <div className="field">
            <label>Confirm Password</label>
            <div className="pw-wrap">
              <input type={showPw ? "text" : "password"} value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)} placeholder="Repeat password"
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            {confirmPw && password !== confirmPw && <div style={{fontSize:11,color:"var(--red)",marginTop:3}}>Passwords don't match</div>}
            {confirmPw && password === confirmPw && <div style={{fontSize:11,color:"var(--green)",marginTop:3}}>✓ Passwords match</div>}
          </div>
        )}
        {err && <div className="err-box">⚠️ {err}</div>}
        <button className="auth-submit" onClick={submit} disabled={loading}>
          {loading ? "⏳ Please wait..." : mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>
        <div className="auth-toggle">
          {mode === "login"
            ? <>First time? <span onClick={() => { setMode("signup"); reset(); }}>Create account</span></>
            : <>Already registered? <span onClick={() => { setMode("login"); reset(); }}>Sign in</span></>}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MATCH CARD
// ══════════════════════════════════════════════════════════════════════════════
function MatchCard({ match, user, myPred, isAdmin, onScoreOverride, onToast }) {
  const [outcome, setOutcome] = useState(myPred?.outcome || "");
  const [hs, setHs] = useState(myPred?.home_score ?? "");
  const [as, setAs] = useState(myPred?.away_score ?? "");
  const [saved, setSaved] = useState(!!myPred);
  const [saving, setSaving] = useState(false);
  const [oHs, setOHs] = useState(match.home_score ?? "");
  const [oAs, setOAs] = useState(match.away_score ?? "");
  const open = isPredOpen(match.datetime);
  const isLive = match.status === "live";
  const isDone = match.status === "completed";
  const cd = countdownStr(match.datetime);
  const closingSoon = cd && !cd.includes("h") && parseInt(cd) <= 30;
  const pts = isDone && myPred ? calcPoints(myPred, match) : null;

  async function savePred() {
    if (!outcome) return;
    setSaving(true);
    try {
      await sb.upsert("predictions", { emp_id: user.empId, match_id: match.id, outcome, home_score: hs === "" ? null : parseInt(hs), away_score: as === "" ? null : parseInt(as) });
      await audit(user.empId, "prediction", `${match.home} vs ${match.away} → ${outcome} (${hs}-${as})`);
      setSaved(true); onToast("✓ Prediction saved!");
    } catch { onToast("❌ Failed to save"); }
    setSaving(false);
  }

  return (
    <div className={`mcard${isLive ? " live" : isDone ? " done" : ""}`}>
      <div className="mcard-top">
        <span>
          {isLive && <span className="live-pill"><span className="pulse" />LIVE</span>}
          {!isLive && (isDone ? "FULL TIME" : (match.stage || "Group Stage"))}
          {match.group ? ` · Group ${match.group}` : ""}
        </span>
        <span>{fmtTime(match.datetime)}</span>
      </div>
      <div className="mcard-body">
        <div className="team"><div className="tflag">{flag(match.home)}</div><div className="tname">{match.home}</div></div>
        <div className="scorebox">
          {(isLive || isDone) && match.home_score != null
            ? <div className="score-num">{match.home_score}<span style={{color:"var(--muted)",fontSize:"0.55em",letterSpacing:0}}> : </span>{match.away_score}</div>
            : <div className="score-vs">VS</div>}
          <div className="score-lbl">{isLive ? "in progress" : isDone ? "final" : ""}</div>
          {cd && !isDone && <div className={`cd-badge${closingSoon ? " warn" : ""}`}>{closingSoon ? "⚠️ " : "⏱ "}{cd}</div>}
        </div>
        <div className="team team-r"><div className="tflag">{flag(match.away)}</div><div className="tname">{match.away}</div></div>
      </div>
      <div className="mcard-foot">
        {open && !isDone && (
          <div className="pred-ui">
            <div className="out-btns">
              {[["home","h",match.home.split(" ")[0]],["draw","d","Draw"],["away","a",match.away.split(" ")[0]]].map(([v,cls,lbl]) => (
                <button key={v} className={`out-btn${outcome===v?` sel ${cls}`:""}`} onClick={() => { setOutcome(v); setSaved(false); }}>{lbl}</button>
              ))}
            </div>
            <div className="score-inp-wrap">
              <input className="sinp" type="number" min="0" max="20" value={hs} onChange={e => { setHs(e.target.value); setSaved(false); }} placeholder="0" />
              <span className="sep">-</span>
              <input className="sinp" type="number" min="0" max="20" value={as} onChange={e => { setAs(e.target.value); setSaved(false); }} placeholder="0" />
            </div>
            <button className="btn btn-gold btn-sm" onClick={savePred} disabled={!outcome || saving}>
              {saving ? "..." : saved ? "✓ Saved" : "Save"}
            </button>
          </div>
        )}
        {!open && !isDone && <div className="locked-msg">🔒 Predictions closed (15 min rule)</div>}
        {(isDone || !open) && myPred && (
          <div className="pred-existing">Your pick: <strong>{myPred.outcome === "home" ? match.home : myPred.outcome === "away" ? match.away : "Draw"}</strong> ({myPred.home_score ?? "?"}-{myPred.away_score ?? "?"})</div>
        )}
        {pts !== null && <span className={`pts-chip pts-${pts}`}>{pts === 2 ? "⭐" : pts === 1 ? "✓" : "✗"} {pts} pt{pts !== 1 ? "s" : ""}</span>}
        {isDone && !myPred && <span className="pts-chip pts-0">No prediction</span>}
        {isAdmin && (
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto"}}>
            <span style={{fontSize:10,color:"var(--muted)"}}>SCORE:</span>
            <input className="sinp" style={{width:30}} type="number" min="0" max="20" value={oHs} onChange={e=>setOHs(e.target.value)} placeholder="H" />
            <span className="sep">-</span>
            <input className="sinp" style={{width:30}} type="number" min="0" max="20" value={oAs} onChange={e=>setOAs(e.target.value)} placeholder="A" />
            <button className="btn btn-sm" style={{background:"#2d1f00",color:"var(--gold)",border:"1px solid #854d0e",fontSize:11}}
              onClick={() => { if(oHs!==""&&oAs!=="") onScoreOverride(match.id, parseInt(oHs), parseInt(oAs)); }}>Set</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════════
function Leaderboard({ user, matches, allUsers, allPreds }) {
  const completed = matches.filter(m => m.status === "completed");
  const board = allUsers.map(u => {
    let pts = 0, picks = 0;
    completed.forEach(m => {
      const p = allPreds.find(x => x.emp_id === u.emp_id && x.match_id === m.id);
      if (!p) return;
      const e = calcPoints(p, m);
      if (e !== null) { pts += e; picks++; }
    });
    return { ...u, pts, picks };
  }).sort((a, b) => b.pts - a.pts || b.picks - a.picks);
  const medals = ["🥇","🥈","🥉"], rankCls = ["r1","r2","r3"];
  return (
    <div>
      <div className="page-hd"><div className="page-title">🏆 Leaderboard</div></div>
      <div className="lb">
        <div className="lb-hd">
          <span style={{fontSize:12,color:"var(--muted2)"}}>{board.length} participants</span>
          <span style={{fontSize:11,color:"var(--muted)"}}>2 pts max per match</span>
        </div>
        {board.length === 0 && <div className="empty">No participants yet</div>}
        {board.map((u, i) => (
          <div key={u.emp_id} className={`lb-row${u.emp_id === user.empId ? " me" : ""}`}>
            <div className={`rank-num${i < 3 ? " "+rankCls[i] : ""}`}>{i < 3 ? medals[i] : i+1}</div>
            <div><div className="lb-name">{u.name} {u.emp_id === user.empId && "👤"}</div><div className="lb-empid">{u.emp_id}</div></div>
            <div className="lb-pts-n">{u.pts}</div>
            <div className="lb-picks">{u.picks} picks</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MY PICKS
// ══════════════════════════════════════════════════════════════════════════════
function MyPicks({ user, matches, myPreds, onToast }) {
  const predicted = matches.filter(m => myPreds.find(p => p.match_id === m.id));
  const scored = matches.filter(m => m.status === "completed" && myPreds.find(p => p.match_id === m.id));
  const pts = scored.reduce((acc, m) => { const p = myPreds.find(x => x.match_id === m.id); return acc + (calcPoints(p, m) || 0); }, 0);
  return (
    <div>
      <div className="page-hd"><div className="page-title">📋 My Predictions</div></div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        {[["Predicted",predicted.length],["Scored",scored.length],["My Points",pts]].map(([l,v]) => (
          <div key={l} className="hstat"><div className="hstat-n">{v}</div><div className="hstat-l">{l}</div></div>
        ))}
      </div>
      {predicted.length === 0 ? <div className="empty">No predictions yet — head to Matches!</div>
        : <div className="matches">{predicted.map(m => <MatchCard key={m.id} match={m} user={user} myPred={myPreds.find(p => p.match_id === m.id)} isAdmin={false} onScoreOverride={()=>{}} onToast={onToast} />)}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════════════════════════════
function AdminPanel({ matches, allUsers, allPreds, sessions, auditLog, onScoreOverride, onToast, onRefresh }) {
  const [view, setView] = useState("overview");
  const [resetting, setResetting] = useState(null);
  const activeLast24 = [...new Set(sessions.filter(s => Date.now() - new Date(s.created_at) < 86400000).map(s => s.emp_id))].length;
  const deviceMap = {};
  sessions.forEach(s => { if (!deviceMap[s.device_id]) deviceMap[s.device_id] = []; if (!deviceMap[s.device_id].includes(s.emp_id)) deviceMap[s.device_id].push(s.emp_id); });
  const duplicates = Object.entries(deviceMap).filter(([,e]) => e.length > 1);
  const failedLogins = auditLog.filter(l => l.action === "login_failed").length;

  async function resetPassword(empId, name) {
    setResetting(empId);
    try {
      const hash = await hashPassword(DEFAULT_RESET_PASSWORD);
      await sb.patch("users", `emp_id=eq.${empId}`, { password_hash: hash });
      await audit("ADMIN", "reset", `Password reset for ${empId} (${name})`);
      onToast(`✓ ${name}'s password reset to 1234`);
      onRefresh();
    } catch { onToast("❌ Reset failed"); }
    setResetting(null);
  }

  const acClass = (a) => `ac ac-${a}` ;

  return (
    <div>
      <div className="page-hd">
        <div className="page-title">🔐 Admin Panel <span className="badge-admin">ADMIN</span></div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["overview","Overview"],["users","Users"],["devices","Devices"],["log","Audit Log"],["scores","Scores"]].map(([v,l]) => (
            <button key={v} className={`btn btn-sm${view===v?" btn-gold":" btn-ghost"}`} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
      </div>

      {view === "overview" && (
        <div className="admin-grid">
          <div className="panel">
            <div className="panel-hd">📊 Stats</div>
            <div className="stat-grid">
              {[["Total Users",allUsers.length],["Predictions",allPreds.length],["Active (24h)",activeLast24],["Completed",matches.filter(m=>m.status==="completed").length],["Dup. Devices",duplicates.length],["Failed Logins",failedLogins]].map(([l,v]) => (
                <div key={l} className="scard"><div className="scard-n" style={(l==="Dup. Devices"||l==="Failed Logins")&&v>0?{color:"var(--red)"}:{}}>{v}</div><div className="scard-l">{l}</div></div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-hd">🏅 Top Performers</div>
            <div className="panel-body">
              {allUsers.map(u => {
                const pts = matches.filter(m=>m.status==="completed").reduce((acc,m)=>{ const p=allPreds.find(x=>x.emp_id===u.emp_id&&x.match_id===m.id); return acc+(p?calcPoints(p,m)||0:0); },0);
                return {...u,pts};
              }).sort((a,b)=>b.pts-a.pts).slice(0,8).map((u,i) => (
                <div key={u.emp_id} className="log-row">
                  <div className="log-emp">{u.name}</div>
                  <div className="log-action">{u.emp_id}</div>
                  <div className="log-time" style={{color:"var(--gold)",fontWeight:700}}>{u.pts} pts</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === "users" && (
        <div className="panel">
          <div className="panel-hd">👥 User Management — Reset Password</div>
          <div className="panel-body">
            {allUsers.length === 0 && <div className="empty">No users yet</div>}
            {allUsers.map(u => (
              <div key={u.emp_id} className="user-mgmt-row">
                <div>
                  <div className="dev-emp">{u.name}</div>
                  <div className="dev-info">{u.emp_id}</div>
                </div>
                <button className="btn btn-sm btn-red"
                  disabled={resetting === u.emp_id}
                  onClick={() => resetPassword(u.emp_id, u.name)}>
                  {resetting === u.emp_id ? "⏳" : "🔑 Reset to 1234"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "devices" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {duplicates.length > 0 && (
            <div className="panel" style={{borderColor:"var(--red)"}}>
              <div className="panel-hd" style={{color:"var(--red)"}}>⚠️ Duplicate Devices ({duplicates.length})</div>
              <div className="panel-body">
                {duplicates.map(([devId,emps]) => (
                  <div key={devId} className="dev-row">
                    <div><div className="dev-emp" style={{color:"var(--red)"}}>🚨 {emps.join(" + ")}</div><div className="dev-info">Device: {devId.slice(0,20)}...</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="panel">
            <div className="panel-hd">📱 All Sessions</div>
            <div className="panel-body">
              {sessions.length === 0 && <div className="empty">No sessions yet</div>}
              {[...sessions].reverse().map((s,i) => (
                <div key={i} className="dev-row">
                  <div><div className="dev-emp">{s.emp_id}</div><div className="dev-info">{parseUA(s.user_agent||"")} · {parseBrowser(s.user_agent||"")} · {s.device_id?.slice(0,16)}...</div></div>
                  <div className="dev-time">{timeAgo(s.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === "log" && (
        <div className="panel">
          <div className="panel-hd">📋 Audit Log <span style={{fontSize:11,color:"var(--muted)",fontFamily:"Inter",fontWeight:400,marginLeft:8}}>{auditLog.length} events</span></div>
          <div className="panel-body">
            {auditLog.length === 0 && <div className="empty">No events yet</div>}
            {[...auditLog].reverse().map((l,i) => (
              <div key={i} className="log-row">
                <div className="log-emp" style={l.action==="login_failed"||l.action==="reset"?{color:"var(--red)"}:{}}>{l.emp_id||"—"}</div>
                <div className="log-action"><span className={acClass(l.action)}>{l.action}</span>{l.detail}</div>
                <div className="log-time">{timeAgo(l.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "scores" && (
        <div className="panel">
          <div className="panel-hd">⚽ Manual Score Override</div>
          <div className="panel-body">
            {matches.filter(m=>m.home!=="TBD").slice(0,30).map(m => (
              <MatchCard key={m.id} match={m} user={{empId:"admin"}} myPred={null}
                isAdmin={true} onScoreOverride={onScoreOverride} onToast={onToast} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Gate ─────────────────────────────────────────────────────────────────
function AdminGate({ onAuth }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false);
  return (
    <div style={{padding:"60px 0",textAlign:"center"}}>
      <div style={{display:"inline-flex",flexDirection:"column",gap:10,maxWidth:300,width:"100%"}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:24,color:"var(--gold)"}}>🔐 Admin Access</div>
        <input style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text)",padding:"11px 14px",fontSize:14,fontFamily:"Inter",outline:"none"}}
          type="password" placeholder="Admin password" value={pw}
          onChange={e=>{setPw(e.target.value);setErr(false)}}
          onKeyDown={e=>e.key==="Enter"&&(pw===ADMIN_PASSWORD?onAuth():setErr(true))} />
        {err && <div className="err-box">Incorrect password</div>}
        <button className="btn btn-gold" onClick={() => pw===ADMIN_PASSWORD?onAuth():setErr(true)}>Enter</button>
      </div>
    </div>
  );
}

// ── Demo matches ───────────────────────────────────────────────────────────────
const DEMO = [
  {id:"d1",home:"Mexico",away:"USA",datetime:new Date(Date.now()+2*3600000).toISOString(),status:"scheduled",stage:"Group Stage",group:"A",home_score:null,away_score:null},
  {id:"d2",home:"Brazil",away:"Argentina",datetime:new Date(Date.now()+26*3600000).toISOString(),status:"scheduled",stage:"Group Stage",group:"B",home_score:null,away_score:null},
  {id:"d3",home:"France",away:"Germany",datetime:new Date(Date.now()-2*3600000).toISOString(),status:"completed",stage:"Group Stage",group:"C",home_score:2,away_score:1},
  {id:"d4",home:"England",away:"Spain",datetime:new Date(Date.now()-26*3600000).toISOString(),status:"completed",stage:"Group Stage",group:"D",home_score:0,away_score:0},
  {id:"d5",home:"Portugal",away:"Morocco",datetime:new Date(Date.now()+50*3600000).toISOString(),status:"scheduled",stage:"Group Stage",group:"E",home_score:null,away_score:null},
];

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(getSession);
  const [needsPwChange, setNeedsPwChange] = useState(false);
  const [tab, setTab] = useState("matches");
  const [filter, setFilter] = useState("upcoming");
  const [matches, setMatches] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allPreds, setAllPreds] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [apiOk, setApiOk] = useState(true);
  const [loading, setLoading] = useState(true);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [toast, setToast] = useState(null);
  const [, tick] = useState(0);

  const showToast = (msg) => setToast(msg);

  const loadMatches = useCallback(async () => {
    try {
      const r = await fetch(SCORES_API);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const raw = data.matches || [];
      if (raw.length === 0) throw new Error();
      // Fetch admin score overrides from Supabase
      let overrides = [];
      try { overrides = await sb.get("match_overrides", "select=*"); } catch {}
      const overrideMap = {};
      overrides.forEach(o => { overrideMap[o.match_id] = o; });
      // Merge: admin overrides take priority over API scores
      const normalised = raw.map((m, i) => {
        const n = normalise(m, i);
        if (overrideMap[n.id]) {
          n.home_score = overrideMap[n.id].home_score;
          n.away_score = overrideMap[n.id].away_score;
          n.status = "completed";
        }
        return n;
      });
      setMatches(normalised);
      setApiOk(true);
    } catch { setApiOk(false); setMatches(DEMO); }
    setLoading(false);
  }, []);

  const loadDB = useCallback(async () => {
    try {
      const [users, preds, sess, log] = await Promise.all([
        sb.get("users", "order=name.asc"),
        sb.get("predictions", "select=*"),
        sb.get("sessions", "order=created_at.desc&limit=200"),
        sb.get("audit_log", "order=created_at.desc&limit=500"),
      ]);
      setAllUsers(users); setAllPreds(preds); setSessions(sess); setAuditLog(log);
    } catch(e) { console.error(e); }
  }, []);

  useEffect(() => { loadMatches(); loadDB(); }, []);
  useEffect(() => { const t = setInterval(() => { loadMatches(); loadDB(); tick(n=>n+1); }, 60000); return () => clearInterval(t); }, []);

  async function handleScoreOverride(matchId, hs, as_) {
    try {
      await sb.upsert("match_overrides", { match_id: matchId, home_score: hs, away_score: as_ });
      await audit("ADMIN", "score", `Match ${matchId} → ${hs}-${as_}`);
      setMatches(prev => prev.map(m => m.id === matchId ? {...m, home_score:hs, away_score:as_, status:"completed"} : m));
      await loadDB();
      showToast("✓ Score saved for all users!");
    } catch(e) {
      showToast("❌ Failed to save score");
      console.error(e);
    }
  }

  // Show force password change screen
  if (user && needsPwChange) {
    return <ForcePasswordChange user={user} onDone={() => setNeedsPwChange(false)} />;
  }

  if (!user) return (
    <Auth onLogin={u => {
      setUser(u);
      setNeedsPwChange(u.needsPwChange || false);
      loadDB();
    }} />
  );

  const myPreds = allPreds.filter(p => p.emp_id === user.empId);
  const myPts = matches.filter(m=>m.status==="completed").reduce((acc,m)=>{ const p=myPreds.find(x=>x.match_id===m.id); return acc+(p?calcPoints(p,m)||0:0); },0);
  const now = Date.now();
  const upcoming = matches.filter(m => m.status!=="completed" && (!m.datetime||new Date(m.datetime)>now));
  const live = matches.filter(m => m.status==="live");
  const completed = matches.filter(m => m.status==="completed");
  const filtered = filter==="upcoming"?upcoming:filter==="live"?live:filter==="completed"?completed:matches;

  return (
    <div className="app">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <header className="hdr">
        <div className="hdr-inner">
          <div className="logo">
            <span className="logo-ball">⚽</span>
            <div><div className="logo-text">WC 2026 PREDICTOR</div><div className="logo-sub">City Bank Office League</div></div>
          </div>
          <div className="hdr-right">
            <div className="nav-tabs">
              {[["matches","Matches"],["my","My Picks"],["board","Leaderboard"],["admin","Admin 🔐"]].map(([v,l]) => (
                <button key={v} className={`nav-tab${tab===v?" active":""}`} onClick={() => setTab(v)}>{l}</button>
              ))}
            </div>
            <div className="user-chip">
              <div className="user-avatar">{user.name[0]}</div>
              <div><div className="user-name">{user.name}</div><div className="user-pts">{myPts} pts</div></div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { clearSession(); setUser(null); setNeedsPwChange(false); }}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="hero">
        <div className="hero-title">⚽ FIFA World Cup 2026 ⚽</div>
        <div className="hero-sub">June 11 – July 19 · USA · Canada · Mexico · 48 Teams · 104 Matches</div>
        <div className="hero-stats">
          {[["Matches",matches.length],["Live",live.length],["Done",completed.length],["Players",allUsers.length],["My Pts",myPts]].map(([l,v]) => (
            <div key={l} className="hstat"><div className="hstat-n">{v}</div><div className="hstat-l">{l}</div></div>
          ))}
        </div>
      </div>

      <div className="main">
        {tab==="matches" && (
          <div>
            <div className="filter-bar">
              {[["upcoming",`Upcoming (${upcoming.length})`],["live",`Live (${live.length})`],["completed",`Done (${completed.length})`],["all",`All (${matches.length})`]].map(([v,l]) => (
                <button key={v} className={`filt${filter===v?" active":""}`} onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>
            <div className={`api-bar${apiOk?"":" err"}`}>
              <span className={`api-dot${apiOk?"":" off"}`} />
              {apiOk ? "Live data · Auto-refreshes every 60s" : "⚠️ Live API unreachable — showing demo data"}
            </div>
            {loading ? <div className="empty"><span className="spin">⚽</span> Loading matches...</div>
              : filtered.length===0 ? <div className="empty">No matches in this category</div>
              : <div className="matches">{filtered.map(m => <MatchCard key={m.id} match={m} user={user} myPred={myPreds.find(p=>p.match_id===m.id)} isAdmin={false} onScoreOverride={()=>{}} onToast={showToast} />)}</div>}
          </div>
        )}
        {tab==="my" && <MyPicks user={user} matches={matches} myPreds={myPreds} onToast={showToast} />}
        {tab==="board" && <Leaderboard user={user} matches={matches} allUsers={allUsers} allPreds={allPreds} />}
        {tab==="admin" && (adminAuthed
          ? <AdminPanel matches={matches} allUsers={allUsers} allPreds={allPreds} sessions={sessions} auditLog={auditLog} onScoreOverride={handleScoreOverride} onToast={showToast} onRefresh={loadDB} />
          : <AdminGate onAuth={() => setAdminAuthed(true)} />)}
      </div>
    </div>
  );
}
