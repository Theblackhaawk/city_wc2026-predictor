import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://nkqavfpbwdaqmzkcsufx.supabase.co";
const SUPABASE_KEY = "sb_publishable_-zcCan8Yn75xr1RtVzNHPA_REQuFXwo";
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
const SCORES_API = "https://worldcup26.ir/get/games";

// ── Simple password hashing (SHA-256 via Web Crypto API) ──────────────────────
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
  get: (table, params = "") => sb.query(`${table}?${params}`),
  post: (table, body) => sb.query(table, { method: "POST", body: JSON.stringify(body) }),
  patch: (table, params, body) => sb.query(`${table}?${params}`, { method: "PATCH", body: JSON.stringify(body), prefer: "return=representation" }),
  upsert: (table, body) => sb.query(table, { method: "POST", body: JSON.stringify(body), prefer: "resolution=merge-duplicates,return=representation" }),
};

// ── Device fingerprint ─────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem("wc_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("wc_device_id", id);
  }
  return id;
}
function getFingerprint() {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.textBaseline = "top"; ctx.font = "14px Arial";
  ctx.fillText("WC2026🏆", 2, 2);
  return [navigator.userAgent, navigator.language, screen.width + "x" + screen.height, new Date().getTimezoneOffset(), c.toDataURL().slice(-50)].join("|");
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

// ── Audit log ──────────────────────────────────────────────────────────────────
async function audit(empId, action, detail = "") {
  try { await sb.post("audit_log", { emp_id: empId, action, detail }); } catch {}
}

// ── Flag helper ────────────────────────────────────────────────────────────────
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

// ── Match normaliser ───────────────────────────────────────────────────────────
function normalise(m) {
  const home = m.homeTeam?.name || m.home_team?.name || m.home || "TBD";
  const away = m.awayTeam?.name || m.away_team?.name || m.away || "TBD";
  const dt = m.datetime || m.kickoff_utc || m.date || "";
  const status = (m.status || "").toLowerCase();
  const done = ["completed","finished","ft","full-time"].includes(status);
  const live = ["live","1h","2h","ht","in progress","inprogress"].includes(status);
  return {
    id: String(m.id || m.matchNumber || m.match_number),
    home, away, datetime: dt,
    home_score: done ? (m.homeScore ?? m.home_score ?? null) : null,
    away_score: done ? (m.awayScore ?? m.away_score ?? null) : null,
    status: done ? "completed" : live ? "live" : "scheduled",
    stage: m.stage || m.round || "Group Stage",
    group: m.group || m.group_name || "",
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
  --bg:#07090f;--surface:#0e1420;--card:#121a28;--card2:#161f30;
  --border:#1c2a3e;--border2:#243348;
  --gold:#f0b429;--gold2:#d4920a;--gold-dim:#f0b42922;
  --green:#22c55e;--green-dim:#22c55e22;
  --red:#ef4444;--red-dim:#ef444422;
  --blue:#3b82f6;--muted:#4a6080;--muted2:#6b8aaa;
  --text:#dde6f0;--text2:#a8bdd0;--white:#fff;
}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.app{min-height:100vh;display:flex;flex-direction:column}

/* ── Header ── */
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
.user-info{line-height:1.2}
.user-name{font-size:13px;font-weight:600;color:var(--text)}
.user-pts{font-size:10px;color:var(--gold);font-weight:700}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;gap:5px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s;font-family:'Inter',sans-serif;white-space:nowrap}
.btn-gold{background:var(--gold);color:#000}.btn-gold:hover{background:var(--gold2)}
.btn-ghost{background:transparent;color:var(--muted2);border:1px solid var(--border)}.btn-ghost:hover{color:var(--text);border-color:var(--border2)}
.btn-danger{background:#2d0a0a;color:#f87171;border:1px solid #5c1414}.btn-danger:hover{background:#3d1010}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:6px}
.btn:disabled{opacity:.4;cursor:not-allowed}

/* ── Nav tabs ── */
.nav-tabs{display:flex;gap:2px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:3px}
.nav-tab{padding:6px 14px;border-radius:7px;border:none;background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
.nav-tab.active{background:var(--gold);color:#000}
.nav-tab:not(.active):hover{color:var(--text)}

/* ── Hero ── */
.hero{background:linear-gradient(180deg,#0d1a2e 0%,var(--bg) 100%);padding:28px 20px 20px;border-bottom:1px solid var(--border);text-align:center}
.hero-title{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:clamp(28px,5vw,52px);color:var(--gold);letter-spacing:3px;text-transform:uppercase;line-height:1;text-shadow:0 0 40px rgba(240,180,41,.3)}
.hero-sub{color:var(--muted2);font-size:13px;margin-top:6px}
.hero-stats{display:flex;justify-content:center;gap:24px;margin-top:20px;flex-wrap:wrap}
.hstat{text-align:center;padding:10px 16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:80px}
.hstat-n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:26px;color:var(--gold)}
.hstat-l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:2px}

/* ── Main layout ── */
.main{max-width:1200px;margin:0 auto;padding:20px;width:100%;flex:1}
.page-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap}
.page-title{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;color:var(--text);letter-spacing:1px;text-transform:uppercase}

/* ── Filter bar ── */
.filter-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.filt{padding:5px 14px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--muted2);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
.filt.active{background:var(--gold);color:#000;border-color:var(--gold)}
.filt:not(.active):hover{color:var(--text);border-color:var(--border2)}

/* ── API status bar ── */
.api-bar{display:flex;align-items:center;gap:6px;font-size:11px;padding:6px 12px;border-radius:6px;margin-bottom:12px;border:1px solid var(--border);background:var(--surface);color:var(--muted2)}
.api-bar.err{border-color:#5c1414;background:#1a0808;color:#f87171}
.api-dot{width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0}
.api-dot.off{background:var(--red)}

/* ── Match cards ── */
.matches{display:flex;flex-direction:column;gap:10px}
.mcard{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s,box-shadow .2s}
.mcard:hover{border-color:var(--border2)}
.mcard.live{border-color:var(--green);box-shadow:0 0 20px var(--green-dim)}
.mcard.done{opacity:.85}
.mcard-top{display:flex;align-items:center;justify-content:space-between;padding:5px 14px;background:#080d18;border-bottom:1px solid var(--border);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.live-pill{display:inline-flex;align-items:center;gap:5px;color:var(--green);font-weight:700}
.pulse{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
.mcard-body{display:grid;grid-template-columns:1fr 120px 1fr;align-items:center;gap:8px;padding:14px 16px}
.team{display:flex;flex-direction:column;align-items:center;gap:5px}
.team-r{align-items:flex-end}
.tflag{font-size:34px;line-height:1}
.tname{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;text-align:center;color:var(--text);letter-spacing:.3px}
.scorebox{text-align:center}
.score-num{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:36px;color:var(--gold);letter-spacing:6px;line-height:1}
.score-vs{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;color:var(--muted);letter-spacing:2px}
.score-lbl{font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:1px}
.cd-badge{display:inline-block;margin-top:5px;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:var(--gold-dim);color:var(--gold);border:1px solid var(--gold-dim)}
.cd-badge.warn{background:var(--red-dim);color:var(--red);border-color:var(--red-dim)}
.mcard-foot{border-top:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;min-height:48px}

/* ── Prediction UI ── */
.pred-ui{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.out-btns{display:flex;gap:3px}
.out-btn{padding:5px 9px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted2);font-size:11px;font-weight:700;cursor:pointer;transition:all .13s;font-family:'Inter',sans-serif}
.out-btn:hover:not(.sel){border-color:var(--border2);color:var(--text)}
.out-btn.sel.h{background:#1a3460;color:#60a5fa;border-color:#3b82f6}
.out-btn.sel.d{background:#2d2410;color:#fbbf24;border-color:#f59e0b}
.out-btn.sel.a{background:#0f2d1a;color:#4ade80;border-color:#22c55e}
.score-inp-wrap{display:flex;align-items:center;gap:4px}
.sinp{width:34px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:5px;color:var(--text);padding:4px 2px;font-size:14px;font-weight:700;font-family:'Barlow Condensed',sans-serif}
.sinp:focus{outline:none;border-color:var(--gold)}
.sep{color:var(--muted);font-weight:700;font-size:13px}
.locked-msg{font-size:11px;color:var(--red);font-weight:500;display:flex;align-items:center;gap:4px}
.pred-existing{font-size:12px;color:var(--muted2);display:flex;align-items:center;gap:6px}
.pts-chip{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:12px;font-size:12px;font-weight:700}
.pts-2{background:#0f3320;color:#4ade80;border:1px solid #166534}
.pts-1{background:#2a2000;color:#fbbf24;border:1px solid #854d0e}
.pts-0{background:#1a1a1a;color:var(--muted);border:1px solid var(--border)}

/* ── Leaderboard ── */
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

/* ── Admin panel ── */
.admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:800px){.admin-grid{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.panel-hd{padding:12px 16px;background:#080d18;border-bottom:1px solid var(--border);font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;letter-spacing:1px;color:var(--gold);text-transform:uppercase;display:flex;align-items:center;gap:8px}
.panel-body{padding:0;max-height:420px;overflow-y:auto}
.log-row{display:flex;align-items:flex-start;gap:10px;padding:8px 14px;border-bottom:1px solid #ffffff06;font-size:12px}
.log-row:last-child{border-bottom:none}
.log-emp{font-weight:700;color:var(--text);min-width:100px;flex-shrink:0}
.log-action{color:var(--muted2);flex:1}
.log-time{color:var(--muted);flex-shrink:0;font-size:10px;padding-top:1px}
.dev-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:10px 14px;border-bottom:1px solid #ffffff06;font-size:12px}
.dev-row:last-child{border-bottom:none}
.dev-emp{font-weight:700;color:var(--text)}
.dev-info{color:var(--muted2);font-size:11px;margin-top:2px}
.dev-time{color:var(--muted);font-size:10px;text-align:right}
.action-chip{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;margin-right:4px}
.ac-login{background:#1a3460;color:#60a5fa}
.ac-prediction{background:#0f2d1a;color:#4ade80}
.ac-signup{background:#2d1f00;color:#fbbf24}
.ac-score{background:#2d0a2d;color:#c084fc}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px}
.scard{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center}
.scard-n{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;color:var(--gold)}
.scard-l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:2px}

/* ── Auth ── */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 0%,#0d1a2e 0%,var(--bg) 60%);padding:24px}
.auth-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:40px 36px;width:100%;max-width:420px}
.auth-logo{font-size:52px;text-align:center;margin-bottom:10px;filter:drop-shadow(0 0 20px rgba(240,180,41,.5))}
.auth-title{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:30px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;text-align:center}
.auth-sub{font-size:12px;color:var(--muted);text-align:center;margin-top:4px;margin-bottom:28px;letter-spacing:.5px}
.field{margin-bottom:14px}
.field label{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.field input{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:11px 14px;font-size:14px;font-family:'Inter',sans-serif;transition:border-color .15s}
.field input:focus{outline:none;border-color:var(--gold)}
.pw-wrap{position:relative}
.pw-wrap input{padding-right:40px}
.pw-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0;line-height:1}
.pw-eye:hover{color:var(--text)}
.pw-strength{height:3px;border-radius:2px;margin-top:5px;transition:all .3s}
.pw-hint{font-size:10px;color:var(--muted);margin-top:3px}
.auth-submit{width:100%;padding:13px;background:var(--gold);color:#000;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;font-family:'Barlow Condensed',sans-serif;letter-spacing:1.5px;transition:background .15s;margin-top:6px}
.auth-submit:hover{background:var(--gold2)}
.auth-submit:disabled{opacity:.5;cursor:not-allowed}
.auth-toggle{margin-top:18px;text-align:center;font-size:13px;color:var(--muted)}
.auth-toggle span{color:var(--gold);cursor:pointer;font-weight:600}
.auth-toggle span:hover{text-decoration:underline}
.err-box{color:#f87171;font-size:12px;padding:8px 12px;background:#1a0808;border:1px solid #5c1414;border-radius:6px;margin-top:8px}
.success-box{color:#4ade80;font-size:12px;padding:8px 12px;background:#0f2d1a;border:1px solid #166534;border-radius:6px;margin-top:8px}
.divider-text{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--muted);font-size:11px}
.divider-text::before,.divider-text::after{content:'';flex:1;height:1px;background:var(--border)}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f2d1a;color:#4ade80;border:1px solid #166534;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;animation:fadeup .3s ease;white-space:nowrap}
@keyframes fadeup{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.empty{padding:40px;text-align:center;color:var(--muted);font-size:13px}
.spin{display:inline-block;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.badge-admin{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:#2d1f00;color:var(--gold);border:1px solid #854d0e;margin-left:8px}
@media(max-width:640px){
  .mcard-body{grid-template-columns:1fr 90px 1fr;padding:10px 12px}
  .tflag{font-size:26px}.tname{font-size:13px}.score-num{font-size:28px}
  .hdr-inner{flex-wrap:wrap;height:auto;padding:10px 16px;gap:8px}
  .nav-tabs{order:3;width:100%}
  .admin-grid{grid-template-columns:1fr}
}
`;

function injectCSS() {
  if (document.getElementById("wc26-css")) return;
  const s = document.createElement("style");
  s.id = "wc26-css"; s.textContent = CSS;
  document.head.appendChild(s);
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, []);
  return <div className="toast">{msg}</div>;
}

// ── Password strength ──────────────────────────────────────────────────────────
function pwStrength(pw) {
  if (!pw) return { score: 0, label: "", color: "transparent" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "#ef4444" };
  if (score <= 3) return { score, label: "Fair", color: "#f59e0b" };
  return { score, label: "Strong", color: "#22c55e" };
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
  const [showConfirm, setShowConfirm] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const strength = pwStrength(password);

  function reset() { setErr(""); setPassword(""); setConfirmPw(""); setName(""); }

  async function submit() {
    setErr(""); setLoading(true);
    const id = empId.trim().toUpperCase();
    if (!id) { setErr("Employee ID is required."); setLoading(false); return; }
    if (!password) { setErr("Password is required."); setLoading(false); return; }

    try {
      if (mode === "signup") {
        if (!name.trim()) { setErr("Full name is required."); setLoading(false); return; }
        if (password.length < 6) { setErr("Password must be at least 6 characters."); setLoading(false); return; }
        if (password !== confirmPw) { setErr("Passwords do not match."); setLoading(false); return; }

        // Check if emp ID already exists
        const existing = await sb.get("users", `emp_id=eq.${id}`);
        if (existing.length > 0) { setErr("This Employee ID is already registered."); setLoading(false); return; }

        // Check device uniqueness
        const deviceId = getDeviceId();
        const devCheck = await sb.get("sessions", `device_id=eq.${deviceId}&select=emp_id`);
        if (devCheck.length > 0 && devCheck[0].emp_id !== id) {
          setErr(`This device is already registered to another employee (${devCheck[0].emp_id}). Each person must sign up on their own device.`);
          setLoading(false); return;
        }

        const hash = await hashPassword(password);
        await sb.post("users", { emp_id: id, name: name.trim(), password_hash: hash });
        await sb.post("sessions", { emp_id: id, device_id: deviceId, fingerprint: getFingerprint(), user_agent: navigator.userAgent, ip_hint: "client" });
        await audit(id, "signup", `New registration: ${name.trim()} — ${parseUA(navigator.userAgent)}`);
        const user = { empId: id, name: name.trim() };
        setSession(user); onLogin(user);

      } else {
        const rows = await sb.get("users", `emp_id=eq.${id}`);
        if (rows.length === 0) { setErr("Employee ID not found. Please sign up first."); setLoading(false); return; }

        const hash = await hashPassword(password);
        if (rows[0].password_hash !== hash) {
          await audit(id, "login_failed", `Wrong password attempt — ${parseUA(navigator.userAgent)}`);
          setErr("Incorrect password. Please try again."); setLoading(false); return;
        }

        const deviceId = getDeviceId();
        await sb.post("sessions", { emp_id: id, device_id: deviceId, fingerprint: getFingerprint(), user_agent: navigator.userAgent, ip_hint: "client" });
        await audit(id, "login", `Signed in — ${parseUA(navigator.userAgent)} / ${parseBrowser(navigator.userAgent)}`);
        const user = { empId: id, name: rows[0].name };
        setSession(user); onLogin(user);
      }
    } catch (e) {
      setErr("Something went wrong. Please try again.");
      console.error(e);
    }
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
          <input value={empId} onChange={e => setEmpId(e.target.value)} placeholder="e.g. CB-10042" autoFocus
            onKeyDown={e => e.key === "Enter" && submit()} />
        </div>

        {mode === "signup" && (
          <div className="field">
            <label>Full Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name"
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
        )}

        <div className="field">
          <label>Password</label>
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} value={password}
              onChange={e => setPassword(e.target.value)} placeholder={mode === "signup" ? "Create a password" : "Your password"}
              onKeyDown={e => e.key === "Enter" && submit()} />
            <button className="pw-eye" onClick={() => setShowPw(p => !p)} type="button">
              {showPw ? "🙈" : "👁️"}
            </button>
          </div>
          {mode === "signup" && password && (
            <>
              <div className="pw-strength" style={{ background: strength.color, width: `${(strength.score / 5) * 100}%` }} />
              <div className="pw-hint" style={{ color: strength.color }}>{strength.label}</div>
            </>
          )}
        </div>

        {mode === "signup" && (
          <div className="field">
            <label>Confirm Password</label>
            <div className="pw-wrap">
              <input type={showConfirm ? "text" : "password"} value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)} placeholder="Repeat your password"
                onKeyDown={e => e.key === "Enter" && submit()} />
              <button className="pw-eye" onClick={() => setShowConfirm(p => !p)} type="button">
                {showConfirm ? "🙈" : "👁️"}
              </button>
            </div>
            {confirmPw && password !== confirmPw && <div className="pw-hint" style={{color:"var(--red)"}}>Passwords don't match</div>}
            {confirmPw && password === confirmPw && <div className="pw-hint" style={{color:"var(--green)"}}>✓ Passwords match</div>}
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

  async function submitScore() {
    if (oHs === "" || oAs === "") return;
    await onScoreOverride(match.id, parseInt(oHs), parseInt(oAs));
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
        <div className="team">
          <div className="tflag">{flag(match.home)}</div>
          <div className="tname">{match.home}</div>
        </div>
        <div className="scorebox">
          {(isLive || isDone) && match.home_score != null
            ? <div className="score-num">{match.home_score}<span style={{color:"var(--muted)",fontSize:"0.55em",letterSpacing:0}}> : </span>{match.away_score}</div>
            : <div className="score-vs">VS</div>}
          <div className="score-lbl">{isLive ? "in progress" : isDone ? "final" : ""}</div>
          {cd && !isDone && <div className={`cd-badge${closingSoon ? " warn" : ""}`}>{closingSoon ? "⚠️ " : "⏱ "}{cd}</div>}
        </div>
        <div className="team team-r">
          <div className="tflag">{flag(match.away)}</div>
          <div className="tname">{match.away}</div>
        </div>
      </div>
      <div className="mcard-foot">
        {open && !isDone && (
          <div className="pred-ui">
            <div className="out-btns">
              {[["home","h",match.home.split(" ")[0]],["draw","d","Draw"],["away","a",match.away.split(" ")[0]]].map(([v,cls,lbl]) => (
                <button key={v} className={`out-btn${outcome===v?` sel ${cls}`:""}`}
                  onClick={() => { setOutcome(v); setSaved(false); }}>{lbl}</button>
              ))}
            </div>
            <div className="score-inp-wrap">
              <input className="sinp" type="number" min="0" max="20" value={hs}
                onChange={e => { setHs(e.target.value); setSaved(false); }} placeholder="0" />
              <span className="sep">-</span>
              <input className="sinp" type="number" min="0" max="20" value={as}
                onChange={e => { setAs(e.target.value); setSaved(false); }} placeholder="0" />
            </div>
            <button className="btn btn-gold btn-sm" onClick={savePred} disabled={!outcome || saving}>
              {saving ? "..." : saved ? "✓ Saved" : "Save"}
            </button>
          </div>
        )}
        {!open && !isDone && <div className="locked-msg">🔒 Predictions closed (15 min rule)</div>}
        {(isDone || !open) && myPred && (
          <div className="pred-existing">
            Your pick: <strong>{myPred.outcome === "home" ? match.home : myPred.outcome === "away" ? match.away : "Draw"}</strong>
            &nbsp;({myPred.home_score ?? "?"}-{myPred.away_score ?? "?"})
          </div>
        )}
        {pts !== null && (
          <span className={`pts-chip pts-${pts}`}>{pts === 2 ? "⭐" : pts === 1 ? "✓" : "✗"} {pts} pt{pts !== 1 ? "s" : ""}</span>
        )}
        {isDone && !myPred && <span className="pts-chip pts-0">No prediction</span>}
        {isAdmin && (
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto"}}>
            <span style={{fontSize:10,color:"var(--muted)"}}>ADMIN SCORE:</span>
            <input className="sinp" style={{width:30}} type="number" min="0" max="20" value={oHs} onChange={e=>setOHs(e.target.value)} placeholder="H" />
            <span className="sep">-</span>
            <input className="sinp" style={{width:30}} type="number" min="0" max="20" value={oAs} onChange={e=>setOAs(e.target.value)} placeholder="A" />
            <button className="btn btn-sm" style={{background:"#2d1f00",color:"var(--gold)",border:"1px solid #854d0e",fontSize:11}} onClick={submitScore}>Set</button>
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

  const medals = ["🥇","🥈","🥉"];
  const rankCls = ["r1","r2","r3"];

  return (
    <div>
      <div className="page-hd"><div className="page-title">🏆 Leaderboard</div>
        <div style={{fontSize:11,color:"var(--muted)"}}>Updates live as results come in</div>
      </div>
      <div className="lb">
        <div className="lb-hd">
          <span style={{fontSize:12,color:"var(--muted2)"}}>{board.length} participants</span>
          <span style={{fontSize:11,color:"var(--muted)"}}>2 pts max per match</span>
        </div>
        {board.length === 0 && <div className="empty">No participants yet</div>}
        {board.map((u, i) => (
          <div key={u.emp_id} className={`lb-row${u.emp_id === user.empId ? " me" : ""}`}>
            <div className={`rank-num${i < 3 ? " "+rankCls[i] : ""}`}>{i < 3 ? medals[i] : i+1}</div>
            <div>
              <div className="lb-name">{u.name} {u.emp_id === user.empId && "👤"}</div>
              <div className="lb-empid">{u.emp_id}</div>
            </div>
            <div className="lb-pts-n">{u.pts}</div>
            <div className="lb-picks">{u.picks} picks</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MY PREDICTIONS
// ══════════════════════════════════════════════════════════════════════════════
function MyPicks({ user, matches, myPreds, onToast }) {
  const predicted = matches.filter(m => myPreds.find(p => p.match_id === m.id));
  const scored = matches.filter(m => m.status === "completed" && myPreds.find(p => p.match_id === m.id));
  const pts = scored.reduce((acc, m) => {
    const p = myPreds.find(x => x.match_id === m.id);
    return acc + (calcPoints(p, m) || 0);
  }, 0);
  return (
    <div>
      <div className="page-hd"><div className="page-title">📋 My Predictions</div></div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        {[["Predicted",predicted.length],["Scored",scored.length],["My Points",pts]].map(([l,v]) => (
          <div key={l} className="hstat"><div className="hstat-n">{v}</div><div className="hstat-l">{l}</div></div>
        ))}
      </div>
      {predicted.length === 0
        ? <div className="empty">No predictions yet — head to Matches!</div>
        : <div className="matches">
            {predicted.map(m => (
              <MatchCard key={m.id} match={m} user={user}
                myPred={myPreds.find(p => p.match_id === m.id)}
                isAdmin={false} onScoreOverride={()=>{}} onToast={onToast} />
            ))}
          </div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════════════════════════════
function AdminPanel({ matches, allUsers, allPreds, sessions, auditLog, onScoreOverride, onToast }) {
  const [view, setView] = useState("overview");
  const activeLast24 = [...new Set(sessions.filter(s => Date.now() - new Date(s.created_at) < 86400000).map(s => s.emp_id))].length;
  const completed = matches.filter(m => m.status === "completed").length;
  const deviceMap = {};
  sessions.forEach(s => {
    if (!deviceMap[s.device_id]) deviceMap[s.device_id] = [];
    if (!deviceMap[s.device_id].includes(s.emp_id)) deviceMap[s.device_id].push(s.emp_id);
  });
  const duplicates = Object.entries(deviceMap).filter(([,emps]) => emps.length > 1);
  const failedLogins = auditLog.filter(l => l.action === "login_failed");
  const actionClass = { login:"ac-login", prediction:"ac-prediction", signup:"ac-signup", score:"ac-score", login_failed:"ac-login" };

  return (
    <div>
      <div className="page-hd">
        <div className="page-title">🔐 Admin Panel <span className="badge-admin">ADMIN</span></div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["overview","Overview"],["devices","Devices"],["log","Audit Log"],["scores","Scores"]].map(([v,l]) => (
            <button key={v} className={`btn btn-sm${view===v?" btn-gold":" btn-ghost"}`} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
      </div>

      {view === "overview" && (
        <div className="admin-grid">
          <div className="panel">
            <div className="panel-hd">📊 Stats</div>
            <div className="stat-grid">
              {[
                ["Total Users", allUsers.length],
                ["Predictions", allPreds.length],
                ["Active (24h)", activeLast24],
                ["Completed", completed],
                ["Duplicate Devices", duplicates.length],
                ["Failed Logins", failedLogins.length],
              ].map(([l,v]) => (
                <div key={l} className="scard">
                  <div className="scard-n" style={(l==="Duplicate Devices"||l==="Failed Logins")&&v>0?{color:"var(--red)"}:{}}>{v}</div>
                  <div className="scard-l">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-hd">🏅 Top Performers</div>
            <div className="panel-body">
              {allUsers.map(u => {
                const pts = matches.filter(m=>m.status==="completed").reduce((acc,m)=>{
                  const p = allPreds.find(x=>x.emp_id===u.emp_id&&x.match_id===m.id);
                  return acc+(p?calcPoints(p,m)||0:0);
                },0);
                return { ...u, pts };
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

      {view === "devices" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {duplicates.length > 0 && (
            <div className="panel" style={{borderColor:"var(--red)"}}>
              <div className="panel-hd" style={{color:"var(--red)"}}>⚠️ Duplicate Devices ({duplicates.length})</div>
              <div className="panel-body">
                {duplicates.map(([devId, emps]) => (
                  <div key={devId} className="dev-row">
                    <div>
                      <div className="dev-emp" style={{color:"var(--red)"}}>🚨 {emps.join(" + ")}</div>
                      <div className="dev-info">Same device ID: {devId.slice(0,24)}...</div>
                    </div>
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
                  <div>
                    <div className="dev-emp">{s.emp_id}</div>
                    <div className="dev-info">{parseUA(s.user_agent||"")} · {parseBrowser(s.user_agent||"")} · {s.device_id?.slice(0,18)}...</div>
                  </div>
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
                <div className="log-emp" style={l.action==="login_failed"?{color:"var(--red)"}:{}}>{l.emp_id || "—"}</div>
                <div className="log-action">
                  <span className={`action-chip ${actionClass[l.action]||""}`}>{l.action}</span>
                  {l.detail}
                </div>
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
  injectCSS();
  const [user, setUser] = useState(getSession);
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
      const raw = Array.isArray(data) ? data : (data.games || data.matches || []);
      if (raw.length === 0) throw new Error();
      setMatches(raw.map(normalise)); setApiOk(true);
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
    } catch(e) { console.error("DB error", e); }
  }, []);

  useEffect(() => { loadMatches(); loadDB(); }, []);
  useEffect(() => { const t = setInterval(() => { loadMatches(); loadDB(); tick(n=>n+1); }, 60000); return () => clearInterval(t); }, []);

  async function handleScoreOverride(matchId, hs, as_) {
    await audit("ADMIN", "score", `Match ${matchId} → ${hs}-${as_}`);
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, home_score: hs, away_score: as_, status: "completed" } : m));
    await loadDB();
    showToast("✓ Score updated!");
  }

  if (!user) return <Auth onLogin={u => { setUser(u); loadDB(); }} />;

  const myPreds = allPreds.filter(p => p.emp_id === user.empId);
  const myPts = matches.filter(m=>m.status==="completed").reduce((acc,m)=>{
    const p = myPreds.find(x=>x.match_id===m.id);
    return acc+(p?calcPoints(p,m)||0:0);
  },0);

  const now = Date.now();
  const upcoming = matches.filter(m => m.status !== "completed" && (!m.datetime || new Date(m.datetime) > now));
  const live = matches.filter(m => m.status === "live");
  const completed = matches.filter(m => m.status === "completed");
  const filtered = filter==="upcoming"?upcoming:filter==="live"?live:filter==="completed"?completed:matches;

  return (
    <div className="app">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      <header className="hdr">
        <div className="hdr-inner">
          <div className="logo">
            <span className="logo-ball">⚽</span>
            <div>
              <div className="logo-text">WC 2026 PREDICTOR</div>
              <div className="logo-sub">City Bank Office League</div>
            </div>
          </div>
          <div className="hdr-right">
            <div className="nav-tabs">
              {[["matches","Matches"],["my","My Picks"],["board","Leaderboard"],["admin","Admin 🔐"]].map(([v,l]) => (
                <button key={v} className={`nav-tab${tab===v?" active":""}`} onClick={() => setTab(v)}>{l}</button>
              ))}
            </div>
            <div className="user-chip">
              <div className="user-avatar">{user.name[0]}</div>
              <div className="user-info">
                <div className="user-name">{user.name}</div>
                <div className="user-pts">{myPts} pts</div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { clearSession(); setUser(null); }}>Sign out</button>
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
        {tab === "matches" && (
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
            {loading
              ? <div className="empty"><span className="spin">⚽</span> Loading matches...</div>
              : filtered.length === 0
                ? <div className="empty">No matches in this category</div>
                : <div className="matches">
                    {filtered.map(m => (
                      <MatchCard key={m.id} match={m} user={user}
                        myPred={myPreds.find(p => p.match_id === m.id)}
                        isAdmin={false} onScoreOverride={()=>{}} onToast={showToast} />
                    ))}
                  </div>}
          </div>
        )}
        {tab === "my" && <MyPicks user={user} matches={matches} myPreds={myPreds} onToast={showToast} />}
        {tab === "board" && <Leaderboard user={user} matches={matches} allUsers={allUsers} allPreds={allPreds} />}
        {tab === "admin" && (
          adminAuthed
            ? <AdminPanel matches={matches} allUsers={allUsers} allPreds={allPreds}
                sessions={sessions} auditLog={auditLog}
                onScoreOverride={handleScoreOverride} onToast={showToast} />
            : <AdminGate onAuth={() => setAdminAuthed(true)} />
        )}
      </div>
    </div>
  );
}