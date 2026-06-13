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
function normalise(m, idx) {
  // openfootball format: { team1, team2, date, time, group, score: { ft: [h, a] }, round }
  const home = m.team1 || "TBD";
  const away = m.team2 || "TBD";
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
            ? <div className="score-num">{match.home_score}<span style={{color:"var(--m