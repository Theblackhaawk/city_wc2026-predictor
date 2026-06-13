import { useState, useEffect, useCallback } from "react";
 
// ── Config ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://nkqavfpbwdaqmzkcsufx.supabase.co";
const SUPABASE_KEY = "sb_publishable_-zcCan8Yn75xr1RtVzNHPA_REQuFXwo";
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
const SCORES_API = "https://api.football-data.org/v4/competitions/WC/matches";
const FOOTBALL_API_KEY = "959ff529c0a2422aaa409ec33f21ea39";
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
function normalise(m) {
  // football-data.org v4 format
  // homeTeam.name can be null for undecided knockout matches
  const home = m.homeTeam?.name || m.homeTeam?.shortName || m.homeTeam?.tla || "TBD";
  const away = m.awayTeam?.name || m.awayTeam?.shortName || m.awayTeam?.tla || "TBD";
  const dt = m.utcDate || m.datetime || m.date || "";
  const rawStatus = (m.status || "").toUpperCase();
  const done = ["FINISHED","COMPLETED"].includes(rawStatus);
  const live = ["IN_PLAY","PAUSED","HALFTIME"].includes(rawStatus);
  const hs = m.score?.fullTime?.home ?? null;
  const as_ = m.score?.fullTime?.away ?? null;
  const stage = m.stage || "GROUP_STAGE";
  const group = m.group ? m.group.replace("GROUP_","") : "";
  const stageLabel = stage === "GROUP_STAGE" ? "Group Stage"
    : stage === "LAST_16" ? "Round of 16"
    : stage === "QUARTER_FINALS" ? "Quarter Final"
    : stage === "SEMI_FINALS" ? "Semi Final"
    : stage === "FINAL" ? "Final"
    : stage === "THIRD_PLACE" ? "3rd Place"
    : stage;
  return {
    id: String(m.id),
    home, away, datetime: dt,
    home_score: done ? hs : null,
    away_score: done ? as_ : null,
    status: done ? "completed" : live ? "live" : "scheduled",
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
  return isNaN(d) ? dt : d.toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
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
 
// ══════════════════════════════════════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07090f;--surface:#0e1420;--card:#121a28;
  --border:#1c2a3e;--border2:#243348;
  --gold:#f0b429;--gold2:#d4920a;--gold-dim:#f0b42922;
  --green:#22c55e;--green-dim:#22c55e22;
  --red:#ef4444;--red-dim:#ef444422;
  --muted:#4a6080;--muted2:#6b8aaa;
  --text:#dde6f0;--white:#fff;
}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.app{min-height:100vh;display:flex;flex-direction:column}
 
/* Header */
.hdr{background:linear-gradient(180deg,#0c1322 0%,#080d18 100%);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:200}
.hdr-inner{max-width:1200px;margin:0 auto;padding:0 20px;height:60px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.logo{display:flex;align-items:center;gap:10px}
.logo-ball{font-size:26px;animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.logo-text{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:20px;color:var(--gold);letter-spacing:1.5px;line-height:1.1}
.logo-sub{font-size:10px;color:var(--muted);letter-spacing:2px;text-transform:uppercase}
.hdr-right{display:flex;align-items:center;gap:10px}
.user-chip{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:24px;padding:4px 12px 4px 4px}
.user-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold2));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#000}
.user-name{font-size:13px;font-weight:600;color:var(--text)}
.user-pts{font-size:10px;color:var(--gold);font-weight:700}
 
/* Buttons */
.btn{display:inline-flex;align-items:center;gap:5px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s;font-family:'Inter',sans-serif;white-space:nowrap}
.btn-gold{background:var(--gold);color:#000}.btn-gold:hover{background:var(--gold2)}
.btn-ghost{background:transparent;color:var(--muted2);border:1px solid var(--border)}.btn-ghost:hover{color:var(--text);border-color:var(--border2)}
.btn-red{background:#2d0a0a;color:#f87171;border:1px solid #5c1414}.btn-red:hover{background:#3d1010}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:6px}
.btn:disabled{opacity:.4;cursor:not-allowed}
 
/* Nav */
.nav-tabs{display:flex;gap:2px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:3px}
.nav-tab{padding:6px 14px;border-radius:7px;border:none;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
.nav-tab.active{background:var(--gold);color:#000}
.nav-tab:not(.active):hover{color:var(--text)}
 
/* Hero */
.hero{background:linear-gradient(180deg,#0d1a2e 0%,var(--bg) 100%);padding:28px 20px 20px;border-bottom:1px solid var(--border);text-align:center}
.hero-title{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:clamp(28px,5vw,52px);color:var(--gold);letter-spacing:3px;text-transform:uppercase;line-height:1;text-shadow:0 0 40px rgba(240,180,41,.3)}
.hero-sub{color:var(--muted2);font-size:13px;margin-top:6px}
.hero-stats{display:flex;justify-content:center;gap:24px;margin-top:20px;flex-wrap:wrap}
.hstat{text-align:center;padding:10px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:80px}
.hstat-n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:26px;color:var(--gold)}
.hstat-l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:2px}
 
/* Main */
.main{max-width:1200px;margin:0 auto;padding:20px;width:100%;flex:1}
.page-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap}
.page-title{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;color:var(--text);letter-spacing:1px;text-transform:uppercase}
 
/* Filters */
.filter-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.filt{padding:5px 14px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--muted2);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
.filt.active{background:var(--gold);color:#000;border-color:var(--gold)}
.filt:not(.active):hover{color:var(--text);border-color:var(--border2)}
 
/* API bar */
.api-bar{display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:6px;margin-bottom:12px;border:1px solid var(--border);background:var(--surface);color:var(--muted2)}
.api-bar.err{border-color:#5c1414;background:#1a0808;color:#f87171}
.api-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.api-dot.off{background:var(--red)}
 
/* Match cards */
.matches{display:flex;flex-direction:column;gap:10px}
.mcard{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s}
.mcard:hover{border-color:var(--border2)}
.mcard.live{border-color:var(--green);box-shadow:0 0 20px var(--green-dim)}
.mcard.done{opacity:.85}
.mcard-top{display:flex;align-items:center;justify-content:space-between;padding:5px 14px;background:#080d18;border-bottom:1px solid var(--border);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.live-pill{display:inline-flex;align-items:center;gap:5px;color:var(--green);font-weight:700}
.pulse{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.mcard-body{display:grid;grid-template-columns:1fr 120px 1fr;align-items:center;gap:8px;padding:14px 16px}
.team{display:flex;flex-direction:column;align-items:center;gap:5px}
.team-r{align-items:flex-end}
.tflag{font-size:34px;line-height:1}
.tname{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;text-align:center;color:var(--text)}
.scorebox{text-align:center}
.score-num{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:36px;color:var(--gold);letter-spacing:6px;line-height:1}
.score-vs{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;color:var(--muted);letter-spacing:2px}
.score-lbl{font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:1px}
.cd-badge{display:inline-block;margin-top:5px;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:var(--gold-dim);color:var(--gold);border:1px solid var(--gold-dim)}
.cd-badge.warn{background:var(--red-dim);color:var(--red);border-color:var(--red-dim)}
.mcard-foot{border-top:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;min-height:48px}
 
/* Prediction */
.pred-ui{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.out-btns{display:flex;gap:3px}
.out-btn{padding:5px 9px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted2);font-size:11px;font-weight:700;cursor:pointer;transition:all .13s;font-family:'Inter',sans-serif}
.out-btn.sel.h{background:#1a3460;color:#60a5fa;border-color:#3b82f6}
.out-btn.sel.d{background:#2d2410;color:#fbbf24;border-color:#f59e0b}
.out-btn.sel.a{background:#0f2d1a;color:#4ade80;border-color:#22c55e}
.score-inp-wrap{display:flex;align-items:center;gap:4px}
.sinp{width:34px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 2px;font-size:14px;font-weight:700;font-family:'Barlow Condensed',sans-serif}
.sinp:focus{outline:none;border-color:var(--gold)}
.sep{color:var(--muted);font-weight:700;font-size:13px}
.locked-msg{font-size:11px;color:var(--red);font-weight:500}
.pred-existing{font-size:12px;color:var(--muted2)}
.pts-chip{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:12px;font-size:12px;font-weight:700}
.pts-2{background:#0f3320;color:#4ade80;border:1px solid #166534}
.pts-1{background:#2a2000;color:#fbbf24;border:1px solid #854d0e}
.pts-0{background:#1a1a1a;color:var(--muted);border:1px solid var(--border)}
 
/* Leaderboard */
.lb{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.lb-hd{padding:12px 18px;background:#080d18;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.lb-row{display:grid;grid-template-columns:48px 1fr auto auto;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #ffffff08;transition:background .15s}
.lb-row:hover{background:#ffffff04}
.lb-row:last-child{border-bottom:none}
.lb-row.me{background:linear-gradient(90deg,var(--gold-dim),transparent);border-left:3px solid var(--gold)}
.rank-num{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;text-align:center;color:var(--muted)}
.rank-num.r1{color:#f5c842}.rank-num.r2{color:#94a3b8}.rank-num.r3{color:#c07d3a}
.lb-name{font-weight:600;font-size:14px;color:var(--text)}
.lb-empid{font-size:11px;color:var(--muted);margin-top:1px}
.lb-pts-n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:24px;color:var(--gold)}
.lb-picks{font-size:11px;color:var(--muted);text-align:right}
 
/* Admin */
.admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:800px){.admin-grid{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.panel-hd{padding:12px 16px;background:#080d18;border-bottom:1px solid var(--border);font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;letter-spacing:1px;color:var(--gold);text-transform:uppercase}
.panel-body{max-height:480px;overflow-y:auto}
.log-row{display:flex;align-items:flex-start;gap:10px;padding:8px 14px;border-bottom:1px solid #ffffff06;font-size:12px}
.log-row:last-child{border-bottom:none}
.log-emp{font-weight:700;color:var(--text);min-width:90px;flex-shrink:0}
.log-action{color:var(--muted2);flex:1}
.log-time{color:var(--muted);flex-shrink:0;font-size:10px}
.dev-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:10px 14px;border-bottom:1px solid #ffffff06;font-size:12px}
.dev-row:last-child{border-bottom:none}
.dev-emp{font-weight:700;color:var(--text)}
.dev-info{color:var(--muted2);font-size:11px;margin-top:2px}
.dev-time{color:var(--muted);font-size:10px;text-align:right}
.ac{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-right:4px}
.ac-login{background:#1a3460;color:#60a5fa}
.ac-prediction{background:#0f2d1a;color:#4ade80}
.ac-signup{background:#2d1f00;color:#fbbf24}
.ac-score{background:#2d0a2d;color:#c084fc}
.ac-reset{background:#3d1515;color:#f87171}
.ac-login_failed{background:#3d1515;color:#f87171}
.ac-pw_change{background:#0f2d1a;color:#4ade80}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px}
.scard{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center}
.scard-n{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:var(--gold)}
.scard-l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
.user-mgmt-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #ffffff06;font-size:12px}
.user-mgmt-row:last-child{border-bottom:none}
 
/* Auth */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 0%,#0d1a2e 0%,var(--bg) 60%);padding:24px}
.auth-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:40px 36px;width:100%;max-width:420px}
.auth-logo{font-size:52px;text-align:center;margin-bottom:10px;filter:drop-shadow(0 0 20px rgba(240,180,41,.5))}
.aut