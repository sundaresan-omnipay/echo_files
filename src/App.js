import { useState, useEffect, useCallback, useRef } from "react";
import EchoLogo from "./EchoLogo";

// ─── Supabase client (lightweight, no npm) ───────────────────────────────────
const SUPABASE_URL     = process.env.REACT_APP_SUPABASE_URL     || "https://ewbyjtclhtcnvbrqfwyz.supabase.co";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YnlqdGNsaHRjbnZicnFmd3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwMDYsImV4cCI6MjA5NTQ3NDAwNn0.NxpxEPHmLRSKAtyE7me7BGao-o3VpJqIPaumxu60-yw";
const BUCKET     = "echo_documents";
const OWNER_EMAIL = process.env.REACT_APP_OWNER_EMAIL || "sundaresan@datman.je";

// ─── DB client — headers refresh on every call so auth tokens work ────────────
const _REST  = () => `${SUPABASE_URL}/rest/v1`;
const _STORE = () => `${SUPABASE_URL}/storage/v1`;
const _AUTH  = () => `${SUPABASE_URL}/auth/v1`;

const h = () => {
  const token = localStorage.getItem("echo_token") || SUPABASE_ANON_KEY;
  return { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
};

// ─── Token auto-refresh (keeps the app alive past 1-hour JWT expiry) ─────────
let _refreshing = null;
const _refreshToken = async () => {
  if (_refreshing) return _refreshing;
  const rt = localStorage.getItem("echo_refresh_token");
  if (!rt) return false;
  _refreshing = (async () => {
    try {
      const r = await fetch(`${_AUTH()}/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!r.ok) {
        localStorage.removeItem("echo_token");
        localStorage.removeItem("echo_refresh_token");
        return false;
      }
      const data = await r.json();
      if (data.access_token) {
        localStorage.setItem("echo_token", data.access_token);
        if (data.refresh_token) localStorage.setItem("echo_refresh_token", data.refresh_token);
        return true;
      }
    } catch {}
    return false;
  })().finally(() => { _refreshing = null; });
  return _refreshing;
};

const db = {
  auth: {
    signIn: async (email, password) => {
      const r = await fetch(`${_AUTH()}/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      return r.json();
    },
    signUp: async (email, password) => {
      const r = await fetch(`${_AUTH()}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      return r.json();
    },
    signOut: async () => {
      const token = localStorage.getItem("echo_token");
      if (token) {
        await fetch(`${_AUTH()}/logout`, {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
      localStorage.removeItem("echo_token");
      localStorage.removeItem("echo_refresh_token");
    },
    getUser: async () => {
      let token = localStorage.getItem("echo_token");
      if (!token) {
        const ok = await _refreshToken();
        if (!ok) return null;
        token = localStorage.getItem("echo_token");
      }
      const r = await fetch(`${_AUTH()}/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const ok = await _refreshToken();
        if (!ok) { localStorage.removeItem("echo_token"); return null; }
        token = localStorage.getItem("echo_token");
        const r2 = await fetch(`${_AUTH()}/user`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        });
        if (!r2.ok) { localStorage.removeItem("echo_token"); return null; }
        return r2.json();
      }
      return r.json();
    },
  },
  from: (table) => ({
    select: async (cols = "*", opts = {}) => {
      let url = `${_REST()}/${table}?select=${cols}`;
      if (opts.eq) url += `&${opts.eq[0]}=eq.${opts.eq[1]}`;
      if (opts.order) url += `&order=${opts.order}`;
      let r = await fetch(url, { headers: h() });
      if (r.status === 401) {
        const ok = await _refreshToken();
        if (ok) r = await fetch(url, { headers: h() });
      }
      if (!r.ok) return [];
      return r.json();
    },
    insert: async (data) => {
      const r = await fetch(`${_REST()}/${table}`, {
        method: "POST",
        headers: { ...h(), Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      return r.json();
    },
    update: async (data, id) => {
      const r = await fetch(`${_REST()}/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...h(), Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      return r.json();
    },
    delete: async (id) => {
      await fetch(`${_REST()}/${table}?id=eq.${id}`, { method: "DELETE", headers: h() });
    },
    upsert: async (data, onConflict) => {
      const qs = onConflict ? `?on_conflict=${onConflict}` : "";
      const r = await fetch(`${_REST()}/${table}${qs}`, {
        method: "POST",
        headers: { ...h(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(data),
      });
      return r.json();
    },
    deleteWhere: async (filters) => {
      const qs = Object.entries(filters).map(([k, v]) => `${k}=eq.${v}`).join("&");
      await fetch(`${_REST()}/${table}?${qs}`, { method: "DELETE", headers: h() });
    },
  }),
  storage: {
    upload: async (path, file) => {
      const token = localStorage.getItem("echo_token") || SUPABASE_ANON_KEY;
      const r = await fetch(`${_STORE()}/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": file.type, "x-upsert": "true" },
        body: file,
      });
      return r.json();
    },
    getPublicUrl: (path) => `${_STORE()}/object/public/${BUCKET}/${path}`,
    remove: async (paths) => {
      const r = await fetch(`${_STORE()}/object/${BUCKET}`, {
        method: "DELETE", headers: h(), body: JSON.stringify({ prefixes: paths }),
      });
      return r.json();
    },
  },
};

// ─── Column feature probe (fires once on mount, prevents PGRST204 on save) ───
let _faCheck = null;
let _faSupported = null;
const probeFocusAreas = () => {
  if (_faSupported !== null) return Promise.resolve(_faSupported);
  if (_faCheck) return _faCheck;
  _faCheck = fetch(`${_REST()}/diary_entries?select=focus_areas&limit=0`, { headers: h() })
    .then(r => { _faSupported = r.ok; return r.ok; })
    .catch(() => { _faSupported = false; return false; })
    .finally(() => { _faCheck = null; });
  return _faCheck;
};

// ─── Teammate relationship column probe ──────────────────────────────────────
let _tmRelCheck = null;
let _tmRelSupported = null;
const probeTeammateRelationship = () => {
  if (_tmRelSupported !== null) return Promise.resolve(_tmRelSupported);
  if (_tmRelCheck) return _tmRelCheck;
  _tmRelCheck = fetch(`${_REST()}/teammates?select=relationship&limit=0`, { headers: h() })
    .then(r => { _tmRelSupported = r.ok; return r.ok; })
    .catch(() => { _tmRelSupported = false; return false; })
    .finally(() => { _tmRelCheck = null; });
  return _tmRelCheck;
};

// ─── is_win column probe ─────────────────────────────────────────────────────
let _winCheck = null;
let _winSupported = null;
const probeIsWin = () => {
  if (_winSupported !== null) return Promise.resolve(_winSupported);
  if (_winCheck) return _winCheck;
  _winCheck = fetch(`${_REST()}/diary_entries?select=is_win&limit=0`, { headers: h() })
    .then(r => { _winSupported = r.ok; return r.ok; })
    .catch(() => { _winSupported = false; return false; })
    .finally(() => { _winCheck = null; });
  return _winCheck;
};

// ─── teammates.agenda_queue column probe ─────────────────────────────────────
let _agqCheck = null;
let _agqSupported = null;
const probeAgendaQueue = () => {
  if (_agqSupported !== null) return Promise.resolve(_agqSupported);
  if (_agqCheck) return _agqCheck;
  _agqCheck = fetch(`${_REST()}/teammates?select=agenda_queue&limit=0`, { headers: h() })
    .then(r => { _agqSupported = r.ok; return r.ok; })
    .catch(() => { _agqSupported = false; return false; })
    .finally(() => { _agqCheck = null; });
  return _agqCheck;
};

let _catCheck = null;
let _catSupported = null;
const probeCategories = () => {
  if (_catSupported !== null) return Promise.resolve(_catSupported);
  if (_catCheck) return _catCheck;
  _catCheck = fetch(`${_REST()}/diary_entries?select=categories&limit=0`, { headers: h() })
    .then(r => { _catSupported = r.ok; return r.ok; })
    .catch(() => { _catSupported = false; return false; })
    .finally(() => { _catCheck = null; });
  return _catCheck;
};

let _attCheck = null;
let _attSupported = null;
const probeAttendance = () => {
  if (_attSupported !== null) return Promise.resolve(_attSupported);
  if (_attCheck) return _attCheck;
  _attCheck = fetch(`${_REST()}/diary_entries?select=team_attendance&limit=0`, { headers: h() })
    .then(r => { _attSupported = r.ok; return r.ok; })
    .catch(() => { _attSupported = false; return false; })
    .finally(() => { _attCheck = null; });
  return _attCheck;
};

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || "";
async function callGroq(bullets, knownPeople = []) {
  if (!bullets.length) return null;
  if (!GROQ_API_KEY) throw new Error("AI categorisation is not configured — REACT_APP_GROQ_API_KEY is missing from the build.");
  const teamCtx = knownPeople.length ? `\nKnown team members (use these exact spellings when they appear): ${knownPeople.join(", ")}.` : "";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: `You are a professional work diary assistant. For each work item, do TWO things:\n1. Categorise into one of: meeting (calls, standups, 1:1s, planning, discussions with people), execution (coding, building, shipping, fixing, implementing, writing), validation (testing, PR reviews, QA, debugging, verifying, signoff), other (admin, reading, unclear).\n2. Rewrite it in clear, professional English suitable for a performance review or work report. Rules for rewriting: keep ALL names, project names, system names, and ticket IDs exactly as given — do NOT invent or change them. Use past tense. Improve grammar and clarity only. Do not add information not present in the original.\n3. Extract any person names mentioned.${teamCtx}\nReturn JSON only — each category array contains the REWRITTEN (professional) version of the item, not the raw version: {"meeting":[],"execution":[],"validation":[],"other":[],"people":[]}` },
        { role: "user", content: `Work items to categorise and rewrite:\n${bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2048,
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Groq error ${res.status}`);
  const parsed = JSON.parse(json.choices[0].message.content);
  // Normalize: ensure each category array contains only strings (model sometimes returns objects)
  const toStr = v => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      // Try every common key the model uses, case-insensitive
      const val = v.text || v.item || v.content || v.name || v.Name || v.value || v.label
        || Object.values(v).find(x => typeof x === "string");
      return val || JSON.stringify(v);
    }
    return String(v);
  };
  ["meeting", "execution", "validation", "other", "people"].forEach(k => {
    if (Array.isArray(parsed[k])) parsed[k] = [...new Set(parsed[k].map(toStr).filter(Boolean))];
  });
  return parsed;
}

// Cleans a collaborator value — handles cases where Groq returned an object that got
// JSON.stringify'd and saved as a literal string like '{"Name":"Ramveer"}'
const cleanCollab = c => {
  if (!c || typeof c !== "string") return c ? String(c) : "";
  const t = c.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const obj = JSON.parse(t);
      return obj.name || obj.Name || obj.text || obj.item || obj.content || obj.value
        || Object.values(obj).find(x => typeof x === "string") || t;
    } catch { return t; }
  }
  return t;
};

// Renders text with URLs as clickable <a> links (used in diary view modal content)
const linkify = (text) => {
  if (!text) return null;
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: T.accent2, wordBreak: "break-all" }}>{part}</a>
      : part
  );
};

// ─── SQL Setup hint (run once in Supabase SQL editor) ───────────────────────
// CREATE TABLE diary_entries (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   date date NOT NULL,
//   ticket_number text,
//   title text NOT NULL,
//   feedback text,
//   mood text,
//   tags text[],
//   content text,
//   created_at timestamptz DEFAULT now()
// );
// CREATE TABLE documents (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   name text NOT NULL,
//   category text,
//   description text,
//   file_path text NOT NULL,
//   file_size bigint,
//   file_type text,
//   tags text[],
//   created_at timestamptz DEFAULT now()
// );
// Also create a public storage bucket named "echo-documents"

// ─── New tables (run in Supabase SQL editor) ────────────────────────────────
// create table scratch_pad (id uuid primary key default gen_random_uuid(), user_id uuid unique not null, content text default '', updated_at timestamptz default now()); alter table scratch_pad enable row level security; create policy "own" on scratch_pad for all using (auth.uid()=user_id);
// create table teammates (id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, role text default '', emoji text default '', inserted_at timestamptz default now()); alter table teammates enable row level security; create policy "own" on teammates for all using (auth.uid()=user_id);
// create table starred_entries (user_id uuid not null, entry_id uuid not null, primary key (user_id, entry_id)); alter table starred_entries enable row level security; create policy "own" on starred_entries for all using (auth.uid()=user_id);
// create table user_credits (id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null, person text not null, what text not null, project text default '', date date not null default current_date, inserted_at timestamptz default now()); alter table user_credits enable row level security; create policy "own" on user_credits for all using (auth.uid()=user_id);
// create table resolve_habits (id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, emoji text default '✊', created_at date not null default current_date, last_slip date, slip_history jsonb default '[]', inserted_at timestamptz default now()); alter table resolve_habits enable row level security; create policy "own" on resolve_habits for all using (auth.uid()=user_id);
// create table pattern_interrupts (id uuid primary key default gen_random_uuid(), user_id uuid not null, text text not null, created_at timestamptz default now()); alter table pattern_interrupts enable row level security; create policy "own" on pattern_interrupts for all using (auth.uid()=user_id);
// create table one_on_one_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, teammate_id uuid references teammates(id) on delete cascade, teammate_name text not null, session_date date not null default current_date, topics text default '', notes text default '', action_items jsonb default '[]', feedback_given jsonb default '[]', sentiment text default 'positive', next_session_date date, inserted_at timestamptz default now()); alter table one_on_one_sessions enable row level security; create policy "own" on one_on_one_sessions for all using (auth.uid()=user_id);
// ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS focus_areas jsonb DEFAULT '[]';
// ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS is_win boolean DEFAULT false;
// ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS win_tags jsonb DEFAULT '[]';
// ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS team_attendance jsonb DEFAULT '[]';
// ALTER TABLE teammates ADD COLUMN IF NOT EXISTS relationship text DEFAULT 'direct';
// ALTER TABLE teammates ADD COLUMN IF NOT EXISTS agenda_queue jsonb DEFAULT '[]';
// create table commitments (id uuid primary key default gen_random_uuid(), user_id uuid not null, direction text not null, person text not null, what text not null, source text default 'manual', resolved_at timestamptz, inserted_at timestamptz default now()); alter table commitments enable row level security; create policy "own" on commitments for all using (auth.uid()=user_id);
// create table incidents (id uuid primary key default gen_random_uuid(), user_id uuid not null, date date not null default current_date, type text not null default 'escaped_defect', module text default '', root_cause text default '', test_gap text default '', severity text default 'medium', notes text default '', inserted_at timestamptz default now()); alter table incidents enable row level security; create policy "own" on incidents for all using (auth.uid()=user_id);
// create table decisions (id uuid primary key default gen_random_uuid(), user_id uuid not null, date date not null default current_date, decision text not null, context text default '', people text default '', inserted_at timestamptz default now()); alter table decisions enable row level security; create policy "own" on decisions for all using (auth.uid()=user_id);

// ─── Design tokens ───────────────────────────────────────────────────────────
const T = {
  navy0: "#0a0e1a",
  navy1: "#0d1526",
  navy2: "#111c33",
  navy3: "#162040",
  navy4: "#1c2a52",
  navy5: "#243366",
  accent: "#4f8ef7",
  accentDim: "#2d5fcc",
  accentGlow: "rgba(79,142,247,0.18)",
  gold: "#e8c66a",
  goldDim: "#b8962a",
  teal: "#3fcfb4",
  coral: "#f07562",
  green: "#4ecb8d",
  text1: "#e8eef8",
  text2: "#9bacc8",
  text3: "#5c6e90",
  border: "rgba(79,142,247,0.15)",
  borderHover: "rgba(79,142,247,0.35)",
  glass: "rgba(16,24,48,0.7)",
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const injectStyles = () => {
  if (document.getElementById("echo-styles")) return;
  const style = document.createElement("style");
  style.id = "echo-styles";
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .echo-root {
      font-family: 'DM Sans', sans-serif;
      background: ${T.navy0};
      color: ${T.text1};
      min-height: 100vh;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    .echo-root::before {
      content: '';
      position: fixed;
      inset: 0;
      background:
        radial-gradient(ellipse 80% 60% at 20% -10%, rgba(79,142,247,0.08) 0%, transparent 60%),
        radial-gradient(ellipse 60% 50% at 80% 110%, rgba(63,207,180,0.05) 0%, transparent 60%);
      pointer-events: none;
      z-index: 0;
    }

    /* ── Sidebar ── */
    .echo-sidebar {
      width: 240px;
      height: 100vh;
      background: ${T.navy1};
      border-right: 1px solid ${T.border};
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      z-index: 10;
      flex-shrink: 0;
      overflow: hidden;
    }

    .echo-logo {
      padding: 28px 24px 20px;
      border-bottom: 1px solid ${T.border};
    }

    .echo-logo-sub {
      font-size: 11px;
      color: ${T.text3};
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-top: 2px;
    }

    .echo-nav {
      padding: 16px 12px;
      flex: 1;
      overflow-y: auto;
    }

    .echo-nav-section {
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: ${T.text3};
      padding: 12px 12px 6px;
    }

    .echo-nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: ${T.text2};
      transition: all 0.15s ease;
      border: 1px solid transparent;
    }

    .echo-nav-item:hover {
      background: rgba(79,142,247,0.08);
      color: ${T.text1};
    }

    .echo-nav-item.active {
      background: rgba(79,142,247,0.12);
      border-color: ${T.border};
      color: ${T.accent};
    }

    .echo-nav-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .echo-sidebar-footer {
      padding: 16px;
      border-top: 1px solid ${T.border};
      font-size: 12px;
      color: ${T.text3};
    }

    /* ── Main ── */
    .echo-main {
      flex: 1;
      overflow-y: auto;
      position: relative;
      z-index: 1;
    }

    .echo-topbar {
      position: sticky;
      top: 0;
      background: rgba(10,14,26,0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid ${T.border};
      padding: 14px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 50;
    }

    .echo-page-title {
      font-size: 18px;
      font-weight: 500;
      color: ${T.text1};
    }

    .echo-page-sub {
      font-size: 13px;
      color: ${T.text3};
      margin-top: 2px;
    }

    .echo-content {
      padding: 32px;
      max-width: 1100px;
    }

    /* ── Cards ── */
    .card {
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 12px;
      padding: 20px 24px;
    }

    .card-glass {
      background: ${T.glass};
      backdrop-filter: blur(8px);
      border: 1px solid ${T.border};
      border-radius: 12px;
      padding: 20px 24px;
    }

    /* ── Buttons ── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      border: 1px solid transparent;
    }

    .btn-primary {
      background: ${T.accent};
      color: #fff;
      border-color: ${T.accent};
    }

    .btn-primary:hover {
      background: #3d7ee8;
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(79,142,247,0.3);
    }

    .btn-ghost {
      background: transparent;
      color: ${T.text2};
      border-color: ${T.border};
    }

    .btn-ghost:hover {
      background: rgba(79,142,247,0.08);
      color: ${T.text1};
      border-color: ${T.borderHover};
    }

    .btn-danger {
      background: transparent;
      color: #f07562;
      border-color: rgba(240,117,98,0.3);
    }

    .btn-danger:hover {
      background: rgba(240,117,98,0.1);
    }

    .btn-sm { padding: 5px 10px; font-size: 12px; }

    /* ── Form elements ── */
    .form-group { margin-bottom: 18px; }

    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: ${T.text3};
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 7px;
    }

    .form-input, .form-textarea, .form-select {
      width: 100%;
      background: ${T.navy1};
      border: 1px solid ${T.border};
      border-radius: 8px;
      color: ${T.text1};
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      padding: 9px 12px;
      transition: border-color 0.15s;
      outline: none;
    }

    .form-input:focus, .form-textarea:focus, .form-select:focus {
      border-color: ${T.accent};
      box-shadow: 0 0 0 3px rgba(79,142,247,0.1);
    }

    .form-textarea { resize: vertical; min-height: 100px; }

    .form-select option { background: ${T.navy2}; }

    /* ── Tags ── */
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 9px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid;
    }

    .tag-blue { background: rgba(79,142,247,0.12); color: ${T.accent}; border-color: rgba(79,142,247,0.25); }
    .tag-gold { background: rgba(232,198,106,0.12); color: ${T.gold}; border-color: rgba(232,198,106,0.25); }
    .tag-teal { background: rgba(63,207,180,0.12); color: ${T.teal}; border-color: rgba(63,207,180,0.25); }
    .tag-coral { background: rgba(240,117,98,0.12); color: ${T.coral}; border-color: rgba(240,117,98,0.25); }
    .tag-green { background: rgba(78,203,141,0.12); color: ${T.green}; border-color: rgba(78,203,141,0.25); }

    /* ── Diary entries ── */
    .diary-entry {
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 12px;
      padding: 18px 22px;
      cursor: pointer;
      transition: all 0.18s ease;
      position: relative;
      overflow: hidden;
    }

    .diary-entry::before {
      content: '';
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: ${T.accent};
      opacity: 0;
      transition: opacity 0.18s;
    }

    .diary-entry:hover {
      border-color: ${T.borderHover};
      background: rgba(22,32,64,0.9);
      transform: translateX(2px);
    }

    .diary-entry:hover::before { opacity: 1; }

    /* ── Document cards ── */
    .doc-card {
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 12px;
      padding: 18px;
      transition: all 0.18s ease;
      cursor: pointer;
    }

    .doc-card:hover {
      border-color: ${T.borderHover};
      background: rgba(22,32,64,0.9);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .doc-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      margin-bottom: 12px;
    }

    /* ── Mood badges ── */
    .mood-btn {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      border: 1px solid ${T.border};
      background: transparent;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s;
    }

    .mood-btn:hover, .mood-btn.selected {
      background: rgba(79,142,247,0.12);
      border-color: ${T.accent};
      transform: scale(1.1);
    }

    /* ── Upload zone ── */
    .upload-zone {
      border: 2px dashed ${T.border};
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.18s;
    }

    .upload-zone:hover, .upload-zone.drag-over {
      border-color: ${T.accent};
      background: rgba(79,142,247,0.05);
    }

    /* ── Search ── */
    .search-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      background: ${T.navy1};
      border: 1px solid ${T.border};
      border-radius: 8px;
      padding: 0 12px;
    }

    .search-bar input {
      background: transparent;
      border: none;
      outline: none;
      color: ${T.text1};
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      padding: 9px 0;
      flex: 1;
    }

    .search-bar input::placeholder { color: ${T.text3}; }

    /* ── Modal ── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(5,8,16,0.75);
      backdrop-filter: blur(4px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal {
      background: ${T.navy1};
      border: 1px solid ${T.border};
      border-radius: 16px;
      padding: 28px;
      width: 100%;
      max-width: 580px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    }

    .modal-title {
      font-size: 18px;
      font-weight: 600;
      color: ${T.text1};
      margin-bottom: 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* ── Stats ── */
    .stat-card {
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 12px;
      padding: 16px 20px;
    }

    .stat-value {
      font-size: 28px;
      font-weight: 600;
      color: ${T.text1};
      font-family: 'DM Mono', monospace;
    }

    .stat-label {
      font-size: 12px;
      color: ${T.text3};
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 4px;
    }

    /* ── Date badge ── */
    .date-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 46px;
      border-radius: 10px;
      background: rgba(79,142,247,0.1);
      border: 1px solid rgba(79,142,247,0.2);
      flex-shrink: 0;
    }

    .date-badge-day {
      font-size: 17px;
      font-weight: 600;
      color: ${T.accent};
      font-family: 'DM Mono', monospace;
      line-height: 1;
    }

    .date-badge-mon {
      font-size: 9px;
      color: ${T.text3};
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    /* ── Ticket chip ── */
    .ticket-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(232,198,106,0.1);
      border: 1px solid rgba(232,198,106,0.25);
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
      color: ${T.gold};
      font-family: 'DM Mono', monospace;
    }

    /* ── File type icon colors ── */
    .ftype-pdf { background: rgba(240,117,98,0.12); color: ${T.coral}; }
    .ftype-img { background: rgba(63,207,180,0.12); color: ${T.teal}; }
    .ftype-doc { background: rgba(79,142,247,0.12); color: ${T.accent}; }
    .ftype-xls { background: rgba(78,203,141,0.12); color: ${T.green}; }
    .ftype-zip { background: rgba(232,198,106,0.12); color: ${T.gold}; }
    .ftype-gen { background: rgba(156,113,230,0.12); color: #9c71e6; }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(79,142,247,0.25); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(79,142,247,0.4); }

    /* ── Misc ── */
    .divider { border: none; border-top: 1px solid ${T.border}; margin: 16px 0; }
    .mono { font-family: 'DM Mono', monospace; }
    .flex { display: flex; }
    .flex-col { display: flex; flex-direction: column; }
    .gap-8 { gap: 8px; }
    .gap-12 { gap: 12px; }
    .gap-16 { gap: 16px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .mt-8 { margin-top: 8px; }
    .mt-16 { margin-top: 16px; }
    .mt-24 { margin-top: 24px; }
    .mb-8 { margin-bottom: 8px; }
    .mb-16 { margin-bottom: 16px; }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fade-in { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    /* ── Diary tabs ── */
    .diary-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid ${T.border};
      margin-bottom: 22px;
    }
    .diary-tab {
      padding: 9px 18px;
      font-size: 13px;
      font-weight: 500;
      color: ${T.text3};
      border: none;
      background: transparent;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: all 0.15s;
      font-family: 'DM Sans', sans-serif;
    }
    .diary-tab:hover { color: ${T.text2}; }
    .diary-tab.active { color: ${T.accent}; border-bottom-color: ${T.accent}; }

    /* ── Diary view sub-sections ── */
    .diary-section-heading {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: ${T.text3};
      margin-bottom: 10px;
      padding-bottom: 7px;
      border-bottom: 1px solid ${T.border};
    }

    /* ── Team / Feedback cards ── */
    .team-card {
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 10px;
      padding: 11px 14px;
      margin-bottom: 8px;
    }

    /* ── Checklist items ── */
    .checklist-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 8px;
      margin-bottom: 6px;
    }

    /* ── Small status / priority badges ── */
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 600;
      border: 1px solid;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* ── Focus area badge ── */
    .focus-badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      background: rgba(79,142,247,0.1);
      color: ${T.accent};
      border: 1px solid rgba(79,142,247,0.2);
    }

    /* ── Entry stat badges (list view) ── */
    .entry-stat-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 500;
      background: rgba(79,142,247,0.07);
      color: ${T.text3};
      border: 1px solid ${T.border};
    }

    .config-banner {
      background: rgba(232,198,106,0.08);
      border: 1px solid rgba(232,198,106,0.25);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 13px;
      color: ${T.gold};
      margin-bottom: 20px;
    }

    /* ── Auth page ── */
    @keyframes authOrbDrift {
      0%   { transform: translate(0, 0) scale(1); }
      33%  { transform: translate(30px, -40px) scale(1.08); }
      66%  { transform: translate(-20px, 20px) scale(0.95); }
      100% { transform: translate(0, 0) scale(1); }
    }
    @keyframes authOrbDrift2 {
      0%   { transform: translate(0, 0) scale(1); }
      33%  { transform: translate(-40px, 30px) scale(1.05); }
      66%  { transform: translate(25px, -25px) scale(0.97); }
      100% { transform: translate(0, 0) scale(1); }
    }
    @keyframes authFadeUp {
      from { opacity: 0; transform: translateY(18px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes authLogoShimmer {
      0%,100% { opacity: 1; }
      50%      { opacity: 0.82; }
    }
    @keyframes authSpinDot {
      0%   { transform: rotate(0deg) translateX(12px); }
      100% { transform: rotate(360deg) translateX(12px); }
    }

    .auth-root {
      min-height: 100vh;
      display: flex;
      font-family: 'DM Sans', sans-serif;
      background: ${T.navy0};
    }

    /* Left brand panel */
    .auth-brand {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: ${T.navy1};
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 60px 56px;
      border-right: 1px solid ${T.border};
    }
    .auth-brand::before {
      content: '';
      position: absolute;
      width: 520px; height: 520px;
      border-radius: 50%;
      background: radial-gradient(circle, ${T.accent}22 0%, transparent 70%);
      top: -180px; left: -120px;
      animation: authOrbDrift 14s ease-in-out infinite;
      pointer-events: none;
    }
    .auth-brand::after {
      content: '';
      position: absolute;
      width: 420px; height: 420px;
      border-radius: 50%;
      background: radial-gradient(circle, ${T.teal}18 0%, transparent 70%);
      bottom: -140px; right: -80px;
      animation: authOrbDrift2 18s ease-in-out infinite;
      pointer-events: none;
    }
    .auth-brand-logo {
      display: flex;
      align-items: center;
      line-height: 1;
      margin-bottom: 10px;
    }
    .auth-brand-tagline {
      font-size: 16px;
      color: ${T.text2};
      margin-bottom: 52px;
      font-weight: 300;
      letter-spacing: 0.2px;
      line-height: 1.5;
    }
    .auth-feature {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border-radius: 12px;
      margin-bottom: 10px;
      background: rgba(79,142,247,0.04);
      border: 1px solid ${T.border};
      animation: authFadeUp 0.5s ease both;
      transition: border-color 0.2s, background 0.2s;
    }
    .auth-feature:hover {
      border-color: ${T.borderHover};
      background: rgba(79,142,247,0.08);
    }
    .auth-feature-icon {
      width: 36px; height: 36px;
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
      font-size: 17px;
      flex-shrink: 0;
    }
    .auth-feature-title {
      font-size: 13px;
      font-weight: 600;
      color: ${T.text1};
      margin-bottom: 1px;
    }
    .auth-feature-sub {
      font-size: 11px;
      color: ${T.text3};
    }
    .auth-brand-footer {
      margin-top: 40px;
      font-size: 11px;
      color: ${T.text3};
      letter-spacing: 0.3px;
    }

    /* Right form panel */
    .auth-form-panel {
      width: 420px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 60px 48px;
      position: relative;
    }
    .auth-form-inner {
      animation: authFadeUp 0.45s ease both;
    }
    .auth-form-heading {
      font-size: 22px;
      font-weight: 700;
      color: ${T.text1};
      margin-bottom: 6px;
    }
    .auth-form-sub {
      font-size: 13px;
      color: ${T.text3};
      margin-bottom: 32px;
    }
    .auth-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid ${T.border};
      margin-bottom: 28px;
    }
    .auth-tab {
      padding: 8px 0;
      margin-right: 24px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: none;
      color: ${T.text3};
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: all 0.15s;
      font-family: 'DM Sans', sans-serif;
      letter-spacing: 0.1px;
    }
    .auth-tab.active {
      color: ${T.text1};
      border-bottom-color: ${T.accent};
    }
    .auth-field {
      margin-bottom: 20px;
    }
    .auth-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: ${T.text3};
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 7px;
    }
    .auth-input-wrap {
      position: relative;
    }
    .auth-input {
      width: 100%;
      background: ${T.navy2};
      border: 1px solid ${T.border};
      border-radius: 10px;
      color: ${T.text1};
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      padding: 12px 14px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .auth-input:focus {
      border-color: ${T.accent};
      box-shadow: 0 0 0 3px ${T.accentGlow};
    }
    .auth-input::placeholder { color: ${T.text3}; }
    .auth-eye {
      position: absolute;
      right: 13px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: ${T.text3};
      cursor: pointer;
      font-size: 14px;
      padding: 2px;
      line-height: 1;
    }
    .auth-eye:hover { color: ${T.text2}; }
    .auth-btn {
      width: 100%;
      padding: 13px 0;
      background: linear-gradient(135deg, ${T.accentDim} 0%, ${T.accent} 100%);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: 'DM Sans', sans-serif;
      letter-spacing: 0.2px;
      transition: all 0.2s;
      box-shadow: 0 4px 16px rgba(79,142,247,0.25);
      margin-top: 4px;
    }
    .auth-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 24px rgba(79,142,247,0.38);
    }
    .auth-btn:active:not(:disabled) { transform: translateY(0); }
    .auth-btn:disabled {
      background: ${T.navy3};
      color: ${T.text3};
      box-shadow: none;
      cursor: not-allowed;
    }
    .auth-msg {
      border-radius: 9px;
      padding: 11px 13px;
      margin-bottom: 18px;
      font-size: 13px;
      line-height: 1.5;
    }
    .auth-msg.error {
      background: rgba(240,117,98,0.09);
      border: 1px solid rgba(240,117,98,0.28);
      color: ${T.coral};
    }
    .auth-msg.info {
      background: rgba(63,207,180,0.09);
      border: 1px solid rgba(63,207,180,0.28);
      color: ${T.teal};
    }
    .auth-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 22px 0;
      color: ${T.text3};
      font-size: 11px;
    }
    .auth-divider::before, .auth-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: ${T.border};
    }
    .auth-switch {
      text-align: center;
      font-size: 12px;
      color: ${T.text3};
      margin-top: 20px;
    }
    .auth-switch span {
      color: ${T.accent};
      cursor: pointer;
      font-weight: 500;
    }
    .auth-switch span:hover { text-decoration: underline; }

    @media (max-width: 720px) {
      .auth-brand { display: none; }
      .auth-form-panel { width: 100%; padding: 40px 28px; }
    }

    /* ── Pattern Interrupt ── */
    @keyframes piSlideUp {
      from { opacity: 0; transform: translateY(28px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .pi-backdrop {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(5,8,16,0.9); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .pi-card {
      background: ${T.navy2}; border: 1px solid rgba(240,117,98,0.35);
      border-radius: 20px; padding: 40px 44px; max-width: 500px; width: 100%;
      box-shadow: 0 30px 80px rgba(240,117,98,0.12);
      animation: piSlideUp 0.38s cubic-bezier(0.34,1.3,0.64,1);
    }

    /* ── Shadow Resume ── */
    @keyframes resumeIn {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .resume-section { animation: resumeIn 0.4s ease both; }

    /* ── Rut Alert ── */
    @keyframes rutPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(232,198,106,0.25); }
      55%       { box-shadow: 0 0 0 10px rgba(232,198,106,0); }
    }
    .rut-alert { animation: rutPulse 2.8s ease-in-out infinite; }

    /* ── Work Map ── */
    .wm-node { cursor: pointer; }
    .wm-edge { pointer-events: none; }

    /* ── Credit Tracker ── */
    .credit-given    { background: rgba(63,207,180,0.1); color: ${T.teal}; border: 1px solid rgba(63,207,180,0.25); }
    .credit-received { background: rgba(232,198,106,0.1); color: ${T.gold}; border: 1px solid rgba(232,198,106,0.25); }

    /* ── Mobile drawer ── */
    .echo-hamburger {
      display: none;
      background: transparent; border: none;
      color: ${T.text2}; cursor: pointer;
      font-size: 22px; padding: 4px 8px;
      line-height: 1; border-radius: 6px;
      align-items: center; justify-content: center;
      margin-right: 8px;
    }
    .echo-hamburger:hover { background: rgba(255,255,255,0.06); }
    .mobile-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 199;
      background: rgba(5,8,16,0.72);
      backdrop-filter: blur(3px);
    }
    @media (max-width: 768px) {
      .echo-sidebar {
        position: fixed;
        top: 0; left: 0; bottom: 0;
        transform: translateX(-100%);
        transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
        z-index: 200;
        width: 268px;
        box-shadow: none;
      }
      .echo-sidebar.mob-open {
        transform: translateX(0);
        box-shadow: 6px 0 48px rgba(0,0,0,0.65);
      }
      .mobile-overlay.mob-open { display: block; }
      .echo-hamburger { display: flex; }
      .echo-topbar { padding: 11px 16px; }
      .echo-page-title { font-size: 16px; }
      .echo-page-sub { display: none; }
    }
  `;
  document.head.appendChild(style);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const today = () => new Date().toISOString().split("T")[0];

function fmtDate(d) {
  const dt = new Date(d + "T00:00:00");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

function fileTypeInfo(name = "", mime = "") {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["pdf"].includes(ext)) return { icon: "📄", cls: "ftype-pdf", label: "PDF" };
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return { icon: "🖼️", cls: "ftype-img", label: "Image" };
  if (["doc","docx"].includes(ext)) return { icon: "📝", cls: "ftype-doc", label: "Word" };
  if (["xls","xlsx","csv"].includes(ext)) return { icon: "📊", cls: "ftype-xls", label: "Sheet" };
  if (["zip","rar","7z"].includes(ext)) return { icon: "🗜️", cls: "ftype-zip", label: "Archive" };
  return { icon: "📎", cls: "ftype-gen", label: ext?.toUpperCase() || "File" };
}

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const MOODS = [
  { emoji: "🚀", label: "Productive", key: "productive" },
  { emoji: "✅", label: "Resolved", key: "resolved" },
  { emoji: "⚡", label: "Challenged", key: "challenged" },
  { emoji: "😤", label: "Frustrated", key: "frustrated" },
  { emoji: "🤝", label: "Collaborative", key: "collaborative" },
];

const FOCUS_AREAS = [
  "Test Execution", "Automation", "Code Review", "Mentoring",
  "Sprint Planning", "Debugging", "CI/CD", "Meetings", "Documentation", "Release",
  "Deployment", "Incident Response", "Performance", "Security", "Refactoring",
  "Architecture", "Feature Development", "Bug Fixing", "Planning", "Stakeholder Sync",
];

const getFocusAreas = (e) => e.focus_areas?.length ? e.focus_areas : (e.focus_area ? [e.focus_area] : []);

const TEAM_STATUSES = [
  { key: "excellent", label: "Excellent", color: T.green },
  { key: "on_track",  label: "On Track",  color: T.teal  },
  { key: "needs_help",label: "Needs Help",color: T.gold  },
  { key: "blocked",   label: "Blocked",   color: T.coral },
];

const FEEDBACK_TYPES = [
  { key: "praise",      label: "Praise",      color: T.teal  },
  { key: "constructive",label: "Constructive",color: T.gold  },
  { key: "critical",    label: "Critical",    color: T.coral },
];

const PRIORITIES = [
  { key: "high",  label: "High", color: T.coral },
  { key: "medium",label: "Med",  color: T.gold  },
  { key: "low",   label: "Low",  color: T.teal  },
];

const ATT_STATUSES = [
  { key: "office", label: "In Office", icon: "🏢", color: T.teal   },
  { key: "wfh",    label: "WFH",       icon: "🏠", color: T.accent },
  { key: "leave",  label: "Leave",     icon: "🏖️", color: T.coral  },
  { key: "half",   label: "Half Day",  icon: "🕐", color: T.amber  },
];
const attColor = (k) => ATT_STATUSES.find(s => s.key === k)?.color || T.text3;

const RELEASE_STATUSES = [
  { key: "released", label: "Released",   icon: "✅", color: "#4CAF50" },
  { key: "today",    label: "Today",      icon: "🚀", color: T.teal    },
  { key: "review",   label: "In Review",  icon: "🔄", color: T.accent  },
  { key: "eta",      label: "ETA Pending",icon: "⏳", color: T.amber   },
  { key: "nextweek", label: "Next Week",  icon: "📅", color: T.text2   },
  { key: "blocked",  label: "Blocked",    icon: "🔴", color: T.coral   },
  { key: "leave",    label: "On Leave",   icon: "🏖️", color: T.text3   },
];

const statusColor   = (s) => TEAM_STATUSES.find(x => x.key === s)?.color   || T.text3;
const feedbackColor = (t) => FEEDBACK_TYPES.find(x => x.key === t)?.color  || T.text3;
const priorityColor = (p) => PRIORITIES.find(x => x.key === p)?.color      || T.text3;

const WIN_TAGS = [
  { key: "quality",    label: "Quality",    color: T.teal,    icon: "🎯" },
  { key: "velocity",   label: "Velocity",   color: T.accent,  icon: "⚡" },
  { key: "mentorship", label: "Mentorship", color: T.gold,    icon: "🌱" },
  { key: "process",    label: "Process",    color: "#A78BFA", icon: "⚙️" },
  { key: "cost",       label: "Cost Saved", color: T.green,   icon: "💰" },
];

const INCIDENT_TYPES = [
  { key: "escaped_defect", label: "Escaped Defect",   color: T.coral,   icon: "🐛" },
  { key: "prod_issue",     label: "Prod Issue",        color: "#FF6B6B", icon: "🚨" },
  { key: "missed_test",    label: "Missed Test Case",  color: T.gold,    icon: "⚠️" },
  { key: "false_positive", label: "False Positive",   color: T.accent,  icon: "🔵" },
];

const SEVERITY = [
  { key: "low",      label: "Low",      color: T.teal  },
  { key: "medium",   label: "Medium",   color: T.gold  },
  { key: "high",     label: "High",     color: T.coral },
  { key: "critical", label: "Critical", color: "#FF3B30" },
];

const DOC_CATEGORIES = ["Identity", "Finance", "Legal", "Medical", "Work", "Property", "Travel", "Education", "Other"];

const isConfigured = () => SUPABASE_URL && SUPABASE_ANON_KEY;

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfigBanner() {
  if (isConfigured()) return null;
  return (
    <div className="config-banner">
      ⚠️ <strong>Setup required:</strong> Open echo-app.jsx and replace <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> with your project credentials. Also run the SQL in the comments and create a public storage bucket named <code>echo-documents</code>.
    </div>
  );
}

// ─── PDF Export ──────────────────────────────────────────────────────────────
function exportEntryPDF(entry) {
  const mood = MOODS.find(m => m.key === entry.mood);
  const esc  = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const section = (title, body) => body ? `
    <div class="section-title">${title}</div>
    <div class="body">${body}</div>` : "";

  const teamRows = (entry.team_updates || []).map(u =>
    `<div class="side-row blue"><strong>👤 ${esc(u.name)}</strong>
     <span class="badge">${TEAM_STATUSES.find(s => s.key === u.status)?.label || u.status}</span>
     <div class="note">${esc(u.update)}</div></div>`).join("");

  const fbRows = (entry.feedback_given || []).map(f =>
    `<div class="side-row teal"><strong>→ ${esc(f.to)}</strong>
     <span class="badge">${FEEDBACK_TYPES.find(t => t.key === f.type)?.label || f.type}</span>
     <div class="note">${esc(f.note)}</div></div>`).join("");

  const cfItems = (entry.carry_forward || []).map(i =>
    `<li class="${i.done ? 'done' : ''}">${i.done ? "✅" : "⬜"} ${esc(i.text)} <span class="pri">[${i.priority || "med"}]</span></li>`).join("");

  const remItems = (entry.reminders || []).map(i =>
    `<li class="${i.checked ? 'done' : ''}">${i.checked ? "✅" : "🔔"} ${esc(i.text)}</li>`).join("");

  const jiraChips = (entry.jira_links || []).map(l =>
    `<span class="chip">${esc(l)}</span>`).join(" ");

  const cats = entry.categories || {};
  const hasCats = Object.values(cats).some(a => Array.isArray(a) && a.length > 0);
  const CAT_PDF = [
    { key: "meeting",    label: "Meetings",   color: "#5b4bdb", bg: "#f3f1ff" },
    { key: "execution",  label: "Execution",  color: "#0e8a6e", bg: "#f0fdf8" },
    { key: "validation", label: "Validation", color: "#2e7d32", bg: "#f1fdf1" },
    { key: "other",      label: "Other",      color: "#666",    bg: "#f7f7f7" },
  ];
  const catSection = hasCats ? CAT_PDF
    .filter(c => (cats[c.key] || []).length > 0)
    .map(c => `
      <div style="margin-bottom:14px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:${c.color};margin-bottom:6px;padding:4px 10px;background:${c.bg};border-left:3px solid ${c.color};border-radius:0 4px 4px 0;">${c.label}</div>
        <ul style="margin:0;padding-left:20px;">
          ${(cats[c.key] || []).map(item => `<li style="font-size:13px;line-height:1.7;color:#333;margin-bottom:3px;">${esc(item)}</li>`).join("")}
        </ul>
      </div>`).join("")
    : "";

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<title>Echo Diary — ${fmtDate(entry.date)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  body { font-family:'DM Sans',sans-serif; max-width:720px; margin:40px auto; padding:0 32px; color:#1a1a2e; font-size:14px; }
  h1 { font-size:24px; margin:0 0 6px; color:#0d1526; }
  .meta { font-size:13px; color:#666; margin-bottom:28px; display:flex; gap:14px; flex-wrap:wrap; }
  .section-title { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:1.5px; color:#999; margin:22px 0 8px; padding-bottom:5px; border-bottom:1px solid #eee; }
  .body { font-size:14px; line-height:1.8; color:#333; white-space:pre-wrap; }
  .blocker { background:#fff3f0; border-left:3px solid #f07562; padding:10px 14px; border-radius:4px; }
  .chip { display:inline-block; background:#f0f4ff; border:1px solid #c8d8ff; border-radius:4px; padding:2px 9px; font-size:12px; margin:2px; font-family:'DM Mono',monospace; }
  .side-row { padding:9px 12px; margin:6px 0; border-radius:5px; }
  .side-row.blue { border-left:3px solid #4f8ef7; background:#f6f9ff; }
  .side-row.teal { border-left:3px solid #3fcfb4; background:#f4fdfb; }
  .badge { display:inline-block; font-size:11px; background:#eee; border-radius:4px; padding:1px 7px; margin-left:8px; }
  .note { font-size:13px; color:#555; margin-top:4px; }
  .checklist { list-style:none; padding:0; margin:0; }
  .checklist li { padding:5px 0; border-bottom:1px solid #f5f5f5; font-size:13px; }
  .done { text-decoration:line-through; color:#aaa; }
  .pri { font-size:11px; color:#999; }
  .tag { background:#e8f4ff; color:#4f8ef7; border-radius:4px; padding:1px 8px; font-size:11px; margin:2px; display:inline-block; }
  .footer { margin-top:40px; font-size:11px; color:#ccc; border-top:1px solid #eee; padding-top:10px; }
  @media print { body { margin:10px auto; } }
</style>
</head><body>
<h1>${fmtDate(entry.date)}</h1>
<div class="meta">
  ${mood ? `<span>${mood.emoji} ${mood.label}</span>` : ""}
  ${getFocusAreas(entry).length ? getFocusAreas(entry).map(f => `<span>📌 ${esc(f)}</span>`).join(" ") : ""}
  ${(entry.collaborators||[]).length ? `<span>👥 ${entry.collaborators.map(c => esc(cleanCollab(c))).join(", ")}</span>` : ""}
</div>
${jiraChips ? `<div class="section-title">JIRAs</div><div>${jiraChips}</div>` : ""}
${hasCats
  ? `<div class="section-title">Work Summary</div>${catSection}`
  : section("What I Did", entry.content ? esc(entry.content) : "")}
${entry.blockers ? `<div class="section-title">Blockers</div><div class="blocker">${esc(entry.blockers)}</div>` : ""}
${teamRows  ? `<div class="section-title">Team Progress</div>${teamRows}` : ""}
${fbRows    ? `<div class="section-title">Feedback Given</div>${fbRows}` : ""}
${cfItems   ? `<div class="section-title">Carry Forward</div><ul class="checklist">${cfItems}</ul>` : ""}
${remItems  ? `<div class="section-title">Reminders</div><ul class="checklist">${remItems}</ul>` : ""}
${(entry.tags||[]).length ? `<div class="section-title">Tags</div><div>${entry.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join(" ")}</div>` : ""}
<div class="footer">Exported from Echo Personal Workspace · ${fmtDate(entry.date)}</div>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups to export PDF."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ setView, diaryCount, docCount, user }) {
  const [recentEntries, setRecentEntries] = useState([]);
  const [heatEntries, setHeatEntries]     = useState([]);
  const [recentDocs, setRecentDocs]       = useState([]);
  const [onThisDay, setOnThisDay]         = useState({ week: null, month: null });
  const [openCommitCount, setOpenCommitCount] = useState(null);
  const [weeklyModal, setWeeklyModal]     = useState(false);

  useEffect(() => {
    if (!isConfigured()) return;
    db.from("diary_entries").select("*", { order: "date.desc" }).then(d => {
      setRecentEntries((d || []).slice(0, 3));
      setHeatEntries(d || []);
    });
    db.from("documents").select("*", { order: "created_at.desc" }).then(d => setRecentDocs((d || []).slice(0, 4)));
    db.from("commitments").select("id,resolved_at", { order: "inserted_at.asc" }).then(rows => {
      if (Array.isArray(rows)) setOpenCommitCount(rows.filter(r => !r.resolved_at).length);
    });

    const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    const wStr = weekAgo.toISOString().split("T")[0];
    const mStr = monthAgo.toISOString().split("T")[0];
    db.from("diary_entries").select("*", { eq: ["date", wStr] }).then(d => {
      if (d?.[0]) setOnThisDay(prev => ({ ...prev, week: d[0] }));
    });
    db.from("diary_entries").select("*", { eq: ["date", mStr] }).then(d => {
      if (d?.[0]) setOnThisDay(prev => ({ ...prev, month: d[0] }));
    });
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, color: T.text1 }}>{greeting}</div>
          <div style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
        </div>
        <button onClick={() => setWeeklyModal(true)} style={{
          display: "flex", alignItems: "center", gap: 8,
          background: `${T.accent}18`, border: `1px solid ${T.accent}40`,
          borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 500,
          color: T.accent, cursor: "pointer",
        }}>📋 Weekly Update</button>
      </div>

      <div className="grid-4 mb-16">
        {[
          { label: "Diary Entries", value: diaryCount, color: T.accent, icon: "📓", view: "diary" },
          { label: "Wins (Month)", value: heatEntries.filter(e => e.is_win && e.date?.startsWith(new Date().toISOString().slice(0,7))).length, color: T.gold, icon: "🏆", view: "brag" },
          { label: "This Month", value: heatEntries.filter(e => e.date?.startsWith(new Date().toISOString().slice(0,7))).length, color: T.teal, icon: "📅", view: "diary" },
          { label: "Open Commitments", value: openCommitCount !== null ? openCommitCount : "—", color: openCommitCount > 0 ? T.coral : T.text3, icon: "🤝", view: "commitments" },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ cursor: "pointer" }} onClick={() => setView(s.view)}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      {weeklyModal && <WeeklyUpdateModal user={user} onClose={() => setWeeklyModal(false)} />}

      {/* ── Working-Day Mood Heatmap ── */}
      {(() => {
        const moodColor = { productive: T.green, resolved: T.teal, collaborative: T.accent, challenged: T.gold, frustrated: T.coral };

        // Build last 14 relevant days: weekdays always, weekends only if entry exists
        const days = [];
        let offset = 0;
        while (days.length < 14 && offset < 60) {
          const d = new Date(); d.setDate(d.getDate() - offset);
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const dateStr = d.toISOString().split("T")[0];
          const entry = heatEntries.find(e => e.date === dateStr);
          if (!isWeekend || entry) {
            days.unshift({ dateStr, day: d.getDate(), wd: d.toLocaleDateString("en-GB", { weekday: "short" }), entry, isToday: offset === 0, isWeekend });
          }
          offset++;
        }

        // Streak counts consecutive working days with entries (weekends skipped)
        const streak = (() => {
          let s = 0, o = 0;
          while (o < 60) {
            const d = new Date(); d.setDate(d.getDate() - o);
            const dow = d.getDay();
            if (dow === 0 || dow === 6) { o++; continue; }
            if (!heatEntries.some(e => e.date === d.toISOString().split("T")[0])) break;
            s++; o++;
          }
          return s;
        })();
        return (
          <div className="card mb-16" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>Working Day Activity</div>
              {streak > 0 && <div style={{ fontSize: 12, color: T.gold }}>🔥 {streak}-day streak</div>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              {days.map(({ dateStr, day, wd, entry, isToday }) => {
                const mood   = entry ? MOODS.find(m => m.key === entry.mood) : null;
                const color  = mood ? moodColor[mood.key] || T.accent : null;
                const hasCF  = (entry?.carry_forward?.filter(i => !i.done).length || 0) > 0;
                return (
                  <div key={dateStr} title={`${wd} ${day}${entry ? ` — ${mood?.label || "No mood"} · ${getFocusAreas(entry).join(", ")}` : " — no entry"}`}
                    style={{ flex: 1, textAlign: "center", cursor: entry ? "pointer" : "default" }}>
                    <div style={{ fontSize: 9, color: isToday ? T.accent : T.text3, marginBottom: 4, fontWeight: isToday ? 600 : 400 }}>{wd}</div>
                    <div style={{
                      height: 32, borderRadius: 5, transition: "opacity 0.15s",
                      background: color ? `${color}30` : `rgba(255,255,255,0.03)`,
                      border: `1px solid ${color ? `${color}50` : T.border}`,
                      outline: isToday ? `2px solid ${T.accent}` : "none",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                    }}>
                      {mood ? mood.emoji : ""}
                    </div>
                    <div style={{ fontSize: 9, color: T.text3, marginTop: 3 }}>{day}</div>
                    {hasCF && <div style={{ fontSize: 8, color: T.gold, marginTop: 1 }}>•</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
              {MOODS.map(m => (
                <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: T.text3 }}>
                  <span>{m.emoji}</span><span>{m.label}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: T.text3, marginLeft: "auto" }}>• pending carry-forward</div>
            </div>
          </div>
        );
      })()}

      <div className="grid-2">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>Recent Diary</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setView("diary")}>View all →</button>
          </div>
          {recentEntries.length === 0
            ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "20px 0" }}>No diary entries yet. Start logging your day.</div>
            : recentEntries.map(e => (
              <div key={e.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
                <div className="date-badge">
                  <div className="date-badge-day">{e.date?.split("-")[2]}</div>
                  <div className="date-badge-mon">{MONTHS[parseInt(e.date?.split("-")[1]) - 1]}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                    {getFocusAreas(e).map(f => <span key={f} className="focus-badge" style={{ fontSize: 10, padding: "2px 7px" }}>{f}</span>)}
                    {e.mood && <span style={{ fontSize: 13 }}>{MOODS.find(m => m.key === e.mood)?.emoji}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.content ? e.content.slice(0, 50) + (e.content.length > 50 ? "…" : "") : "Daily log"}
                  </div>
                </div>
              </div>
            ))}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>Recent Documents</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setView("locker")}>View all →</button>
          </div>
          {recentDocs.length === 0
            ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "20px 0" }}>No documents stored yet. Upload to your DigiLocker.</div>
            : recentDocs.map(d => {
              const fi = fileTypeInfo(d.name, d.file_type);
              return (
                <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                  <div className={`doc-icon ${fi.cls}`} style={{ width: 32, height: 32, borderRadius: 7, fontSize: 14, margin: 0 }}>{fi.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: T.text3 }}>{d.category || "—"} · {fmtSize(d.file_size)}</div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* ── On This Day ── */}
      {(onThisDay.week || onThisDay.month) && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 14 }}>🕰 On This Day</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {[
              { label: "1 week ago", entry: onThisDay.week },
              { label: "1 month ago", entry: onThisDay.month },
            ].filter(r => r.entry).map(({ label, entry }) => {
              const mood = MOODS.find(m => m.key === entry.mood);
              return (
                <div key={label} style={{ flex: 1, minWidth: 220, background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px" }}>
                  <div style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>{label} · {fmtDate(entry.date)}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    {getFocusAreas(entry).map(f => <span key={f} className="focus-badge" style={{ fontSize: 10 }}>{f}</span>)}
                    {mood && <span style={{ fontSize: 13 }}>{mood.emoji} <span style={{ fontSize: 12, color: T.text3 }}>{mood.label}</span></span>}
                  </div>
                  {entry.content && (
                    <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.6 }}>
                      {entry.content.slice(0, 120)}{entry.content.length > 120 ? "…" : ""}
                    </div>
                  )}
                  {entry.blockers && (
                    <div style={{ fontSize: 11, color: T.coral, marginTop: 5 }}>⚠ {entry.blockers.slice(0, 70)}{entry.blockers.length > 70 ? "…" : ""}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Mood Trend Chart (30 days) ── */}
      {(() => {
        const moodScore = { productive: 5, resolved: 4, collaborative: 3, challenged: 2, frustrated: 1 };
        const moodColorMap = { productive: T.green, resolved: T.teal, collaborative: T.accent, challenged: T.gold, frustrated: T.coral };
        const days30 = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const ds = d.toISOString().split("T")[0];
          const entry = heatEntries.find(e => e.date === ds);
          days30.push({ ds, score: entry?.mood ? (moodScore[entry.mood] || null) : null, mood: entry?.mood || null });
        }
        const withScores = days30.filter(d => d.score !== null);
        if (withScores.length < 3) return null;

        const W = 560, H = 80, PAD = 8;
        const xOf = (i) => PAD + (i / 29) * (W - PAD * 2);
        const yOf = (s) => (H - PAD) - ((s - 1) / 4) * (H - PAD * 2);

        const linePoints = days30.filter(d => d.score).map(d => `${xOf(days30.indexOf(d)).toFixed(1)},${yOf(d.score).toFixed(1)}`).join(" ");

        const areaD = (() => {
          const pts = [];
          let firstX = null, lastX = null;
          days30.forEach((d, i) => {
            if (!d.score) return;
            const x = xOf(i).toFixed(1), y = yOf(d.score).toFixed(1);
            if (firstX === null) firstX = x;
            lastX = x;
            pts.push(pts.length === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
          });
          if (pts.length < 2) return "";
          return pts.join(" ") + ` L ${lastX} ${H - PAD} L ${firstX} ${H - PAD} Z`;
        })();

        const avgScore = (withScores.reduce((s, d) => s + d.score, 0) / withScores.length).toFixed(1);
        const avgMood = MOODS.slice().sort((a, b) => Math.abs(moodScore[a.key] - avgScore) - Math.abs(moodScore[b.key] - avgScore))[0];

        return (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>📈 Mood Trend — Last 30 Days</div>
              <div style={{ fontSize: 12, color: T.text3 }}>
                avg: <span style={{ color: avgMood ? moodColorMap[avgMood.key] : T.text2 }}>{avgMood?.emoji} {avgMood?.label}</span>
                <span style={{ marginLeft: 10 }}>{withScores.length} / 30 days logged</span>
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80, display: "block" }}>
              <defs>
                <linearGradient id="moodAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.accent} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={T.accent} stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[1,2,3,4,5].map(s => (
                <line key={s} x1={PAD} y1={yOf(s)} x2={W - PAD} y2={yOf(s)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              ))}
              {areaD && <path d={areaD} fill="url(#moodAreaGrad)" />}
              {linePoints && <polyline points={linePoints} fill="none" stroke={T.accent} strokeWidth="1.5" strokeOpacity="0.6" />}
              {days30.map((d, i) => d.score ? (
                <circle key={d.ds} cx={xOf(i)} cy={yOf(d.score)} r="3.5"
                  fill={moodColorMap[d.mood]} stroke={T.navy1} strokeWidth="1.5">
                  <title>{d.ds}: {MOODS.find(m => m.key === d.mood)?.label}</title>
                </circle>
              ) : null)}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text3, marginTop: 4 }}>
              <span>{days30[0].ds}</span>
              <div style={{ display: "flex", gap: 12 }}>
                {MOODS.map(m => (
                  <span key={m.key} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: moodColorMap[m.key], display: "inline-block" }} />
                    {m.label}
                  </span>
                ))}
              </div>
              <span>{days30[29].ds}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Focus Area Analytics ── */}
      {(() => {
        const counts = {};
        heatEntries.forEach(e => { getFocusAreas(e).forEach(f => { counts[f] = (counts[f] || 0) + 1; }); });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (sorted.length < 2) return null;
        const max = sorted[0][1];
        const palette = [T.accent, T.teal, T.gold, T.coral, T.green, "#a78bfa", "#fb923c", "#38bdf8"];
        const total = sorted.reduce((s, [, c]) => s + c, 0);
        return (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>🎯 Focus Area Breakdown</div>
              <div style={{ fontSize: 11, color: T.text3 }}>{total} entries · {sorted.length} areas</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {sorted.map(([area, count], idx) => {
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={area} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 108, fontSize: 12, color: T.text2, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={area}>{area}</div>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 4, height: 20, overflow: "hidden", position: "relative" }}>
                      <div style={{
                        height: "100%", borderRadius: 4,
                        width: `${(count / max) * 100}%`,
                        background: `linear-gradient(90deg, ${palette[idx % palette.length]}70, ${palette[idx % palette.length]}bb)`,
                      }} />
                    </div>
                    <div style={{ fontSize: 11, color: palette[idx % palette.length], fontWeight: 600, fontFamily: "'DM Mono', monospace", width: 44, textAlign: "right", flexShrink: 0 }}>
                      {count} <span style={{ color: T.text3, fontWeight: 400 }}>({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Am I in a Rut? Detector ── */}
      {(() => {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 21);
        const recent = heatEntries.filter(e => new Date(e.date + "T00:00:00") >= cutoff);
        if (recent.length < 6) return null;

        const alerts = [];

        // Focus area rut: one area dominates > 80%
        const focusCounts = {};
        recent.forEach(e => { getFocusAreas(e).forEach(f => { focusCounts[f] = (focusCounts[f] || 0) + 1; }); });
        const topFocus = Object.entries(focusCounts).sort((a,b) => b[1]-a[1])[0];
        if (topFocus && (topFocus[1] / recent.length) >= 0.80) {
          alerts.push({ icon: "🔄", label: "Focus Loop", col: T.gold, msg: `"${topFocus[0]}" has been ${Math.round((topFocus[1]/recent.length)*100)}% of your work for 3 weeks.`, sub: "Is this intentional depth — or are you stuck in one lane?" });
        }

        // Mood rut: same mood > 70%
        const moodCounts = {};
        recent.forEach(e => { if (e.mood) moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1; });
        const topMood = Object.entries(moodCounts).sort((a,b) => b[1]-a[1])[0];
        if (topMood && (topMood[1] / recent.length) >= 0.70) {
          const isNeg = ["frustrated", "challenged"].includes(topMood[0]);
          alerts.push({ icon: isNeg ? "😤" : "😐", label: "Mood Pattern", col: isNeg ? T.coral : T.text3, msg: `"${topMood[0]}" is your dominant mood for ${topMood[1]} of the last ${recent.length} days.`, sub: isNeg ? "This pattern is worth examining — something may need to change." : "Your emotional range has been narrow lately." });
        }

        // Stalled carry-forward: same text in 4+ entries
        const cfCounts = {};
        recent.forEach(e => (e.carry_forward || []).forEach(cf => { if (!cf.done && cf.text) cfCounts[cf.text] = (cfCounts[cf.text] || 0) + 1; }));
        const stalledCF = Object.entries(cfCounts).filter(([,c]) => c >= 4).sort((a,b) => b[1]-a[1]);
        if (stalledCF.length > 0) {
          alerts.push({ icon: "⚠️", label: "Stalled Task", col: T.coral, msg: `"${stalledCF[0][0].slice(0, 60)}${stalledCF[0][0].length > 60 ? "…" : ""}" has been in carry-forward for ${stalledCF[0][1]}+ days.`, sub: "This may need escalation, redefinition, or removal." });
        }

        // Persistent blocker: same blocker text appearing in 3+ entries
        const blockerMap = {};
        recent.forEach(e => {
          if (e.blockers?.trim()) {
            const key = e.blockers.trim().toLowerCase().slice(0, 55);
            if (!blockerMap[key]) blockerMap[key] = { text: e.blockers.trim(), count: 0 };
            blockerMap[key].count++;
          }
        });
        const persistentBlockers = Object.values(blockerMap).filter(b => b.count >= 3).sort((a,b) => b.count - a.count);
        if (persistentBlockers.length > 0) {
          const pb = persistentBlockers[0];
          alerts.push({ icon: "🚧", label: "Persistent Blocker", col: T.coral, msg: `"${pb.text.slice(0, 65)}${pb.text.length > 65 ? "…" : ""}" has appeared as a blocker ${pb.count} times in 3 weeks.`, sub: "This needs active resolution — escalate, create a task, or remove it." });
        }

        if (alerts.length === 0) return null;

        return (
          <div className="card rut-alert" style={{ marginTop: 20, border: `1px solid ${T.gold}35`, background: `linear-gradient(135deg, ${T.navy2}, rgba(232,198,106,0.04))` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.gold }}>🔍 Pattern Detected — 21-Day Loop Check</div>
              <div style={{ fontSize: 11, color: T.text3 }}>last {recent.length} entries</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {alerts.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", paddingBottom: i < alerts.length-1 ? 12 : 0, borderBottom: i < alerts.length-1 ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{a.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: a.col, textTransform: "uppercase" }}>{a.label}</span>
                    </div>
                    <div style={{ fontSize: 13, color: T.text1, marginBottom: 3, lineHeight: 1.5 }}>{a.msg}</div>
                    <div style={{ fontSize: 12, color: T.text3, fontStyle: "italic" }}>{a.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Diary ───────────────────────────────────────────────────────────────────
function SectionInput({ children }) {
  return (
    <div style={{ background: "rgba(79,142,247,0.04)", border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
      {children}
    </div>
  );
}

// ─── Scratch Pad ─────────────────────────────────────────────────────────────
function ScratchPad({ onClose, user }) {
  const [notes, setNotes] = useState([{ id: 1, title: "Note 1", text: "", group: "" }]);
  const [loaded, setLoaded] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeGroup, setActiveGroup] = useState("All");
  const [newGroupInput, setNewGroupInput] = useState("");
  const [showGroupInput, setShowGroupInput] = useState(false);

  useEffect(() => {
    if (!user?.id || loaded) return;
    db.from("scratch_pad").select("content", { eq: ["user_id", user.id] }).then(rows => {
      const raw = rows?.[0]?.content;
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (p?.length) {
            // Migrate old notes that lack a group field
            setNotes(p.map(n => ({ group: "", ...n })));
          }
        } catch {}
      }
      setLoaded(true);
    });
  }, [user, loaded]);

  const persist = (updated) => {
    setNotes(updated);
    _notesCache = updated;
    if (user?.id) {
      db.from("scratch_pad").upsert({ user_id: user.id, content: JSON.stringify(updated), updated_at: new Date().toISOString() }, "user_id");
    }
  };

  // Derived groups from all notes
  const allGroups = ["All", ...new Set(notes.map(n => n.group || "").filter(Boolean))];

  // Notes visible in the current group tab
  const visibleNotes = activeGroup === "All" ? notes : notes.filter(n => (n.group || "") === activeGroup);

  // Map visible index → real index in notes[]
  const realIdx = visibleNotes[activeIdx] ? notes.indexOf(visibleNotes[activeIdx]) : 0;
  const active  = notes[realIdx] || notes[0];

  const addNote = () => {
    const n = { id: Date.now(), title: `Note ${notes.length + 1}`, text: "", group: activeGroup === "All" ? "" : activeGroup };
    const updated = [...notes, n];
    persist(updated);
    setActiveIdx(visibleNotes.length); // will point to the new note in current group view
  };

  const deleteNote = (visIdx, e) => {
    e.stopPropagation();
    const rIdx = notes.indexOf(visibleNotes[visIdx]);
    if (notes.length === 1) {
      persist([{ id: Date.now(), title: "Note 1", text: "", group: "" }]);
      setActiveIdx(0);
      return;
    }
    const updated = notes.filter((_, i) => i !== rIdx);
    persist(updated);
    setActiveIdx(Math.max(0, Math.min(activeIdx, (activeGroup === "All" ? updated : updated.filter(n => (n.group || "") === activeGroup)).length - 1)));
  };

  const updateActive = (key, val) => {
    const updated = notes.map((n, i) => i === realIdx ? { ...n, [key]: val } : n);
    persist(updated);
  };

  const addGroup = () => {
    const g = newGroupInput.trim();
    if (!g || allGroups.includes(g)) { setShowGroupInput(false); setNewGroupInput(""); return; }
    // Create an empty note in this group so the group persists
    const n = { id: Date.now(), title: `${g} — Note 1`, text: "", group: g };
    const updated = [...notes, n];
    persist(updated);
    setActiveGroup(g);
    setActiveIdx(0);
    setShowGroupInput(false);
    setNewGroupInput("");
  };

  return (
    <div style={{
      position: "fixed", bottom: 84, right: 24, width: 390, height: 480,
      background: T.navy1, border: `1px solid ${T.borderHover}`,
      borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      display: "flex", flexDirection: "column", zIndex: 9998, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: T.navy2, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>📝 Scratch Pad</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>

      {/* Group filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 10px", borderBottom: `1px solid ${T.border}`, background: T.navy2, flexShrink: 0, overflowX: "auto" }}>
        {allGroups.map(g => (
          <button key={g} onClick={() => { setActiveGroup(g); setActiveIdx(0); }} style={{
            background: activeGroup === g ? T.accentGlow : "transparent",
            border: `1px solid ${activeGroup === g ? T.accent : T.border}`,
            borderRadius: 20, padding: "2px 10px", cursor: "pointer",
            fontSize: 11, color: activeGroup === g ? T.accent : T.text3,
            fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", flexShrink: 0,
          }}>{g}</button>
        ))}
        {showGroupInput ? (
          <input
            autoFocus
            value={newGroupInput}
            onChange={e => setNewGroupInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addGroup(); if (e.key === "Escape") { setShowGroupInput(false); setNewGroupInput(""); } }}
            onBlur={addGroup}
            placeholder="Group name…"
            style={{ background: T.navy3, border: `1px solid ${T.accent}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, color: T.text1, outline: "none", fontFamily: "'DM Sans', sans-serif", width: 100 }}
          />
        ) : (
          <button onClick={() => setShowGroupInput(true)} title="New group" style={{ background: "none", border: `1px dashed ${T.border}`, borderRadius: 20, padding: "2px 8px", cursor: "pointer", fontSize: 11, color: T.text3, fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>＋ Group</button>
        )}
      </div>

      {/* Note tabs */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}`, overflowX: "auto", background: T.navy2, flexShrink: 0 }}>
        {visibleNotes.map((n, idx) => (
          <div key={n.id} onClick={() => setActiveIdx(idx)} style={{
            display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
            cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
            borderBottom: `2px solid ${activeIdx === idx ? T.accent : "transparent"}`,
            color: activeIdx === idx ? T.text1 : T.text3, fontSize: 12,
          }}>
            <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>
              {n.title || `Note ${idx + 1}`}
            </span>
            <span onClick={(e) => deleteNote(idx, e)} style={{ fontSize: 11, color: T.text3, marginLeft: 1, opacity: 0.7 }}>×</span>
          </div>
        ))}
        <button onClick={addNote} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", padding: "6px 10px", fontSize: 18, flexShrink: 0, lineHeight: 1 }} title="New note">+</button>
      </div>

      {/* Note title + group */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <input
          type="text"
          value={active?.title || ""}
          onChange={e => updateActive("title", e.target.value)}
          placeholder="Note title…"
          style={{
            flex: 1, background: "transparent", border: "none",
            color: T.text1, fontSize: 13, fontWeight: 600, padding: "8px 14px",
            outline: "none", fontFamily: "'DM Sans', sans-serif",
          }}
        />
        <input
          type="text"
          value={active?.group || ""}
          onChange={e => updateActive("group", e.target.value)}
          onBlur={e => { const g = e.target.value.trim(); if (g && !allGroups.includes(g)) setActiveGroup("All"); }}
          placeholder="Group…"
          title="Assign to a group"
          style={{
            width: 90, background: "transparent", border: "none", borderLeft: `1px solid ${T.border}`,
            color: T.accent, fontSize: 11, padding: "8px 10px",
            outline: "none", fontFamily: "'DM Sans', sans-serif",
          }}
        />
      </div>

      {/* Note body */}
      <textarea
        value={active?.text || ""}
        onChange={e => updateActive("text", e.target.value)}
        placeholder="Jot something down…"
        style={{
          flex: 1, background: "transparent", border: "none",
          color: T.text2, fontSize: 13, padding: "10px 14px",
          outline: "none", resize: "none", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.75,
        }}
      />

      {/* Footer */}
      <div style={{ padding: "5px 14px", borderTop: `1px solid ${T.border}`, fontSize: 11, color: T.text3, display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span>{active?.text?.length || 0} chars</span>
        <span>{visibleNotes.length}/{notes.length} notes · auto-saved</span>
      </div>
    </div>
  );
}

// ─── Teammates helpers ───────────────────────────────────────────────────────
let _tmCache = [];
async function refreshTeammates() {
  const rows = await db.from("teammates").select("*");
  _tmCache = rows || [];
  return _tmCache;
}
function loadTeammates() { return _tmCache; }

// ─── Scratch notes cache (so Diary can pick notes to link) ───────────────────
let _notesCache = [];
async function refreshScratchNotes(userId) {
  if (!userId) return [];
  const rows = await db.from("scratch_pad").select("content", { eq: ["user_id", userId] });
  const raw = rows?.[0]?.content;
  if (raw) { try { const p = JSON.parse(raw); _notesCache = Array.isArray(p) ? p : []; } catch {} }
  return _notesCache;
}
function loadScratchNotes() { return _notesCache; }
function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ─── MyTeam page (full-page view accessible from nav) ────────────────────────
function MyTeam({ user }) {
  const [teammates, setTeammates] = useState([]);
  const [form, setForm] = useState({ name: "", role: "", emoji: "", relationship: "direct" });
  const [editId, setEditId] = useState(null);
  const [oneOnOne, setOneOnOne] = useState(null);
  const [lastSeen, setLastSeen] = useState({});
  const [relSupported, setRelSupported] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    probeTeammateRelationship().then(ok => setRelSupported(ok));
    refreshTeammates().then(rows => setTeammates(rows));
    db.from("diary_entries").select("date,collaborators", { order: "date.desc" }).then(rows => {
      const seen = {};
      (rows || []).forEach(e => {
        (e.collaborators || []).forEach(name => {
          const n = name.trim();
          if (n && !seen[n]) seen[n] = e.date;
        });
      });
      setLastSeen(seen);
    });
  }, [user]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addOrUpdate = async () => {
    if (!form.name.trim()) return;
    const hasTmRel = await probeTeammateRelationship();
    const payload = { name: form.name.trim(), role: form.role, emoji: form.emoji };
    if (hasTmRel) payload.relationship = form.relationship || "direct";
    if (editId !== null) {
      await db.from("teammates").update(payload, editId);
    } else {
      await db.from("teammates").insert({ user_id: user.id, ...payload });
    }
    setEditId(null);
    setForm({ name: "", role: "", emoji: "", relationship: "direct" });
    const updated = await refreshTeammates();
    setTeammates(updated);
  };

  const startEdit = (t) => {
    setForm({ name: t.name, role: t.role || "", emoji: t.emoji || "", relationship: t.relationship || "direct" });
    setEditId(t.id);
  };

  const remove = async (t) => {
    await db.from("teammates").delete(t.id);
    if (editId === t.id) { setEditId(null); setForm({ name: "", role: "", emoji: "", relationship: "direct" }); }
    const updated = await refreshTeammates();
    setTeammates(updated);
  };

  const cancel = () => { setForm({ name: "", role: "", emoji: "", relationship: "direct" }); setEditId(null); };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {/* Add / edit form */}
      <div style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text2, marginBottom: 14, letterSpacing: 0.5 }}>
          {editId !== null ? "✏️  Edit Teammate" : "➕  Add Teammate"}
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          <input
            type="text" className="form-input" placeholder="Full name *"
            value={form.name} onChange={e => setF("name", e.target.value)}
            onKeyDown={e => e.key === "Enter" && addOrUpdate()}
            style={{ flex: 3 }}
          />
          <select
            className="form-input"
            value={form.relationship} onChange={e => setF("relationship", e.target.value)}
            style={{ flex: 1.5, color: T.text1 }}
          >
            {RELATIONSHIP_TYPES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            type="text" className="form-input" list="team-roles-list"
            placeholder="Role / title (optional)"
            value={form.role} onChange={e => setF("role", e.target.value)}
            style={{ flex: 2 }}
          />
          <datalist id="team-roles-list">
            {TEAM_ROLES.map(r => <option key={r.key} value={r.label} />)}
          </datalist>
          <input
            type="text" className="form-input" placeholder="😊"
            value={form.emoji} onChange={e => setF("emoji", e.target.value)}
            style={{ width: 56, textAlign: "center" }}
            maxLength={2}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={addOrUpdate}>
            {editId !== null ? "Update" : "+ Add"}
          </button>
          {editId !== null && <button className="btn btn-ghost btn-sm" onClick={cancel}>Cancel</button>}
        </div>
      </div>

      {/* Migration banner */}
      {!relSupported && (
        <div style={{ background: `${T.amber}15`, border: `1px solid ${T.amber}40`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: T.amber }}>
          <strong>One-time setup needed:</strong> Run this in your Supabase SQL editor to enable relationship types and fix the 1:1 button:
          <div style={{ marginTop: 8, background: T.navy0, borderRadius: 6, padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: T.text2, userSelect: "all" }}>
            ALTER TABLE teammates ADD COLUMN IF NOT EXISTS relationship text DEFAULT 'direct';
          </div>
          After running it, reload the page and edit each person to set their relationship type.
        </div>
      )}

      {/* Teammates grid */}
      {teammates.length === 0
        ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.text3 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
            <div style={{ fontSize: 15, marginBottom: 6 }}>No people saved yet</div>
            <div style={{ fontSize: 13 }}>Add your team, peers, and managers — they'll appear as quick-pick chips when logging collaborators in your diary.</div>
          </div>
        )
        : (
          <div>
            {RELATIONSHIP_TYPES.filter(rt => teammates.some(t => (t.relationship || "direct") === rt.key)).map(rt => (
              <div key={rt.key} style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: rt.color }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: rt.color, letterSpacing: 0.8, textTransform: "uppercase" }}>{rt.label}</div>
                  <div style={{ fontSize: 11, color: T.text3 }}>· {teammates.filter(t => (t.relationship || "direct") === rt.key).length}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {teammates.filter(t => (t.relationship || "direct") === rt.key).map((t) => (
                    <div key={t.id} style={{
                      background: T.navy2,
                      border: `1px solid ${T.border}`,
                      borderLeft: `3px solid ${rt.color}60`,
                      borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 14,
                      transition: "border-color 0.15s",
                    }}>
                      <div style={{
                        width: 46, height: 46, borderRadius: "50%",
                        background: `linear-gradient(135deg, ${rt.color}20, ${rt.color}08)`,
                        border: `2px solid ${rt.color}40`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: t.emoji ? 22 : 15, fontWeight: 700, color: rt.color,
                        flexShrink: 0,
                      }}>
                        {t.emoji || initials(t.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t.name}</div>
                          {(() => {
                            const d = lastSeen[t.name];
                            if (!d) return <div title="No diary collaborations recorded" style={{ width: 7, height: 7, borderRadius: "50%", background: T.text3, flexShrink: 0 }} />;
                            const days = Math.floor((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000);
                            const col = days <= 7 ? T.teal : days <= 30 ? T.gold : T.coral;
                            const lbl = days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
                            return <div title={`Last collaborated: ${lbl}`} style={{ width: 7, height: 7, borderRadius: "50%", background: col, flexShrink: 0 }} />;
                          })()}
                        </div>
                        {t.role && (() => {
                          const rm = TEAM_ROLES.find(r => r.label === t.role);
                          const d = lastSeen[t.name];
                          const days = d ? Math.floor((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000) : null;
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                              <div style={{
                                display: "inline-block", fontSize: 10, fontWeight: 600,
                                color: rm?.color || T.text2,
                                background: `${rm?.color || T.accent}18`,
                                border: `1px solid ${rm?.color || T.accent}35`,
                                borderRadius: 4, padding: "1px 6px",
                              }}>{t.role}</div>
                              {days !== null && <span style={{ fontSize: 10, color: T.text3 }}>{days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`}</span>}
                            </div>
                          );
                        })()}
                        {!t.role && (() => {
                          const d = lastSeen[t.name];
                          if (!d) return null;
                          const days = Math.floor((Date.now() - new Date(d + "T00:00:00").getTime()) / 86400000);
                          return <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>{days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`}</div>;
                        })()}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => startEdit(t)}>Edit</button>
                        {rt.key === "direct" && (
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "2px 8px", color: T.accent, borderColor: `${T.accent}40` }} onClick={() => setOneOnOne(t)}>1:1</button>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "2px 8px", color: T.coral, borderColor: `${T.coral}40` }} onClick={() => remove(t)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      }
      {oneOnOne && <OneOnOneModal teammate={oneOnOne} user={user} onClose={() => setOneOnOne(null)} />}
    </div>
  );
}

const RELATIONSHIP_TYPES = [
  { key: "direct",   label: "My Team",    color: T.teal  },
  { key: "peer",     label: "Peer",       color: T.accent },
  { key: "manager",  label: "Manager",    color: T.gold  },
  { key: "external", label: "External",   color: "#9A99AD" },
];

const TEAM_ROLES = [
  { key: "manager",           label: "Manager",           color: "#F5C243", tip: "Upward — focus on alignment, blockers, and strategic goals" },
  { key: "developer",         label: "Developer",         color: "#7B6EF6", tip: "Peer — focus on delivery, code quality, and collaboration" },
  { key: "scrum_master",      label: "Scrum Master",      color: "#34D9B3", tip: "Process — focus on sprint health, impediments, and retrospectives" },
  { key: "product_owner",     label: "Product Owner",     color: "#A89BF8", tip: "Product — focus on requirements clarity, priorities, and backlog" },
  { key: "designer",          label: "Designer",          color: "#F07A6E", tip: "Creative — focus on UX outcomes, design reviews, and feedback loops" },
  { key: "qa",                label: "QA / Tester",       color: "#34D9B3", tip: "Quality — focus on test coverage, bugs, and release readiness" },
  { key: "sdet_i",            label: "SDET I",            color: "#34D9B3", tip: "Junior SDET — automation, test scripting, bug verification" },
  { key: "sdet_ii",           label: "SDET II",           color: "#34D9B3", tip: "Mid SDET — framework development, CI integration, test design" },
  { key: "sdet_iii",          label: "SDET III",          color: "#34D9B3", tip: "Senior SDET — architecture, mentoring, strategy" },
  { key: "associate_sdet",    label: "Associate SDET",    color: "#34D9B3", tip: "Entry SDET — learning automation, manual + scripting" },
  { key: "tech_lead",         label: "Tech Lead",         color: "#7B6EF6", tip: "Technical — focus on architecture decisions, code reviews, and mentoring" },
  { key: "data_analyst",      label: "Data Analyst",      color: "#F5C243", tip: "Data — focus on insights, metrics, and analytical deliverables" },
  { key: "devops",            label: "DevOps",             color: "#F07A6E", tip: "Infrastructure — focus on pipelines, reliability, and release process" },
  { key: "delivery_manager",  label: "Delivery Manager",  color: "#A89BF8", tip: "Delivery — focus on timelines, dependencies, and stakeholder reporting" },
  { key: "stakeholder",       label: "Stakeholder",       color: "#9A99AD", tip: "External — focus on status updates, risks, and expectations" },
  { key: "trainee",           label: "Trainee",           color: "#9A99AD", tip: "Entry level — learning the codebase, guided tasks" },
];

const SESSION_SENTIMENTS = [
  { key: "excellent",       label: "Excellent",       color: "#34D9B3" },
  { key: "positive",        label: "Good",            color: "#7B6EF6" },
  { key: "neutral",         label: "Neutral",         color: "#F5C243" },
  { key: "needs_attention", label: "Needs Attention", color: "#F07A6E" },
];

function OneOnOneModal({ teammate, user, onClose }) {
  const [tab, setTab] = useState("new");
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState({ collabs: [], updates: [], feedback: [] });
  const [sessions, setSessions] = useState([]);
  const [openCommitments, setOpenCommitments] = useState([]);
  const [agendaQueue, setAgendaQueue] = useState([]);
  const [agendaInput, setAgendaInput] = useState("");
  const [hasAgendaCol, setHasAgendaCol] = useState(false);
  const [form, setForm] = useState({
    session_date: today(),
    topics: "",
    notes: "",
    action_items: [],
    feedback_given: [],
    sentiment: "positive",
    next_session_date: "",
  });
  const [actionInput, setActionInput] = useState("");
  const [fbForm, setFbForm] = useState({ type: "constructive", note: "" });
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!user?.id || !teammate?.id) return;
    const agqOk = probeAgendaQueue();
    Promise.all([
      db.from("diary_entries").select("*", { order: "date.desc" }),
      db.from("one_on_one_sessions").select("*", { eq: ["teammate_id", teammate.id], order: "session_date.desc" }),
      db.from("commitments").select("*", { order: "inserted_at.asc" }),
      db.from("teammates").select("id,agenda_queue", { eq: ["id", teammate.id] }),
    ]).then(([entries, past, commits, tmRows]) => {
      const name = teammate.name;
      const rel = (entries || []).filter(e =>
        (e.collaborators || []).includes(name) ||
        (e.team_updates || []).some(u => u.name === name) ||
        (e.feedback_given || []).some(f => f.to === name)
      );
      setContext({
        collabs: rel.filter(e => (e.collaborators || []).includes(name)).slice(0, 6),
        updates: rel.flatMap(e =>
          (e.team_updates || []).filter(u => u.name === name).map(u => ({ ...u, date: e.date }))
        ).slice(0, 8),
        feedback: rel.flatMap(e =>
          (e.feedback_given || []).filter(f => f.to === name).map(f => ({ ...f, date: e.date }))
        ).slice(0, 6),
      });
      setSessions(past || []);
      // commitments involving this person (ignore DB errors if table missing)
      if (Array.isArray(commits)) {
        setOpenCommitments(commits.filter(c => !c.resolved_at && c.person?.toLowerCase() === name.toLowerCase()));
      }
      agqOk.then(ok => {
        setHasAgendaCol(ok);
        if (ok && tmRows?.[0]?.agenda_queue) setAgendaQueue(tmRows[0].agenda_queue);
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user, teammate]);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addToAgenda = async () => {
    if (!agendaInput.trim() || !hasAgendaCol) return;
    const next = [...agendaQueue, { text: agendaInput.trim(), added: new Date().toISOString() }];
    setAgendaQueue(next);
    setAgendaInput("");
    await db.from("teammates").update({ agenda_queue: next }, teammate.id);
  };

  const removeAgendaItem = async (idx) => {
    const next = agendaQueue.filter((_, i) => i !== idx);
    setAgendaQueue(next);
    if (hasAgendaCol) await db.from("teammates").update({ agenda_queue: next }, teammate.id);
  };

  const addAction = () => {
    if (!actionInput.trim()) return;
    setF("action_items", [...form.action_items, { text: actionInput.trim(), done: false }]);
    setActionInput("");
  };

  const toggleAction = (idx) => {
    setF("action_items", form.action_items.map((a, i) => i === idx ? { ...a, done: !a.done } : a));
  };

  const addFeedback = () => {
    if (!fbForm.note.trim()) return;
    setF("feedback_given", [...form.feedback_given, { ...fbForm }]);
    setFbForm({ type: "constructive", note: "" });
  };

  const save = async () => {
    if (!form.notes.trim() && !form.topics.trim() && form.action_items.length === 0) return;
    setSaving(true);
    await db.from("one_on_one_sessions").insert({
      user_id: user.id,
      teammate_id: teammate.id,
      teammate_name: teammate.name,
      session_date: form.session_date,
      topics: form.topics,
      notes: form.notes,
      action_items: form.action_items,
      feedback_given: form.feedback_given,
      sentiment: form.sentiment,
      next_session_date: form.next_session_date || null,
    });
    const updated = await db.from("one_on_one_sessions").select("*", { eq: ["teammate_id", teammate.id], order: "session_date.desc" });
    setSessions(updated || []);
    setForm({ session_date: today(), topics: "", notes: "", action_items: [], feedback_given: [], sentiment: "positive", next_session_date: "" });
    setSaving(false);
    setTab("history");
  };

  const deleteSession = async (id) => {
    await db.from("one_on_one_sessions").delete(id);
    setSessions(s => s.filter(x => x.id !== id));
    if (expanded === id) setExpanded(null);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.navy1, border: `1px solid ${T.border2}`,
        borderRadius: 16, width: "100%", maxWidth: 980, maxHeight: "90vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "16px 24px", borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: `linear-gradient(135deg, ${T.accent}30, ${T.teal}30)`,
            border: `2px solid ${T.accent}50`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: teammate.emoji ? 19 : 13, fontWeight: 700, color: T.accent, flexShrink: 0,
          }}>
            {teammate.emoji || initials(teammate.name)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text1 }}>1:1 — {teammate.name}</div>
            {teammate.role && (() => {
              const roleMeta = TEAM_ROLES.find(r => r.label === teammate.role);
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: roleMeta?.color || T.text2,
                    background: `${roleMeta?.color || T.accent}18`,
                    border: `1px solid ${roleMeta?.color || T.accent}40`,
                    borderRadius: 4, padding: "1px 7px", letterSpacing: 0.3,
                  }}>{teammate.role}</span>
                  {roleMeta?.tip && <span style={{ fontSize: 11, color: T.text3, fontStyle: "italic" }}>{roleMeta.tip}</span>}
                </div>
              );
            })()}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Left: Echo Context */}
          <div style={{
            width: 280, flexShrink: 0,
            borderRight: `1px solid ${T.border}`,
            padding: "16px 14px", overflowY: "auto",
            background: T.navy2,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1, marginBottom: 14, textTransform: "uppercase" }}>
              Pre-Meeting Brief
            </div>

            {/* ── Agenda Queue ── */}
            {(agendaQueue.length > 0 || hasAgendaCol) && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.gold, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📋 Agenda</div>
                {agendaQueue.length === 0 ? (
                  <div style={{ fontSize: 11, color: T.text3, fontStyle: "italic" }}>Nothing queued yet</div>
                ) : agendaQueue.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 5 }}>
                    <span style={{ color: T.gold, fontSize: 12, marginTop: 1, flexShrink: 0 }}>•</span>
                    <span style={{ flex: 1, fontSize: 12, color: T.text1, lineHeight: 1.4 }}>{item.text}</span>
                    <button onClick={() => removeAgendaItem(i)} style={{ background: "none", border: "none", cursor: "pointer", color: T.text3, fontSize: 11, flexShrink: 0, padding: 0 }}>✕</button>
                  </div>
                ))}
                {hasAgendaCol && (
                  <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                    <input className="form-input" style={{ fontSize: 11, padding: "4px 8px", flex: 1 }}
                      placeholder="Queue a topic…"
                      value={agendaInput}
                      onChange={e => setAgendaInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addToAgenda())} />
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, flexShrink: 0 }} onClick={addToAgenda}>+</button>
                  </div>
                )}
              </div>
            )}

            {/* ── Open Commitments ── */}
            {openCommitments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.coral, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🤝 Open Commitments</div>
                {openCommitments.map(c => {
                  const days = Math.floor((Date.now() - new Date(c.inserted_at).getTime()) / 86400000);
                  return (
                    <div key={c.id} style={{ background: T.navy3, borderRadius: 7, padding: "7px 9px", marginBottom: 5, borderLeft: `2px solid ${c.direction === "i_owe" ? T.accent : T.coral}` }}>
                      <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.4 }}>{c.what}</div>
                      <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                        {c.direction === "i_owe" ? "You owe" : "They owe"} · {days === 0 ? "today" : `${days}d ago`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Last Session ── */}
            {sessions.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.teal, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🕐 Last Session</div>
                <div style={{ background: T.navy3, borderRadius: 7, padding: "7px 9px" }}>
                  <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>{sessions[0].session_date}</div>
                  {sessions[0].notes?.trim() && <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{sessions[0].notes}</div>}
                  {sessions[0].action_items?.filter(a => !a.done).length > 0 && (
                    <div style={{ fontSize: 11, color: T.gold, marginTop: 4 }}>
                      {sessions[0].action_items.filter(a => !a.done).length} open action item{sessions[0].action_items.filter(a => !a.done).length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Diary separator ── */}
            {(context.collabs.length > 0 || context.updates.length > 0 || context.feedback.length > 0) && (
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1, marginBottom: 12, textTransform: "uppercase", borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                Diary Context
              </div>
            )}

            {loading ? (
              <div style={{ color: T.text3, fontSize: 12, textAlign: "center", paddingTop: 30 }}>Loading...</div>
            ) : context.collabs.length === 0 && context.updates.length === 0 && context.feedback.length === 0 ? (
              <div style={{ color: T.text3, fontSize: 12, lineHeight: 1.8 }}>
                No diary data for {teammate.name}.
              </div>
            ) : (
              <>
                {context.collabs.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      👥 Worked together
                    </div>
                    {context.collabs.map((e, i) => (
                      <div key={i} style={{ background: T.navy3, borderRadius: 7, padding: "7px 9px", marginBottom: 5 }}>
                        <div style={{ color: T.text3, fontSize: 10, marginBottom: 2 }}>{e.date}</div>
                        <div style={{ color: T.text2, fontSize: 12, lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {e.content || e.focus_area || "Diary entry"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {context.updates.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.teal, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      📊 Team updates
                    </div>
                    {context.updates.map((u, i) => (
                      <div key={i} style={{ background: T.navy3, borderRadius: 7, padding: "7px 9px", marginBottom: 5 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ color: T.text3, fontSize: 10 }}>{u.date}</span>
                          <span style={{ fontSize: 10, color: statusColor(u.status) }}>{u.status?.replace(/_/g, " ")}</span>
                        </div>
                        <div style={{ color: T.text2, fontSize: 12, lineHeight: 1.5 }}>{u.update}</div>
                      </div>
                    ))}
                  </div>
                )}
                {context.feedback.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.amber, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      💬 Feedback given
                    </div>
                    {context.feedback.map((f, i) => (
                      <div key={i} style={{ background: T.navy3, borderRadius: 7, padding: "7px 9px", marginBottom: 5 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ color: T.text3, fontSize: 10 }}>{f.date}</span>
                          <span style={{ fontSize: 10, color: feedbackColor(f.type) }}>{FEEDBACK_TYPES.find(t => t.key === f.type)?.label || f.type}</span>
                        </div>
                        <div style={{ color: T.text2, fontSize: 12, lineHeight: 1.5 }}>{f.note}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right: Session form / History */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, padding: "0 20px", flexShrink: 0 }}>
              {[
                { key: "new", label: "New Session" },
                { key: "history", label: `History${sessions.length > 0 ? ` (${sessions.length})` : ""}` },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} style={{
                  padding: "11px 16px", fontSize: 13, fontWeight: 600,
                  background: "none", border: "none", cursor: "pointer",
                  color: tab === t.key ? T.accent : T.text3,
                  borderBottom: tab === t.key ? `2px solid ${T.accent}` : "2px solid transparent",
                  marginBottom: -1,
                }}>{t.label}</button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              {tab === "new" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* Dates */}
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div className="diary-section-heading" style={{ marginBottom: 5 }}>Session date</div>
                      <input type="date" className="form-input" value={form.session_date}
                        onChange={e => setF("session_date", e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="diary-section-heading" style={{ marginBottom: 5 }}>Next session</div>
                      <input type="date" className="form-input" value={form.next_session_date}
                        onChange={e => setF("next_session_date", e.target.value)} />
                    </div>
                  </div>

                  {/* Topics */}
                  <div>
                    <div className="diary-section-heading" style={{ marginBottom: 5 }}>Topics discussed</div>
                    <textarea className="form-textarea" rows={2}
                      placeholder="Career growth, project blockers, priorities, personal development..."
                      value={form.topics} onChange={e => setF("topics", e.target.value)}
                      style={{ resize: "vertical" }}
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <div className="diary-section-heading" style={{ marginBottom: 5 }}>Notes</div>
                    <textarea className="form-textarea" rows={4}
                      placeholder="Key points discussed, what they shared, your observations..."
                      value={form.notes} onChange={e => setF("notes", e.target.value)}
                      style={{ resize: "vertical" }}
                    />
                  </div>

                  {/* Action items */}
                  <div>
                    <div className="diary-section-heading" style={{ marginBottom: 5 }}>Action items</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input type="text" className="form-input" placeholder="Add an action item..."
                        value={actionInput} onChange={e => setActionInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addAction()} style={{ flex: 1 }} />
                      <button className="btn btn-ghost btn-sm" onClick={addAction}>Add</button>
                    </div>
                    {form.action_items.map((a, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
                        <input type="checkbox" checked={a.done} onChange={() => toggleAction(idx)}
                          style={{ accentColor: T.teal, width: 14, height: 14, flexShrink: 0 }} />
                        <span style={{ flex: 1, color: a.done ? T.text3 : T.text1, textDecoration: a.done ? "line-through" : "none" }}>{a.text}</span>
                        <button onClick={() => setF("action_items", form.action_items.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 11 }}>✕</button>
                      </div>
                    ))}
                  </div>

                  {/* Feedback */}
                  <div>
                    <div className="diary-section-heading" style={{ marginBottom: 5 }}>Feedback given</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <select className="form-select" value={fbForm.type}
                        onChange={e => setFbForm(f => ({ ...f, type: e.target.value }))} style={{ width: 140 }}>
                        {FEEDBACK_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                      <input type="text" className="form-input" placeholder="Feedback note..."
                        value={fbForm.note} onChange={e => setFbForm(f => ({ ...f, note: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && addFeedback()} style={{ flex: 1 }} />
                      <button className="btn btn-ghost btn-sm" onClick={addFeedback}>Add</button>
                    </div>
                    {form.feedback_given.map((f, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 10px", background: T.navy3, borderRadius: 7, marginBottom: 5, fontSize: 12 }}>
                        <span style={{ color: feedbackColor(f.type), fontWeight: 600, flexShrink: 0, fontSize: 11, marginTop: 1 }}>
                          {FEEDBACK_TYPES.find(t => t.key === f.type)?.label}
                        </span>
                        <span style={{ flex: 1, color: T.text2 }}>{f.note}</span>
                        <button onClick={() => setF("feedback_given", form.feedback_given.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 11 }}>✕</button>
                      </div>
                    ))}
                  </div>

                  {/* Sentiment */}
                  <div>
                    <div className="diary-section-heading" style={{ marginBottom: 8 }}>How did it go?</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {SESSION_SENTIMENTS.map(s => (
                        <button key={s.key} onClick={() => setF("sentiment", s.key)} style={{
                          padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer", fontWeight: 600,
                          background: form.sentiment === s.key ? `${s.color}22` : T.navy3,
                          border: `1px solid ${form.sentiment === s.key ? s.color : T.border}`,
                          color: form.sentiment === s.key ? s.color : T.text3,
                        }}>{s.label}</button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
                    <button className="btn btn-primary" onClick={save} disabled={saving || (!form.notes.trim() && !form.topics.trim() && form.action_items.length === 0)}>
                      {saving ? "Saving..." : "Save Session"}
                    </button>
                  </div>
                </div>
              )}

              {tab === "history" && (
                sessions.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 0", color: T.text3 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
                    <div style={{ fontSize: 14 }}>No sessions yet</div>
                    <div style={{ fontSize: 12, marginTop: 5 }}>Save your first session from the New Session tab</div>
                  </div>
                ) : (
                  sessions.map((s) => {
                    const sent = SESSION_SENTIMENTS.find(x => x.key === s.sentiment);
                    const isOpen = expanded === s.id;
                    return (
                      <div key={s.id} style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
                          onClick={() => setExpanded(isOpen ? null : s.id)}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{s.session_date}</div>
                            {s.topics && <div style={{ fontSize: 11, color: T.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.topics}</div>}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                            {(s.action_items || []).length > 0 && (
                              <span style={{ fontSize: 11, color: T.accent }}>{s.action_items.length} action{s.action_items.length > 1 ? "s" : ""}</span>
                            )}
                            {sent && <span style={{ fontSize: 11, color: sent.color, fontWeight: 600 }}>{sent.label}</span>}
                            <span style={{ color: T.text3, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ borderTop: `1px solid ${T.border}`, padding: "14px 16px" }}>
                            {s.notes && (
                              <div style={{ marginBottom: 12 }}>
                                <div className="diary-section-heading" style={{ marginBottom: 5 }}>Notes</div>
                                <div style={{ fontSize: 13, color: T.text2, whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{s.notes}</div>
                              </div>
                            )}
                            {(s.action_items || []).length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div className="diary-section-heading" style={{ marginBottom: 5 }}>Action items</div>
                                {s.action_items.map((a, i) => (
                                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
                                    <span style={{ flexShrink: 0 }}>{a.done ? "✅" : "☐"}</span>
                                    <span style={{ color: a.done ? T.text3 : T.text1, textDecoration: a.done ? "line-through" : "none" }}>{a.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {(s.feedback_given || []).length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div className="diary-section-heading" style={{ marginBottom: 5 }}>Feedback given</div>
                                {s.feedback_given.map((f, i) => (
                                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 5, color: T.text2 }}>
                                    <span style={{ color: feedbackColor(f.type), fontWeight: 600, flexShrink: 0 }}>{FEEDBACK_TYPES.find(t => t.key === f.type)?.label}</span>
                                    <span>{f.note}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {s.next_session_date && (
                              <div style={{ fontSize: 12, color: T.teal, marginBottom: 10 }}>Next session: {s.next_session_date}</div>
                            )}
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: T.coral, borderColor: `${T.coral}40` }}
                              onClick={() => deleteSession(s.id)}>Delete session</button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiaryEntryModal({ entry, previousEntry, onClose, onSave, scratchNotes = [], onAutoSave }) {
  const initCF = !entry && previousEntry?.carry_forward
    ? previousEntry.carry_forward.filter(i => !i.done).map(i => ({ ...i, done: false }))
    : [];
  const initReminders = !entry && previousEntry?.reminders
    ? previousEntry.reminders.filter(i => !i.checked).map(i => ({ ...i, checked: false }))
    : [];

  const [form, setForm] = useState(() => entry ? {
    ...entry,
    jira_links:     entry.jira_links     || [],
    collaborators:  entry.collaborators  || [],
    tags:           entry.tags           || [],
    team_updates:   entry.team_updates   || [],
    feedback_given: entry.feedback_given || [],
    carry_forward:  entry.carry_forward  || [],
    reminders:      entry.reminders      || [],
    focus_areas:    entry.focus_areas?.length ? entry.focus_areas : (entry.focus_area ? [entry.focus_area] : []),
    focus_area:     entry.focus_area     || "",
    blockers:       entry.blockers       || "",
    mood:           entry.mood           || "",
    content:        entry.content        || "",
    linked_note:    entry.linked_note    || null,
    is_win:         entry.is_win          || false,
    win_tags:       entry.win_tags        || [],
    categories:     entry.categories      || {},
    team_attendance:entry.team_attendance || [],
  } : {
    date: today(), focus_area: "", focus_areas: [], mood: "", content: "", blockers: "",
    jira_links: [], collaborators: [], tags: [], team_updates: [], feedback_given: [],
    carry_forward: initCF,
    reminders: initReminders,
    linked_note: null,
    is_win: false,
    win_tags: [],
    categories: {},
    team_attendance: [],
  });

  const [tab, setTab] = useState("day");
  const [jiraInput, setJiraInput] = useState("");
  const [collabInput, setCollabInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [teamForm, setTeamForm] = useState({ name: "", update: "", status: "on_track" });
  const [feedbackForm, setFeedbackForm] = useState({ to: "", type: "constructive", note: "" });
  const [cfInput, setCfInput] = useState("");
  const [cfPriority, setCfPriority] = useState("medium");
  const [reminderInput, setReminderInput] = useState("");
  const [pointInput, setPointInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const categorise = async () => {
    const bullets = (form.content || "").split("\n").filter(b => b.trim());
    if (!bullets.length) return;
    setAiLoading(true); setAiError("");
    try {
      const knownPeople = (loadTeammates() || []).map(t => t.name);
      const cats = await callGroq(bullets, knownPeople);
      if (cats) {
        const existing = form.collaborators || [];
        const existingLower = existing.map(x => x.toLowerCase());
        const fresh = (cats.people || []).filter(p => p && !existingLower.includes(p.toLowerCase()));
        const merged = [...existing, ...fresh];
        // Final dedup preserving order
        const collaborators = merged.filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
        const updatedForm = {
          ...form,
          categories: cats,
          collaborators,
        };
        setForm(updatedForm);
        // Auto-save silently after categorisation — only for existing entries (form.id exists).
        // New entries have no id yet; calling onAutoSave without an id does an INSERT each time, creating duplicates.
        if (onAutoSave && updatedForm.id) {
          await onAutoSave({ ...updatedForm, title: fmtDate(updatedForm.date), focus_area: (updatedForm.focus_areas || [])[0] || updatedForm.focus_area || "" });
        }
      }
    } catch (e) {
      setAiError(e.message || "AI error.");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    const bullets = (form.content || "").split("\n").filter(b => b.trim());
    if (!bullets.length) return;
    const t = setTimeout(() => { categorise(); }, 1500);
    return () => clearTimeout(t);
  }, [form.content]); // eslint-disable-line react-hooks/exhaustive-deps

  const _now = new Date();
  const _todayStr = _now.toISOString().slice(0, 10);
  const _hour = _now.getHours();
  const _isToday = form.date === _todayStr;
  const _isFuture = form.date > _todayStr;
  const contentLabel = _isFuture ? "Plans"
    : _isToday && _hour < 12 ? "Morning Plan"
    : _isToday && _hour < 17 ? "In Progress"
    : _isToday ? "Today's Work"
    : "What Happened";
  const contentModeTag = _isToday && _hour < 12 ? { text: "planning mode", color: T.accent }
    : _isToday && _hour < 17 ? { text: "mid-day", color: T.teal }
    : _isToday ? { text: "end of day", color: T.gold }
    : null;
  const contentPlaceholder = _isFuture ? "What are you planning to work on?"
    : _isToday && _hour < 12 ? "What are you planning to tackle today? (goals, tasks, priorities…)"
    : _isToday && _hour < 17 ? "What are you working on right now?"
    : _isToday ? "What did you get done today? Tasks, PRs, decisions, wins…"
    : "What did you work on? Tasks, PRs, decisions…";

  const addJira = () => {
    const t = jiraInput.trim();
    if (t && !form.jira_links.includes(t)) { set("jira_links", [...form.jira_links, t]); setJiraInput(""); }
  };
  const addCollab = () => {
    const t = collabInput.trim();
    if (t && !form.collaborators.includes(t)) { set("collaborators", [...form.collaborators, t]); setCollabInput(""); }
  };
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) { set("tags", [...form.tags, t]); setTagInput(""); }
  };

  const addTeamUpdate = () => {
    if (!teamForm.name.trim() || !teamForm.update.trim()) return;
    set("team_updates", [...form.team_updates, { ...teamForm }]);
    setTeamForm({ name: "", update: "", status: "on_track" });
  };
  const removeTeamUpdate = (idx) => set("team_updates", form.team_updates.filter((_, i) => i !== idx));

  const addFeedback = () => {
    if (!feedbackForm.to.trim() || !feedbackForm.note.trim()) return;
    set("feedback_given", [...form.feedback_given, { ...feedbackForm }]);
    setFeedbackForm({ to: "", type: "constructive", note: "" });
  };
  const removeFeedback = (idx) => set("feedback_given", form.feedback_given.filter((_, i) => i !== idx));

  const addCarryForward = () => {
    if (!cfInput.trim()) return;
    set("carry_forward", [...form.carry_forward, { text: cfInput.trim(), done: false, priority: cfPriority }]);
    setCfInput("");
  };
  const toggleCF = (idx) => set("carry_forward", form.carry_forward.map((item, i) => i === idx ? { ...item, done: !item.done } : item));
  const removeCF = (idx) => set("carry_forward", form.carry_forward.filter((_, i) => i !== idx));

  const addReminder = () => {
    if (!reminderInput.trim()) return;
    set("reminders", [...form.reminders, { text: reminderInput.trim(), checked: false }]);
    setReminderInput("");
  };
  const toggleReminder = (idx) => set("reminders", form.reminders.map((item, i) => i === idx ? { ...item, checked: !item.checked } : item));
  const removeReminder = (idx) => set("reminders", form.reminders.filter((_, i) => i !== idx));

  const save = async () => {
    if (!form.date) return;
    setSaving(true);
    await onSave({ ...form, title: fmtDate(form.date), focus_area: (form.focus_areas || [])[0] || form.focus_area || "" });
    setSaving(false);
    onClose();
  };

  const pendingCF = form.carry_forward.filter(i => !i.done).length;
  const pendingR  = form.reminders.filter(i => !i.checked).length;

  const TABS = [
    { key: "day",        label: "My Day" },
    { key: "team",       label: `Team${form.team_updates.length > 0 ? ` (${form.team_updates.length})` : ""}` },
    { key: "attendance", label: `Attendance${(form.team_attendance || []).length > 0 ? ` ✓` : ""}` },
    { key: "actions",    label: `Actions${pendingCF + pendingR > 0 ? ` · ${pendingCF + pendingR} open` : ""}` },
  ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-title">
          <span>{entry ? "Edit Entry" : "New Entry"}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="diary-tabs">
          {TABS.map(t => (
            <button key={t.key} className={`diary-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── My Day ── */}
        {tab === "day" && (
          <div>
            {/* Yesterday's context banner — new entries only */}
            {!entry && previousEntry && (() => {
              const prevPoints = (previousEntry.content || "").split("\n").filter(Boolean);
              const unresolved = (previousEntry.carry_forward || []).filter(i => !i.done);
              if (prevPoints.length === 0 && unresolved.length === 0) return null;
              return (
                <div style={{ background: `${T.accent}0a`, border: `1px solid ${T.accent}22`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 5 }}>Yesterday · {fmtDate(previousEntry.date)}</div>
                    {prevPoints.slice(0, 2).map((l, i) => (
                      <div key={i} style={{ fontSize: 11, color: T.text3, marginBottom: 2 }}>• {l.slice(0, 60)}{l.length > 60 ? "…" : ""}</div>
                    ))}
                    {unresolved.length > 0 && <div style={{ fontSize: 11, color: T.gold, marginTop: 3 }}>⬆ {unresolved.length} unresolved item{unresolved.length !== 1 ? "s" : ""} rolled over</div>}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, fontSize: 11, whiteSpace: "nowrap" }}
                    onClick={() => {
                      const pts = [...prevPoints.slice(0, 3), ...unresolved.map(i => i.text)].filter(Boolean);
                      const existing = (form.content || "").split("\n").filter(Boolean);
                      const merged = [...new Set([...existing, ...pts])];
                      set("content", merged.join("\n"));
                    }}>
                    Draft from here ↓
                  </button>
                </div>
              );
            })()}
            {/* ── Compact header: Date + Mood side by side ── */}
            <div style={{ display: "flex", gap: 12, marginBottom: 14, alignItems: "flex-start" }}>
              <div style={{ flex: "0 0 160px" }}>
                <label className="form-label">Date *</label>
                <input type="date" className="form-input" value={form.date} onChange={e => set("date", e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Energy / Mood</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                  {MOODS.map(m => (
                    <button key={m.key} className={`mood-btn${form.mood === m.key ? " selected" : ""}`} title={m.label}
                      onClick={() => set("mood", form.mood === m.key ? "" : m.key)}>
                      {m.emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Focus Areas (horizontal chips) ── */}
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Focus Areas</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {FOCUS_AREAS.map(f => {
                  const selected = (form.focus_areas || []).includes(f);
                  return (
                    <button key={f} onClick={() => set("focus_areas", selected
                      ? (form.focus_areas || []).filter(x => x !== f)
                      : [...(form.focus_areas || []), f]
                    )} style={{
                      fontSize: 11, padding: "3px 9px", borderRadius: 20, cursor: "pointer",
                      border: `1px solid ${selected ? T.accent : T.border}`,
                      background: selected ? `${T.accent}22` : "transparent",
                      color: selected ? T.accent : T.text3,
                      fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                    }}>{f}</button>
                  );
                })}
              </div>
            </div>

            {/* ── Log Zone ── */}
            <div className="form-group">
              <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {contentLabel}
                {contentModeTag && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: contentModeTag.color, background: `${contentModeTag.color}18`, border: `1px solid ${contentModeTag.color}35`, borderRadius: 4, padding: "1px 7px", letterSpacing: 0.4 }}>
                    {contentModeTag.text}
                  </span>
                )}
                {(form.content || "").split("\n").filter(p => p.trim()).length > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: T.text3 }}>
                    {(form.content || "").split("\n").filter(p => p.trim()).length} items
                  </span>
                )}
              </label>
              {(form.content || "").split("\n").filter(p => p.trim()).length > 0 && (
                <div style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                  {(form.content || "").split("\n").filter(p => p.trim()).map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderBottom: i < (form.content || "").split("\n").filter(x => x.trim()).length - 1 ? `1px solid ${T.border}` : "none" }}>
                      <span style={{ color: T.accent, flexShrink: 0, marginTop: 1, fontSize: 14 }}>•</span>
                      <span style={{ flex: 1, fontSize: 13, color: T.text1, lineHeight: 1.5 }}>{p}</span>
                      <button onClick={() => {
                        const pts = (form.content || "").split("\n").filter(x => x.trim());
                        pts.splice(i, 1);
                        set("content", pts.join("\n"));
                      }} style={{ background: "none", border: "none", cursor: "pointer", color: T.text3, fontSize: 13, padding: "0 2px", flexShrink: 0, lineHeight: 1 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" className="form-input" placeholder={contentPlaceholder}
                  value={pointInput}
                  onChange={e => setPointInput(e.target.value)}
                  onPaste={e => {
                    const pasted = e.clipboardData.getData("text");
                    const lines = pasted.split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
                    if (lines.length > 1) {
                      e.preventDefault();
                      const existing = (form.content || "").split("\n").filter(x => x.trim());
                      set("content", [...existing, ...lines].join("\n"));
                      setPointInput("");
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const t = pointInput.trim();
                      if (!t) return;
                      const existing = (form.content || "").split("\n").filter(x => x.trim());
                      set("content", [...existing, t].join("\n"));
                      setPointInput("");
                    }
                  }} />
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  const t = pointInput.trim();
                  if (!t) return;
                  const existing = (form.content || "").split("\n").filter(x => x.trim());
                  set("content", [...existing, t].join("\n"));
                  setPointInput("");
                }}>+ Add</button>
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 5 }}>Press Enter to add · Paste multiple lines to bulk-add</div>
            </div>

            {/* ── AI Categorise ── */}
            {(form.content || "").split("\n").filter(p => p.trim()).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", minHeight: 22 }}>
                  {aiLoading && (
                    <span style={{ fontSize: 11, color: T.accent, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 13 }}>⏳</span> Auto-categorising…
                    </span>
                  )}
                  {!aiLoading && Object.keys(form.categories || {}).some(k => (form.categories[k] || []).length > 0) && (
                    <span style={{ fontSize: 11, color: T.teal }}>✨ AI categorised
                      <button onClick={categorise} style={{ background: "none", border: "none", color: T.text3, fontSize: 11, cursor: "pointer", marginLeft: 6, padding: 0 }}>refresh</button>
                    </span>
                  )}
                  {aiError && <span style={{ fontSize: 11, color: T.coral }}>{aiError}</span>}
                </div>

                {Object.keys(form.categories || {}).some(k => (form.categories[k] || []).length > 0) && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                    {[
                      { key: "meeting",    label: "Meetings",   icon: "🤝", color: T.accent },
                      { key: "execution",  label: "Execution",  icon: "⚡", color: T.teal },
                      { key: "validation", label: "Validation", icon: "✅", color: "#4CAF50" },
                      { key: "other",      label: "Other",      icon: "📋", color: T.text2 },
                    ].filter(cat => (form.categories[cat.key] || []).length > 0).map(cat => (
                      <div key={cat.key} style={{
                        background: `${cat.color}0d`, border: `1px solid ${cat.color}30`,
                        borderRadius: 10, padding: "10px 12px",
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cat.color, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                          {cat.icon} {cat.label}
                          <span style={{ fontWeight: 400, color: T.text3 }}>· {(form.categories[cat.key] || []).length}</span>
                        </div>
                        {(form.categories[cat.key] || []).map((item, i) => (
                          <div key={i} style={{ fontSize: 12, color: T.text2, lineHeight: 1.5, marginBottom: 2 }}>• {typeof item === "string" ? item : (item?.text || item?.item || item?.content || JSON.stringify(item))}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Blockers ── */}
            <div className="form-group">
              <label className="form-label">Blockers</label>
              <textarea className="form-textarea" style={{ minHeight: 50 }}
                placeholder="What's slowing you down? Missing access, unclear requirements, dependencies…"
                value={form.blockers || ""} onChange={e => set("blockers", e.target.value)} />
            </div>

            {/* ── Secondary details: Jira + Collaborators + Tags (collapsible) ── */}
            <details style={{ marginBottom: 16 }}>
              <summary style={{ fontSize: 12, color: T.text3, cursor: "pointer", userSelect: "none", listStyle: "none", display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                <span style={{ fontSize: 10, display: "inline-block", transition: "transform 0.15s" }}>▸</span>
                <span>More details</span>
                {(form.jira_links.length + form.collaborators.length + form.tags.length) > 0 && (
                  <span style={{ fontSize: 10, background: `${T.accent}20`, color: T.accent, borderRadius: 10, padding: "1px 7px", marginLeft: 2 }}>
                    {form.jira_links.length + form.collaborators.length + form.tags.length}
                  </span>
                )}
              </summary>
              <div style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label className="form-label">Jira Tickets</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="text" className="form-input" placeholder="Ticket ID or URL (e.g. PROJ-123)" value={jiraInput}
                      onChange={e => setJiraInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addJira())} />
                    <button className="btn btn-ghost btn-sm" onClick={addJira}>Add</button>
                  </div>
                  {form.jira_links.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {form.jira_links.map(l => (
                        <span key={l} className="ticket-chip" style={{ cursor: "pointer" }} onClick={() => set("jira_links", form.jira_links.filter(x => x !== l))}>
                          {l} ✕
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Collaborators</label>
                  {(() => {
                    const saved = loadTeammates();
                    const unpicked = saved.filter(t => !form.collaborators.includes(t.name));
                    if (unpicked.length === 0) return null;
                    return (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        {unpicked.map((t, i) => (
                          <button key={i} onClick={() => set("collaborators", [...form.collaborators, t.name])}
                            style={{
                              display: "flex", alignItems: "center", gap: 5,
                              background: "rgba(79,142,247,0.08)", border: `1px solid ${T.border}`,
                              borderRadius: 20, padding: "3px 10px", cursor: "pointer",
                              fontSize: 12, color: T.accent, fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                            }} title={t.role || t.name}>
                            <span style={{ fontSize: 13 }}>{t.emoji || "👤"}</span>
                            {t.name}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="text" className="form-input" placeholder="Or type a name manually" value={collabInput}
                      onChange={e => setCollabInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCollab())} />
                    <button className="btn btn-ghost btn-sm" onClick={addCollab}>Add</button>
                  </div>
                  {form.collaborators.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {form.collaborators.map(c => (
                        <span key={c} className="tag tag-blue" style={{ cursor: "pointer" }} onClick={() => set("collaborators", form.collaborators.filter(x => x !== c))}>
                          👤 {cleanCollab(c)} ✕
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Tags</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="text" className="form-input" placeholder="Add tag, press Enter" value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())} />
                    <button className="btn btn-ghost btn-sm" onClick={addTag}>Add</button>
                  </div>
                  {form.tags.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {form.tags.map(t => (
                        <span key={t} className="tag tag-teal" style={{ cursor: "pointer" }} onClick={() => set("tags", form.tags.filter(x => x !== t))}>
                          {t} ✕
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>

            {/* ── Mark as Win ── */}
            <div style={{
              background: form.is_win ? `${T.gold}10` : T.navy3,
              border: `1px solid ${form.is_win ? `${T.gold}60` : T.border}`,
              borderRadius: 10, padding: "12px 14px", marginBottom: 16,
              cursor: "pointer", transition: "all 0.2s",
            }} onClick={() => set("is_win", !form.is_win)}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{form.is_win ? "🏆" : "🏅"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: form.is_win ? T.gold : T.text2 }}>
                    {form.is_win ? "Marked as Win — goes to your Brag Doc" : "Mark as Win"}
                  </div>
                  {!form.is_win && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Caught a bug? Shipped something? Mentored someone? Flag it.</div>}
                </div>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: form.is_win ? T.gold : T.navy4, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 2, left: form.is_win ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                </div>
              </div>
              {form.is_win && (
                <div style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Impact type (optional)</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {WIN_TAGS.map(wt => {
                      const sel = (form.win_tags || []).includes(wt.key);
                      return (
                        <button key={wt.key} onClick={() => set("win_tags", sel
                          ? (form.win_tags || []).filter(x => x !== wt.key)
                          : [...(form.win_tags || []), wt.key]
                        )} style={{
                          fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                          border: `1px solid ${sel ? wt.color : T.border}`,
                          background: sel ? `${wt.color}22` : "transparent",
                          color: sel ? wt.color : T.text3,
                          fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                        }}>{wt.icon} {wt.label}</button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Linked Note ── */}
            {scratchNotes.length > 0 && (
              <div className="form-group">
                <label className="form-label">📎 Link a Note</label>
                {form.linked_note ? (
                  <div style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.accent }}>📝 {form.linked_note.title || "Untitled"}</span>
                      <button onClick={() => set("linked_note", null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}>Unlink ✕</button>
                    </div>
                    <div style={{ fontSize: 12, color: T.text3, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {(form.linked_note.text || "").slice(0, 150)}{(form.linked_note.text || "").length > 150 ? "…" : ""}
                    </div>
                  </div>
                ) : (
                  <select className="form-select" value="" onChange={e => {
                    const n = scratchNotes.find(n => String(n.id) === e.target.value);
                    if (n) set("linked_note", { id: n.id, title: n.title, text: n.text, group: n.group });
                  }}>
                    <option value="">— Pick a scratch pad note to link —</option>
                    {scratchNotes.map(n => (
                      <option key={n.id} value={String(n.id)}>
                        {n.title || "Untitled"}{n.group ? ` [${n.group}]` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Team ── */}
        {tab === "team" && (
          <div>
            <div className="diary-section-heading">Team Progress</div>
            <SectionInput>
              {/* Team member quick-pick */}
              {(() => {
                const saved = loadTeammates();
                if (saved.length === 0) return null;
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {saved.map((t, i) => (
                      <button key={i} onClick={() => setTeamForm(f => ({ ...f, name: t.name }))}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          background: teamForm.name === t.name ? `${T.accent}20` : "rgba(79,142,247,0.05)",
                          border: `1px solid ${teamForm.name === t.name ? T.accent : T.border}`,
                          borderRadius: 20, padding: "3px 10px", cursor: "pointer",
                          fontSize: 12, color: teamForm.name === t.name ? T.accent : T.text2,
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{t.emoji || "👤"}</span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <div className="grid-2" style={{ marginBottom: 10 }}>
                <div>
                  <label className="form-label">Member</label>
                  <input type="text" className="form-input" placeholder="Name" value={teamForm.name}
                    onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-select" value={teamForm.status} onChange={e => setTeamForm(f => ({ ...f, status: e.target.value }))}>
                    {TEAM_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="form-label">Progress / Update</label>
                <textarea className="form-textarea" style={{ minHeight: 60 }} placeholder="What did this person work on or accomplish?"
                  value={teamForm.update} onChange={e => setTeamForm(f => ({ ...f, update: e.target.value }))} />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={addTeamUpdate}>+ Log Update</button>
            </SectionInput>
            {form.team_updates.length === 0
              ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "12px 0 20px" }}>No team updates logged yet.</div>
              : form.team_updates.map((u, idx) => (
                <div key={idx} className="team-card" style={{ borderLeft: `3px solid ${statusColor(u.status)}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>👤 {u.name}</span>
                      <span className="status-badge" style={{ background: `${statusColor(u.status)}18`, color: statusColor(u.status), borderColor: `${statusColor(u.status)}40` }}>
                        {TEAM_STATUSES.find(s => s.key === u.status)?.label}
                      </span>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => removeTeamUpdate(idx)}>✕</button>
                  </div>
                  <div style={{ fontSize: 13, color: T.text2 }}>{u.update}</div>
                </div>
              ))
            }

            <div className="diary-section-heading" style={{ marginTop: 24 }}>Feedback Given</div>
            <SectionInput>
              {/* Feedback recipient quick-pick */}
              {(() => {
                const saved = loadTeammates();
                if (saved.length === 0) return null;
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {saved.map((t, i) => (
                      <button key={i} onClick={() => setFeedbackForm(f => ({ ...f, to: t.name }))}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          background: feedbackForm.to === t.name ? `${T.teal}20` : "rgba(63,207,180,0.05)",
                          border: `1px solid ${feedbackForm.to === t.name ? T.teal : T.border}`,
                          borderRadius: 20, padding: "3px 10px", cursor: "pointer",
                          fontSize: 12, color: feedbackForm.to === t.name ? T.teal : T.text2,
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{t.emoji || "👤"}</span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <div className="grid-2" style={{ marginBottom: 10 }}>
                <div>
                  <label className="form-label">To</label>
                  <input type="text" className="form-input" placeholder="Recipient" value={feedbackForm.to}
                    onChange={e => setFeedbackForm(f => ({ ...f, to: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Type</label>
                  <select className="form-select" value={feedbackForm.type} onChange={e => setFeedbackForm(f => ({ ...f, type: e.target.value }))}>
                    {FEEDBACK_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="form-label">Note</label>
                <textarea className="form-textarea" style={{ minHeight: 60 }} placeholder="What feedback did you give?"
                  value={feedbackForm.note} onChange={e => setFeedbackForm(f => ({ ...f, note: e.target.value }))} />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={addFeedback}>+ Log Feedback</button>
            </SectionInput>
            {form.feedback_given.length === 0
              ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "12px 0 20px" }}>No feedback logged yet.</div>
              : form.feedback_given.map((fb, idx) => (
                <div key={idx} className="team-card" style={{ borderLeft: `3px solid ${feedbackColor(fb.type)}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>→ {fb.to}</span>
                      <span className="status-badge" style={{ background: `${feedbackColor(fb.type)}18`, color: feedbackColor(fb.type), borderColor: `${feedbackColor(fb.type)}40` }}>
                        {FEEDBACK_TYPES.find(t => t.key === fb.type)?.label}
                      </span>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => removeFeedback(idx)}>✕</button>
                  </div>
                  <div style={{ fontSize: 13, color: T.text2 }}>{fb.note}</div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── Attendance ── */}
        {tab === "attendance" && (
          <div>
            <div className="diary-section-heading">Team Attendance</div>
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 14 }}>Log who's in office, WFH, or on leave today. Click again to clear.</div>
            {(() => {
              const teammates = loadTeammates();
              if (teammates.length === 0) return (
                <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "28px 0" }}>
                  No teammates saved yet. Add them in <strong>My Team</strong> first.
                </div>
              );
              const getAtt = (name) => (form.team_attendance || []).find(a => a.name === name)?.status || null;
              const setAtt = (name, status) => {
                const rest = (form.team_attendance || []).filter(a => a.name !== name);
                set("team_attendance", status ? [...rest, { name, status }] : rest);
              };
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {teammates.map((t, i) => {
                    const cur = getAtt(t.name);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.bg3, borderRadius: 8, border: `1px solid ${cur ? attColor(cur) + "40" : T.border}` }}>
                        <span style={{ fontSize: 15 }}>{t.emoji || "👤"}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: T.text1 }}>{t.name}</span>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {ATT_STATUSES.map(s => (
                            <button key={s.key} onClick={() => setAtt(t.name, cur === s.key ? null : s.key)} title={s.label}
                              style={{
                                background: cur === s.key ? `${s.color}25` : "transparent",
                                border: `1px solid ${cur === s.key ? s.color : T.border}`,
                                borderRadius: 6, padding: "3px 8px", cursor: "pointer",
                                fontSize: 11, color: cur === s.key ? s.color : T.text3,
                                fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                              }}
                            >{s.icon} {s.label}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Actions ── */}
        {tab === "actions" && (
          <div>
            <div className="diary-section-heading">
              Carry Forward
              {!entry && initCF.length > 0 && (
                <span style={{ fontSize: 11, color: T.gold, marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  ↑ {initCF.length} rolled from previous entry
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input type="text" className="form-input" placeholder="Something to pick up tomorrow..." value={cfInput}
                onChange={e => setCfInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCarryForward())} />
              <select className="form-select" style={{ width: 80 }} value={cfPriority} onChange={e => setCfPriority(e.target.value)}>
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={addCarryForward}>Add</button>
            </div>
            {form.carry_forward.length === 0
              ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "12px 0 20px" }}>Nothing to carry forward.</div>
              : form.carry_forward.map((item, idx) => (
                <div key={idx} className="checklist-item">
                  <input type="checkbox" checked={item.done} onChange={() => toggleCF(idx)} style={{ accentColor: T.accent, width: 15, height: 15, flexShrink: 0, cursor: "pointer" }} />
                  <span style={{ flex: 1, fontSize: 13, color: item.done ? T.text3 : T.text1, textDecoration: item.done ? "line-through" : "none" }}>{item.text}</span>
                  <span className="status-badge" style={{ background: `${priorityColor(item.priority)}18`, color: priorityColor(item.priority), borderColor: `${priorityColor(item.priority)}40` }}>
                    {item.priority}
                  </span>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => removeCF(idx)}>✕</button>
                </div>
              ))
            }

            <div className="diary-section-heading" style={{ marginTop: 24 }}>
              Reminders & Checks
              {!entry && initReminders.length > 0 && (
                <span style={{ fontSize: 11, color: T.gold, marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  ↑ {initReminders.length} rolled from previous entry
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input type="text" className="form-input" placeholder="Check deployment status, follow up on PR..." value={reminderInput}
                onChange={e => setReminderInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addReminder())} />
              <button className="btn btn-ghost btn-sm" onClick={addReminder}>Add</button>
            </div>
            {form.reminders.length === 0
              ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "12px 0 20px" }}>No reminders set.</div>
              : form.reminders.map((item, idx) => (
                <div key={idx} className="checklist-item">
                  <input type="checkbox" checked={item.checked} onChange={() => toggleReminder(idx)} style={{ accentColor: T.accent, width: 15, height: 15, flexShrink: 0, cursor: "pointer" }} />
                  <span style={{ flex: 1, fontSize: 13, color: item.checked ? T.text3 : T.text1, textDecoration: item.checked ? "line-through" : "none" }}>{item.text}</span>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => removeReminder(idx)}>✕</button>
                </div>
              ))
            }
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.date}>
            {saving ? "Saving…" : entry ? "Update Entry" : "Save Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WeeklyReportModal({ entries, onClose }) {
  const [copied, setCopied] = useState(false);

  const now = new Date();
  const dow = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().split("T")[0];

  const week = entries
    .filter(e => e.date >= mondayStr)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const allJiras    = [...new Set(week.flatMap(e => e.jira_links    || []))];
  const allCollabs  = [...new Set(week.flatMap(e => e.collaborators || []))];
  const allTeam     = [...new Set(week.flatMap(e => (e.team_updates || []).map(u => u.name)))];
  const allFeedback = week.flatMap(e => (e.feedback_given || []).map(f => `${f.to} (${f.type})`));
  const pendingCF   = [...new Set(week.flatMap(e => (e.carry_forward || []).filter(i => !i.done).map(i => i.text)))];
  const resolvedCF  = week.reduce((n, e) => n + (e.carry_forward || []).filter(i => i.done).length, 0);
  const blockers    = week.filter(e => e.blockers);

  const catTotals = { meeting: 0, execution: 0, validation: 0, other: 0 };
  week.forEach(e => {
    if (!e.categories) return;
    ["meeting", "execution", "validation", "other"].forEach(k => {
      catTotals[k] += (e.categories[k] || []).length;
    });
  });
  const hasCatData = Object.values(catTotals).some(v => v > 0);
  const allCatItems = {
    meeting: [...new Set(week.flatMap(e => e.categories?.meeting || []))],
    execution: [...new Set(week.flatMap(e => e.categories?.execution || []))],
    validation: [...new Set(week.flatMap(e => e.categories?.validation || []))],
    other: [...new Set(week.flatMap(e => e.categories?.other || []))],
  };

  const focusCounts = {};
  week.forEach(e => { getFocusAreas(e).forEach(f => { focusCounts[f] = (focusCounts[f] || 0) + 1; }); });
  const topFocus = Object.entries(focusCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v}d)`).join(", ");
  const moodLine = week.filter(e => e.mood).map(e => MOODS.find(m => m.key === e.mood)?.emoji || "").join(" ");

  const text = [
    `📊 WEEKLY REPORT — w/c ${fmtDate(mondayStr)}`,
    ``,
    `━━━ SUMMARY ━━━`,
    `Days logged   : ${week.length} of 5`,
    `Mood this week: ${moodLine || "—"}`,
    topFocus        ? `Focus areas   : ${topFocus}` : "",
    allJiras.length ? `JIRAs worked  : ${allJiras.join(", ")}` : "",
    allCollabs.length ? `Collaborated  : ${allCollabs.join(", ")}` : "",
    ``,
    ...(hasCatData ? [
      `━━━ WORK BREAKDOWN ━━━`,
      `🤝 Meetings    : ${catTotals.meeting} items`,
      `⚡ Execution   : ${catTotals.execution} items`,
      `✅ Validation  : ${catTotals.validation} items`,
      `📋 Other       : ${catTotals.other} items`,
      ...(allCatItems.meeting.length   ? [`   Meetings   → ${allCatItems.meeting.join(" · ")}`]   : []),
      ...(allCatItems.execution.length ? [`   Execution  → ${allCatItems.execution.join(" · ")}`] : []),
      ...(allCatItems.validation.length? [`   Validation → ${allCatItems.validation.join(" · ")}`]: []),
      ``,
    ] : []),
    `━━━ TEAM ━━━`,
    allTeam.length     ? `Tracked  : ${allTeam.join(", ")}`     : "No team updates logged.",
    allFeedback.length ? `Feedback : ${allFeedback.join("; ")}` : "",
    ``,
    `━━━ BLOCKERS ━━━`,
    ...(blockers.length ? blockers.map(e => `${fmtDate(e.date)}: ${e.blockers}`) : ["None this week"]),
    ``,
    `━━━ CARRY FORWARD ━━━`,
    `Resolved this week : ${resolvedCF}`,
    `Still pending      : ${pendingCF.length}`,
    ...(pendingCF.map(t => `  • ${t}`)),
    ``,
    `━━━ DAILY LOG ━━━`,
    ...(week.length
      ? week.map(e => {
          const mood = MOODS.find(m => m.key === e.mood);
          return `${fmtDate(e.date)}  ${mood?.emoji || "  "} ${e.focus_area || ""}${e.blockers ? "  ⚠ blocker" : ""}`;
        })
      : ["No entries this week."]),
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="modal-title">
          <div>
            <div style={{ fontWeight: 600 }}>📊 Weekly Report</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
              w/c {fmtDate(mondayStr)} · {week.length} {week.length === 1 ? "entry" : "entries"} logged
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {week.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 0", color: T.text3, fontSize: 13 }}>
            No diary entries logged this week yet.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              {[
                { label: "Days", value: `${week.length}/5`, color: T.accent },
                { label: "JIRAs", value: allJiras.length, color: T.gold },
                { label: "CF resolved", value: resolvedCF, color: T.teal },
                { label: "CF pending", value: pendingCF.length, color: pendingCF.length > 0 ? T.coral : T.text3 },
              ].map(s => (
                <div key={s.label} style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 12px", flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'DM Mono', monospace" }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: T.text3, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                </div>
              ))}
            </div>
            {hasCatData && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>Work Breakdown</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { key: "meeting",    label: "Meetings",   icon: "🤝", color: T.accent },
                    { key: "execution",  label: "Execution",  icon: "⚡", color: T.teal },
                    { key: "validation", label: "Validation", icon: "✅", color: "#4CAF50" },
                    { key: "other",      label: "Other",      icon: "📋", color: T.text2 },
                  ].map(c => (
                    <div key={c.key} style={{ background: `${c.color}12`, border: `1px solid ${c.color}30`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{c.icon}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: c.color, fontFamily: "'DM Mono', monospace" }}>{catTotals[c.key]}</div>
                      <div style={{ fontSize: 10, color: T.text3, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>{c.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <pre style={{
              background: T.navy0, border: `1px solid ${T.border}`, borderRadius: 8,
              padding: "14px 16px", fontSize: 12, color: T.text1, lineHeight: 1.8,
              whiteSpace: "pre-wrap", fontFamily: "'DM Mono', monospace",
              maxHeight: 340, overflowY: "auto", marginBottom: 16,
            }}>{text}</pre>
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {week.length > 0 && (
            <button className="btn btn-primary" onClick={copy} style={{ minWidth: 150 }}>
              {copied ? "✓ Copied!" : "📋 Copy Report"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StandupModal({ entry, onClose }) {
  const [copied, setCopied] = useState(false);
  const mood    = MOODS.find(m => m.key === entry.mood);
  const pending = (entry.carry_forward || []).filter(i => !i.done);

  const lines = [
    `📋 STANDUP — ${fmtDate(entry.date)}`,
    ``,
    `Yesterday:`,
    entry.content || "(no notes recorded)",
    getFocusAreas(entry).length ? `Focus areas: ${getFocusAreas(entry).join(", ")}` : "",
    (entry.jira_links || []).length ? `JIRAs worked: ${entry.jira_links.join(", ")}` : "",
    (entry.collaborators || []).length ? `Collaborated with: ${entry.collaborators.join(", ")}` : "",
    ``,
    `Blockers: ${entry.blockers || "None"}`,
    ``,
    `Today's plan:`,
    ...(pending.length
      ? pending.map(i => `  • [${(i.priority || "med").toUpperCase()}] ${i.text}`)
      : ["  • (add your plan for today)"]),
  ];

  const text = lines
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-title">
          <div>
            <div style={{ fontWeight: 600 }}>📋 Standup Generator</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>Copy and paste into Slack or your standup tool</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {mood && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, fontSize: 13, color: T.text2 }}>
            <span>{mood.emoji}</span><span style={{ color: T.text3 }}>{mood.label} day ·</span>
            {getFocusAreas(entry).map((f, i) => <span key={i} style={{ color: T.accent }}>{f}</span>)}
          </div>
        )}
        <pre style={{
          background: T.navy0, border: `1px solid ${T.border}`, borderRadius: 8,
          padding: "14px 16px", fontSize: 13, color: T.text1, lineHeight: 1.8,
          whiteSpace: "pre-wrap", fontFamily: "'DM Mono', monospace",
          maxHeight: 320, overflowY: "auto", marginBottom: 16,
        }}>
          {text}
        </pre>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={copy} style={{ minWidth: 160 }}>
            {copied ? "✓ Copied!" : "📋 Copy Standup"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Diary({ onCountChange, user }) {
  const [entries, setEntries]     = useState([]);
  const [prevEntry, setPrevEntry] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [catColReady, setCatColReady] = useState(true);
  const [search, setSearch]       = useState("");
  const [modal, setModal]         = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [standup, setStandup]     = useState(null);
  const [weeklyReport, setWeeklyReport]   = useState(false);
  const [filterMood, setFilterMood]       = useState("");
  const [filterFocus, setFilterFocus]     = useState("");
  const [filterStarred, setFilterStarred] = useState(false);
  const [starredIds, setStarredIds] = useState(new Set());
  const [scratchNotes, setScratchNotes]   = useState(() => loadScratchNotes());

  const toggleStar = (id) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (user?.id) db.from("starred_entries").deleteWhere({ user_id: user.id, entry_id: id });
      } else {
        next.add(id);
        if (user?.id) db.from("starred_entries").insert({ user_id: user.id, entry_id: id });
      }
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    if (!isConfigured()) { setLoading(false); return; }
    probeFocusAreas(); probeIsWin(); probeAttendance();
    probeCategories().then(ok => setCatColReady(ok)); // warm up caches — results ready before user can save
    const d = await db.from("diary_entries").select("*", { order: "date.desc" });
    setEntries(d || []);
    setPrevEntry(d?.[0] || null);
    onCountChange?.(d?.length || 0);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep viewEntry in sync with fresh DB data after every save/auto-save
  useEffect(() => {
    if (!viewEntry?.id) return;
    const fresh = entries.find(e => e.id === viewEntry.id);
    if (fresh) setViewEntry(fresh);
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return;
    db.from("starred_entries").select("entry_id").then(rows => {
      setStarredIds(new Set((rows || []).map(r => r.entry_id)));
    });
    refreshScratchNotes(user.id).then(setScratchNotes);
  }, [user]);

  const save = async (form) => {
    // Auto-extract any JIRA/ticket URLs typed into the content field and merge into jira_links
    const urlsInContent = ((form.content || "").match(/https?:\/\/\S+\/browse\/[A-Z]+-\d+/gi) || []);
    if (urlsInContent.length) {
      const merged = [...new Set([...(form.jira_links || []), ...urlsInContent])];
      form = { ...form, jira_links: merged };
    }
    // Dedup collaborators before saving (case-insensitive, also handles stale JSON-object strings)
    if (form.collaborators?.length) {
      const seen = new Set();
      form = { ...form, collaborators: form.collaborators.map(cleanCollab).filter(v => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }) };
    }
    const doSave = async (data) => {
      if (data.id) {
        const { id, ...rest } = data;
        return db.from("diary_entries").update(rest, id);
      }
      return db.from("diary_entries").insert(data);
    };
    const [hasFocusAreas, hasWin, hasCats, hasAtt] = await Promise.all([probeFocusAreas(), probeIsWin(), probeCategories(), probeAttendance()]);
    let saveData = form;
    if (!hasFocusAreas) { const { focus_areas, ...rest } = saveData; saveData = rest; }
    if (!hasWin) { const { is_win, win_tags, ...rest } = saveData; saveData = rest; }
    if (!hasAtt) { const { team_attendance, ...rest } = saveData; saveData = rest; }
    if (!hasCats) { const { categories, ...rest } = saveData; saveData = rest; }
    const result = await doSave(saveData);
    if (result?.code === "PGRST204") {
      if (result.message?.includes("focus_areas")) { _faSupported = false; const { focus_areas, ...f } = form; await doSave(f); }
      else if (result.message?.includes("is_win") || result.message?.includes("win_tags")) { _winSupported = false; const { is_win, win_tags, ...f } = form; await doSave(f); }
      else if (result.message?.includes("categories")) { _catSupported = false; const { categories, ...f } = form; await doSave(f); }
      else if (result.message?.includes("team_attendance")) { _attSupported = false; const { team_attendance, ...f } = form; await doSave(f); }
    }
    load();
  };

  const del = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    await db.from("diary_entries").delete(id);
    setViewEntry(null);
    load();
  };

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      e.content?.toLowerCase().includes(q) ||
      getFocusAreas(e).some(f => f.toLowerCase().includes(q)) ||
      e.blockers?.toLowerCase().includes(q) ||
      e.tags?.some(t => t.toLowerCase().includes(q)) ||
      e.jira_links?.some(l => l.toLowerCase().includes(q)) ||
      e.collaborators?.some(c => c.toLowerCase().includes(q)) ||
      e.team_updates?.some(u => u.name?.toLowerCase().includes(q) || u.update?.toLowerCase().includes(q)) ||
      e.feedback_given?.some(f => f.to?.toLowerCase().includes(q) || f.note?.toLowerCase().includes(q)) ||
      e.carry_forward?.some(i => i.text?.toLowerCase().includes(q)) ||
      e.reminders?.some(i => i.text?.toLowerCase().includes(q));
    const matchMood    = !filterMood    || e.mood       === filterMood;
    const matchFocus   = !filterFocus   || getFocusAreas(e).includes(filterFocus);
    const matchStarred = !filterStarred || starredIds.has(e.id);
    return matchSearch && matchMood && matchFocus && matchStarred;
  });

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

      {!catColReady && (
        <div style={{ background: `${T.amber}15`, border: `1px solid ${T.amber}40`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: T.amber }}>
          <strong>AI categories won't save yet.</strong> Run this in Supabase SQL editor, then reload:
          <div style={{ marginTop: 6, background: T.navy0, borderRadius: 6, padding: "7px 12px", fontFamily: "monospace", fontSize: 11, color: T.text2, userSelect: "all" }}>
            ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS categories jsonb DEFAULT {'{}'};
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <span style={{ color: T.text3, fontSize: 16 }}>🔍</span>
          <input placeholder="Search notes, tickets, team members, tags…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 145 }} value={filterFocus} onChange={e => setFilterFocus(e.target.value)}>
          <option value="">All focus areas</option>
          {FOCUS_AREAS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="form-select" style={{ width: 135 }} value={filterMood} onChange={e => setFilterMood(e.target.value)}>
          <option value="">All moods</option>
          {MOODS.map(m => <option key={m.key} value={m.key}>{m.emoji} {m.label}</option>)}
        </select>
        <button
          className={`btn ${filterStarred ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setFilterStarred(f => !f)}
          title="Show starred only"
        >⭐ Starred{starredIds.size > 0 && ` (${starredIds.size})`}</button>
        <button className="btn btn-ghost" onClick={() => setWeeklyReport(true)} title="Weekly summary report">
          📊 Week
        </button>
        <button className="btn btn-primary" onClick={() => setModal("new")}>+ New Entry</button>
      </div>

      {loading && <div style={{ color: T.text3, textAlign: "center", padding: 40 }}>Loading entries…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: T.text3 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📓</div>
          <div style={{ fontSize: 16, color: T.text2, marginBottom: 6 }}>{search ? "No entries match your search" : "No diary entries yet"}</div>
          <div style={{ fontSize: 13 }}>{!search && "Start documenting your work day by day."}</div>
          {!search && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setModal("new")}>Log Today</button>}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map(e => {
          const mood = MOODS.find(m => m.key === e.mood);
          const pendingCF = e.carry_forward?.filter(i => !i.done).length || 0;
          const pendingR  = e.reminders?.filter(i => !i.checked).length || 0;
          return (
            <div key={e.id} className="diary-entry" onClick={() => setViewEntry(e)}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div className="date-badge">
                  <div className="date-badge-day">{e.date?.split("-")[2]}</div>
                  <div className="date-badge-mon">{MONTHS[parseInt(e.date?.split("-")[1]) - 1]}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    {getFocusAreas(e).map(f => <span key={f} className="focus-badge">{f}</span>)}
                    {mood && <span title={mood.label} style={{ fontSize: 15 }}>{mood.emoji}</span>}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
                      {e.linked_note && <span className="entry-stat-badge" title={`Linked note: ${e.linked_note.title}`} style={{ color: T.teal, borderColor: "rgba(63,207,180,0.25)" }}>📎</span>}
                      {(e.team_updates?.length || 0) > 0 && (
                        <span className="entry-stat-badge">👥 {e.team_updates.length}</span>
                      )}
                      {pendingCF > 0 && <span className="entry-stat-badge" style={{ color: T.gold, borderColor: "rgba(232,198,106,0.25)" }}>⬆ {pendingCF}</span>}
                      {pendingR  > 0 && <span className="entry-stat-badge" style={{ color: T.coral, borderColor: "rgba(240,117,98,0.25)" }}>🔔 {pendingR}</span>}
                      <button
                        title="Generate standup"
                        className="entry-stat-badge"
                        style={{ cursor: "pointer", background: "rgba(79,142,247,0.07)", borderColor: T.border, color: T.text3, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 5, padding: "2px 7px" }}
                        onClick={ev => { ev.stopPropagation(); setStandup(e); }}
                      >📋</button>
                      <button
                        title={starredIds.has(e.id) ? "Unstar" : "Star this entry"}
                        style={{ cursor: "pointer", background: "transparent", border: "none", fontSize: 15, padding: "0 1px", lineHeight: 1, opacity: starredIds.has(e.id) ? 1 : 0.35 }}
                        onClick={ev => { ev.stopPropagation(); toggleStar(e.id); }}
                      >{starredIds.has(e.id) ? "⭐" : "⭐"}</button>
                    </div>
                  </div>
                  {e.content && (
                    <div style={{ fontSize: 13, color: T.text2, marginBottom: 6, lineHeight: 1.5 }}>
                      {e.content.slice(0, 85)}{e.content.length > 85 ? "…" : ""}
                    </div>
                  )}
                  {e.blockers && (
                    <div style={{ fontSize: 12, color: T.coral, marginBottom: 5 }}>⚠ {e.blockers.slice(0, 60)}{e.blockers.length > 60 ? "…" : ""}</div>
                  )}
                  {e.jira_links?.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
                      {e.jira_links.map(l => l.startsWith("http")
                        ? <a key={l} href={l} target="_blank" rel="noreferrer" className="ticket-chip" style={{ textDecoration: "none" }} onClick={ev => ev.stopPropagation()}>{l.replace(/.*\/browse\//, "")}</a>
                        : <span key={l} className="ticket-chip">{l}</span>
                      )}
                    </div>
                  )}
                  {e.collaborators?.length > 0 && (() => {
                    const uniq = [...new Set((e.collaborators || []).map(cleanCollab).filter(Boolean))];
                    return (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
                        {uniq.slice(0, 4).map(c => <span key={c} className="tag tag-blue">👤 {c}</span>)}
                        {uniq.length > 4 && <span className="tag tag-blue">+{uniq.length - 4}</span>}
                      </div>
                    );
                  })()}
                  {e.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {e.tags.map(t => <span key={t} className="tag tag-teal">{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(modal === "new" || modal?.id) && (
        <DiaryEntryModal
          entry={modal !== "new" ? modal : null}
          previousEntry={modal === "new" ? prevEntry : null}
          onClose={() => setModal(null)}
          onSave={save}
          onAutoSave={save}
          scratchNotes={scratchNotes}
        />
      )}

      {standup && <StandupModal entry={standup} onClose={() => setStandup(null)} />}
      {weeklyReport && <WeeklyReportModal entries={entries} onClose={() => setWeeklyReport(false)} />}

      {viewEntry && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setViewEntry(null)}>
          <div className="modal" style={{ maxWidth: 700 }}>

            {/* Header */}
            <div className="modal-title">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{fmtDate(viewEntry.date)}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {getFocusAreas(viewEntry).map(f => <span key={f} className="focus-badge">{f}</span>)}
                  {viewEntry.mood && (
                    <span style={{ fontSize: 13, color: T.text3 }}>
                      {MOODS.find(m => m.key === viewEntry.mood)?.emoji} {MOODS.find(m => m.key === viewEntry.mood)?.label}
                    </span>
                  )}
                  {(viewEntry.collaborators?.length > 0 || viewEntry.tags?.length > 0) && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[...new Set((viewEntry.collaborators || []).map(cleanCollab).filter(Boolean))].map(c => <span key={c} className="tag tag-blue">👤 {c}</span>)}
                      {viewEntry.tags?.map(t => <span key={t} className="tag tag-teal">{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewEntry(null)}>✕</button>
            </div>

            {/* JIRA Tickets — dedicated section, separate from header */}
            {viewEntry.jira_links?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="diary-section-heading">🎫 JIRA Tickets</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {viewEntry.jira_links.map(l => l.startsWith("http")
                    ? <a key={l} href={l} target="_blank" rel="noreferrer" className="ticket-chip" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        🔗 {l.replace(/.*\/browse\//, "")}
                      </a>
                    : <span key={l} className="ticket-chip">{l}</span>
                  )}
                </div>
              </div>
            )}

            {/* What I Did */}
            {viewEntry.content && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">What I Did</div>
                <div style={{ fontSize: 14, color: T.text2, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{linkify(viewEntry.content)}</div>
              </div>
            )}

            {/* AI Categories breakdown */}
            {viewEntry.categories && Object.values(viewEntry.categories).some(a => (a || []).length > 0) && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">✨ AI Breakdown</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { key: "meeting",    label: "Meetings",   icon: "🤝", color: T.accent },
                    { key: "execution",  label: "Execution",  icon: "⚡", color: T.teal },
                    { key: "validation", label: "Validation", icon: "✅", color: "#4CAF50" },
                    { key: "other",      label: "Other",      icon: "📋", color: T.text2 },
                  ].filter(c => (viewEntry.categories[c.key] || []).length > 0).map(c => (
                    <div key={c.key} style={{ background: `${c.color}10`, border: `1px solid ${c.color}28`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: c.color, marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                        {c.icon} {c.label}
                        <span style={{ fontWeight: 400, color: T.text3 }}>· {(viewEntry.categories[c.key] || []).length}</span>
                      </div>
                      {(viewEntry.categories[c.key] || []).map((item, i) => (
                        <div key={i} style={{ fontSize: 12, color: T.text2, lineHeight: 1.55, marginBottom: 2 }}>• {typeof item === "string" ? item : (item?.text || item?.item || item?.content || JSON.stringify(item))}</div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blockers */}
            {viewEntry.blockers && (
              <div style={{ background: "rgba(240,117,98,0.06)", border: "1px solid rgba(240,117,98,0.2)", borderRadius: 8, padding: "11px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: T.coral, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 5, fontWeight: 600 }}>Blockers</div>
                <div style={{ fontSize: 14, color: T.text2 }}>{viewEntry.blockers}</div>
              </div>
            )}

            {/* Team Progress */}
            {viewEntry.team_updates?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">Team Progress</div>
                {viewEntry.team_updates.map((u, i) => (
                  <div key={i} className="team-card" style={{ borderLeft: `3px solid ${statusColor(u.status)}` }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>👤 {u.name}</span>
                      <span className="status-badge" style={{ background: `${statusColor(u.status)}18`, color: statusColor(u.status), borderColor: `${statusColor(u.status)}40` }}>
                        {TEAM_STATUSES.find(s => s.key === u.status)?.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: T.text2 }}>{u.update}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Feedback Given */}
            {viewEntry.feedback_given?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">Feedback Given</div>
                {viewEntry.feedback_given.map((fb, i) => (
                  <div key={i} className="team-card" style={{ borderLeft: `3px solid ${feedbackColor(fb.type)}` }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>→ {fb.to}</span>
                      <span className="status-badge" style={{ background: `${feedbackColor(fb.type)}18`, color: feedbackColor(fb.type), borderColor: `${feedbackColor(fb.type)}40` }}>
                        {FEEDBACK_TYPES.find(t => t.key === fb.type)?.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: T.text2 }}>{fb.note}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Carry Forward */}
            {viewEntry.carry_forward?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">Carry Forward</div>
                {viewEntry.carry_forward.map((item, i) => (
                  <div key={i} className="checklist-item">
                    <span style={{ fontSize: 14 }}>{item.done ? "✅" : "⬜"}</span>
                    <span style={{ flex: 1, fontSize: 13, color: item.done ? T.text3 : T.text1, textDecoration: item.done ? "line-through" : "none" }}>{item.text}</span>
                    <span className="status-badge" style={{ background: `${priorityColor(item.priority)}18`, color: priorityColor(item.priority), borderColor: `${priorityColor(item.priority)}40` }}>
                      {item.priority}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Reminders */}
            {viewEntry.reminders?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">Reminders & Checks</div>
                {viewEntry.reminders.map((item, i) => (
                  <div key={i} className="checklist-item">
                    <span style={{ fontSize: 14 }}>{item.checked ? "✅" : "🔔"}</span>
                    <span style={{ flex: 1, fontSize: 13, color: item.checked ? T.text3 : T.text1, textDecoration: item.checked ? "line-through" : "none" }}>{item.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Team Attendance */}
            {viewEntry.team_attendance?.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">Team Attendance</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {viewEntry.team_attendance.map((a, i) => {
                    const s = ATT_STATUSES.find(x => x.key === a.status);
                    return (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: `${attColor(a.status)}18`, border: `1px solid ${attColor(a.status)}40`, fontSize: 12, color: attColor(a.status) }}>
                        {s?.icon} {a.name} · {s?.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Linked Note */}
            {viewEntry.linked_note && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">📎 Linked Note</div>
                <div style={{ background: T.navy3, border: `1px solid rgba(63,207,180,0.2)`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.teal, marginBottom: 6 }}>
                    {viewEntry.linked_note.title || "Untitled"}
                    {viewEntry.linked_note.group && <span style={{ fontSize: 11, color: T.text3, fontWeight: 400, marginLeft: 8 }}>[{viewEntry.linked_note.group}]</span>}
                  </div>
                  <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{viewEntry.linked_note.text || <span style={{ color: T.text3 }}>Empty note</span>}</div>
                </div>
              </div>
            )}

            <hr className="divider" style={{ margin: "16px 0 12px" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
              <button className="btn btn-danger btn-sm" onClick={() => del(viewEntry.id)}>Delete</button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportEntryPDF(viewEntry)}>↓ Export PDF</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleStar(viewEntry.id)}>
                {starredIds.has(viewEntry.id) ? "⭐ Starred" : "☆ Star"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setModal(viewEntry); setViewEntry(null); }}>Edit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DigiLocker ───────────────────────────────────────────────────────────────
function UploadModal({ onClose, onSave }) {
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ name: "", category: "", description: "", tags: [] });
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleFile = (f) => {
    setFile(f);
    if (!form.name) set("name", f.name.replace(/\.[^.]+$/, ""));
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) { set("tags", [...form.tags, t]); setTagInput(""); }
  };

  const upload = async () => {
    if (!file || !form.name.trim()) return;
    setUploading(true);
    const path = `${Date.now()}-${file.name}`;
    const uploadRes = await db.storage.upload(path, file);
    if (uploadRes.error) { alert("Upload failed: " + uploadRes.error.message); setUploading(false); return; }
    await db.from("documents").insert({
      name: form.name.trim(),
      category: form.category,
      description: form.description,
      file_path: path,
      file_size: file.size,
      file_type: file.type,
      tags: form.tags,
    });
    setUploading(false);
    onSave();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>Upload Document</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {!file ? (
          <div
            className={`upload-zone ${dragOver ? "drag-over" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>📤</div>
            <div style={{ fontSize: 15, color: T.text1, marginBottom: 6 }}>Drop file here or click to browse</div>
            <div style={{ fontSize: 12, color: T.text3 }}>PDF, Word, Excel, Images, Archives — any file type</div>
            <input ref={inputRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div style={{ background: "rgba(79,142,247,0.07)", border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 24 }}>{fileTypeInfo(file.name).icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: T.text1 }}>{file.name}</div>
              <div style={{ fontSize: 11, color: T.text3 }}>{fmtSize(file.size)}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>✕</button>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Document Name *</label>
          <input type="text" className="form-input" placeholder="e.g. Aadhar Card, Offer Letter…" value={form.name} onChange={e => set("name", e.target.value)} />
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-select" value={form.category} onChange={e => set("category", e.target.value)}>
              <option value="">Select…</option>
              {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Tags</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input type="text" className="form-input" placeholder="Enter tag" value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())} />
              <button className="btn btn-ghost btn-sm" onClick={addTag}>+</button>
            </div>
          </div>
        </div>

        {form.tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {form.tags.map(t => <span key={t} className="tag tag-blue" style={{ cursor: "pointer" }} onClick={() => set("tags", form.tags.filter(x => x !== t))}>{t} ✕</span>)}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-textarea" style={{ minHeight: 70 }} placeholder="Brief note about this document…" value={form.description} onChange={e => set("description", e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={upload} disabled={!file || !form.name.trim() || uploading}>
            {uploading ? "Uploading…" : "Upload Document"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DigiLocker({ onCountChange }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [viewDoc, setViewDoc] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (!isConfigured()) { setLoading(false); return; }
    const d = await db.from("documents").select("*", { order: "created_at.desc" });
    setDocs(d || []);
    onCountChange?.(d?.length || 0);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    await db.storage.remove([doc.file_path]);
    await db.from("documents").delete(doc.id);
    setViewDoc(null);
    load();
  };

  const filtered = docs.filter(d => {
    const q = search.toLowerCase();
    const matchSearch = !q || d.name?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q) || d.tags?.some(t => t.includes(q));
    const matchCat = !filterCat || d.category === filterCat;
    return matchSearch && matchCat;
  });

  const categories = [...new Set(docs.map(d => d.category).filter(Boolean))];

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 220 }}>
          <span style={{ color: T.text3 }}>🔍</span>
          <input placeholder="Search documents, tags, categories…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 150 }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}>+ Upload</button>
      </div>

      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
          {["All", ...categories].map(c => (
            <button key={c} className="btn btn-ghost btn-sm" style={filterCat === (c === "All" ? "" : c) ? { borderColor: T.accent, color: T.accent } : {}}
              onClick={() => setFilterCat(c === "All" ? "" : c)}>{c}</button>
          ))}
        </div>
      )}

      {loading && <div style={{ color: T.text3, textAlign: "center", padding: 40 }}>Loading documents…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: T.text3 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
          <div style={{ fontSize: 16, color: T.text2, marginBottom: 6 }}>{search ? "No documents match" : "DigiLocker is empty"}</div>
          <div style={{ fontSize: 13 }}>{!search && "Upload your important documents for secure, easy retrieval."}</div>
          {!search && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowUpload(true)}>Upload First Document</button>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
        {filtered.map(d => {
          const fi = fileTypeInfo(d.name, d.file_type);
          return (
            <div key={d.id} className="doc-card" onClick={() => setViewDoc(d)}>
              <div className={`doc-icon ${fi.cls}`}>{fi.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: T.text1, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
              {d.category && <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>{d.category}</div>}
              <div style={{ fontSize: 11, color: T.text3 }}>{fmtSize(d.file_size)}</div>
              {d.tags?.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                  {d.tags.slice(0, 2).map(t => <span key={t} className="tag tag-teal" style={{ fontSize: 10 }}>{t}</span>)}
                  {d.tags.length > 2 && <span className="tag tag-teal" style={{ fontSize: 10 }}>+{d.tags.length - 2}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onSave={load} />}

      {viewDoc && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setViewDoc(null)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-title">
              <span>Document Details</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewDoc(null)}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
              <div className={`doc-icon ${fileTypeInfo(viewDoc.name, viewDoc.file_type).cls}`} style={{ width: 56, height: 56, borderRadius: 12, fontSize: 26 }}>
                {fileTypeInfo(viewDoc.name, viewDoc.file_type).icon}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600, color: T.text1 }}>{viewDoc.name}</div>
                {viewDoc.category && <span className="tag tag-blue" style={{ marginTop: 4, display: "inline-flex" }}>{viewDoc.category}</span>}
              </div>
            </div>

            {[
              ["File Type", fileTypeInfo(viewDoc.name).label],
              ["File Size", fmtSize(viewDoc.file_size)],
              ["Uploaded", viewDoc.created_at ? new Date(viewDoc.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${T.border}`, fontSize: 14 }}>
                <span style={{ color: T.text3 }}>{k}</span>
                <span style={{ color: T.text1 }}>{v}</span>
              </div>
            ))}

            {viewDoc.description && (
              <div style={{ marginTop: 14, fontSize: 13, color: T.text2, lineHeight: 1.6 }}>{viewDoc.description}</div>
            )}

            {viewDoc.tags?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                {viewDoc.tags.map(t => <span key={t} className="tag tag-teal">{t}</span>)}
              </div>
            )}

            <hr className="divider" />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-danger btn-sm" onClick={() => del(viewDoc)}>Delete</button>
              <a href={db.storage.getPublicUrl(viewDoc.file_path)} target="_blank" rel="noopener noreferrer">
                <button className="btn btn-primary btn-sm">Open / Download ↗</button>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [tab, setTab]       = useState("login");
  const [email, setEmail]   = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  const switchTab = (t) => { setTab(t); setMessage({ text: "", type: "" }); };

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      setMessage({ text: "Email and password are required.", type: "error" });
      return;
    }
    setLoading(true);
    setMessage({ text: "", type: "" });
    const data = tab === "login"
      ? await db.auth.signIn(email.trim(), password)
      : await db.auth.signUp(email.trim(), password);
    setLoading(false);
    if (data.access_token) {
      localStorage.setItem("echo_token", data.access_token);
      if (data.refresh_token) localStorage.setItem("echo_refresh_token", data.refresh_token);
      onLogin(data.user);
    } else if (tab === "signup" && data.id && !data.access_token) {
      setMessage({ text: "Account created! Check your email to confirm, then sign in.", type: "info" });
      switchTab("login");
    } else {
      setMessage({ text: data.error_description || data.msg || data.message || data.error || "Authentication failed.", type: "error" });
    }
  };

  const FEATURES = [
    { icon: "📓", bg: `${T.accent}20`, title: "Corporate Diary", sub: "Log work, mood, JIRAs & blockers daily" },
    { icon: "🗂️", bg: `${T.teal}18`,  title: "DigiLocker",      sub: "Secure document storage & retrieval" },
    { icon: "📈", bg: `${T.gold}18`,   title: "Analytics",       sub: "Mood trends, focus area insights" },
    { icon: "📝", bg: `${T.coral}18`,  title: "Scratch Pad",     sub: "Quick notes, always a click away" },
  ];

  return (
    <div className="auth-root">

      {/* ── Left: Brand panel ── */}
      <div className="auth-brand">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="auth-brand-logo">
            <EchoLogo size={64} withText dark />
          </div>
          <div className="auth-brand-tagline">
            Your work, beautifully organised.<br />
            <span style={{ color: T.text3, fontSize: 14 }}>A private workspace built for professionals.</span>
          </div>

          {FEATURES.map((f, i) => (
            <div key={f.title} className="auth-feature" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="auth-feature-icon" style={{ background: f.bg }}>{f.icon}</div>
              <div>
                <div className="auth-feature-title">{f.title}</div>
                <div className="auth-feature-sub">{f.sub}</div>
              </div>
            </div>
          ))}

          <div className="auth-brand-footer">
            Built with Supabase · React · No data leaves your account.
          </div>
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="auth-form-panel">
        <div className="auth-form-inner">

          {/* Mobile-only logo */}
          <div style={{ display: "none", textAlign: "center", marginBottom: 28, justifyContent: "center" }} className="auth-mobile-logo">
            <EchoLogo size={36} withText dark />
          </div>

          <div className="auth-form-heading">
            {tab === "login" ? "Welcome back" : "Create your account"}
          </div>
          <div className="auth-form-sub">
            {tab === "login"
              ? "Sign in to access your workspace"
              : "Set up Echo in under a minute"}
          </div>

          {/* Tabs */}
          <div className="auth-tabs">
            <button className={`auth-tab ${tab === "login" ? "active" : ""}`} onClick={() => switchTab("login")}>Sign In</button>
            <button className={`auth-tab ${tab === "signup" ? "active" : ""}`} onClick={() => switchTab("signup")}>Create Account</button>
          </div>

          {/* Email */}
          <div className="auth-field">
            <label className="auth-label">Email address</label>
            <input
              type="email" className="auth-input"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div className="auth-field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
              <label className="auth-label" style={{ margin: 0 }}>Password</label>
            </div>
            <div className="auth-input-wrap">
              <input
                type={showPw ? "text" : "password"} className="auth-input"
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()}
                placeholder="••••••••"
                style={{ paddingRight: 42 }}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
              />
              <button className="auth-eye" onClick={() => setShowPw(s => !s)} tabIndex={-1} title={showPw ? "Hide password" : "Show password"}>
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Message */}
          {message.text && (
            <div className={`auth-msg ${message.type}`}>{message.text}</div>
          )}

          {/* Submit */}
          <button className="auth-btn" onClick={submit} disabled={loading}>
            {loading
              ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "authSpinDot 0.7s linear infinite" }} />
                  Please wait…
                </span>
              : tab === "login" ? "Sign In →" : "Create Account →"
            }
          </button>

          <div className="auth-switch">
            {tab === "login"
              ? <>Don't have an account? <span onClick={() => switchTab("signup")}>Create one</span></>
              : <>Already have an account? <span onClick={() => switchTab("login")}>Sign in</span></>
            }
          </div>

          {tab === "signup" && (
            <div style={{ marginTop: 16, fontSize: 11, color: T.text3, lineHeight: 1.6, textAlign: "center" }}>
              Email confirmation may be required by Supabase.<br />
              Your data is private and stored in your own Supabase project.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pattern Interrupt ───────────────────────────────────────────────────────
function PatternInterrupt({ onDismiss, user }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (user?.id && text.trim()) {
      await db.from("pattern_interrupts").insert({ user_id: user.id, text, created_at: new Date().toISOString() });
    }
    setSaved(true);
    setTimeout(onDismiss, 900);
  };

  return (
    <div className="pi-backdrop">
      <div className="pi-card">
        <div style={{ fontSize: 32, marginBottom: 10 }}>🌊</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.text1, fontFamily: "'Syne', sans-serif", marginBottom: 8 }}>Take a breath.</div>
        <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.65, marginBottom: 6 }}>
          You've logged <span style={{ color: T.coral, fontWeight: 600 }}>frustrated</span> or <span style={{ color: T.gold, fontWeight: 600 }}>challenged</span> for 3 or more days in a row.
        </div>
        <div style={{ fontSize: 12, color: T.text3, marginBottom: 22 }}>This is a private space. No format, no judgement. Just write.</div>
        <textarea
          className="form-textarea"
          rows={5}
          placeholder="What's really going on?"
          value={text}
          onChange={e => setText(e.target.value)}
          autoFocus
          style={{ resize: "none", lineHeight: 1.7, marginBottom: 16 }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={save} disabled={saved}>{saved ? "✓ Saved" : "Save & Close"}</button>
          <button className="btn btn-ghost" onClick={onDismiss}>Dismiss</button>
          <span style={{ marginLeft: "auto", fontSize: 11, color: T.text3 }}>🔒 Private — never exported</span>
        </div>
      </div>
    </div>
  );
}

// ─── Shadow Resume ────────────────────────────────────────────────────────────
function ShadowResume() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    db.from("diary_entries").select("*", { order: "date.asc" }).then(d => {
      setEntries(d || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ color: T.text3, textAlign: "center", padding: 60 }}>Building profile…</div>;

  if (entries.length < 2) return (
    <div className="echo-content fade-in" style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 14 }}>📋</div>
      <div style={{ fontSize: 15, color: T.text2, marginBottom: 8 }}>Not enough data yet</div>
      <div style={{ fontSize: 13, color: T.text3 }}>Log a few diary entries — Echo will auto-build your work profile from them.</div>
    </div>
  );

  const allFocusAreas = {}, allCollabs = {}, allTags = {}, allJiras = new Set();
  entries.forEach(e => {
    getFocusAreas(e).forEach(f => { allFocusAreas[f] = (allFocusAreas[f] || 0) + 1; });
    (e.tags || []).forEach(t => { if (t.trim()) allTags[t.trim()] = (allTags[t.trim()] || 0) + 1; });
    (e.collaborators || []).forEach(c => { if (c.trim()) allCollabs[c.trim()] = (allCollabs[c.trim()] || 0) + 1; });
    (e.jira_links || []).forEach(j => { if (j.trim()) allJiras.add(j.trim()); });
  });

  const topFocus   = Object.entries(allFocusAreas).sort((a,b) => b[1]-a[1]);
  const topCollabs = Object.entries(allCollabs).sort((a,b) => b[1]-a[1]).slice(0, 12);
  const topTags    = Object.entries(allTags).sort((a,b) => b[1]-a[1]).slice(0, 24);
  const maxFA      = topFocus[0]?.[1] || 1;
  const faPalette  = [T.accent, T.teal, T.gold, T.coral, T.green, "#a78bfa", "#fb923c", "#38bdf8"];
  const moodPal    = { productive: T.green, resolved: T.teal, collaborative: T.accent, challenged: T.gold, frustrated: T.coral };

  const byMonth = {};
  entries.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { count: 0, focuses: new Set(), collabs: new Set(), moods: {} };
    byMonth[m].count++;
    getFocusAreas(e).forEach(f => byMonth[m].focuses.add(f));
    (e.collaborators || []).forEach(c => { if (c.trim()) byMonth[m].collabs.add(c.trim()); });
    if (e.mood) byMonth[m].moods[e.mood] = (byMonth[m].moods[e.mood] || 0) + 1;
  });
  const months = Object.entries(byMonth).sort((a,b) => a[0].localeCompare(b[0]));
  const dateRange = `${fmtDate(entries[0].date)} — ${fmtDate(entries[entries.length-1].date)}`;
  const numMonths = months.length;

  // Auto-generate a headline summary
  const top3Focus = topFocus.slice(0, 3).map(([f]) => f);
  const topCollab = topCollabs[0]?.[0];
  const summary = [
    `${entries.length} diary entries across ${numMonths} month${numMonths !== 1 ? "s" : ""}`,
    top3Focus.length ? `primarily focused on ${top3Focus.join(", ")}` : null,
    topCollab ? `most frequently collaborated with ${topCollab}` : null,
    allJiras.size ? `${allJiras.size} JIRA tickets referenced` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="echo-content fade-in">
      {/* ── Profile Header ── */}
      <div className="card" style={{ marginBottom: 16, background: `linear-gradient(135deg, ${T.navy2} 0%, ${T.navy3} 100%)`, border: `1px solid ${T.borderHover}`, position: "relative", overflow: "hidden" }}>
        {/* Decorative accent bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${T.accent}, ${T.teal}, ${T.gold})` }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: `linear-gradient(135deg, ${T.accent}, ${T.teal})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>👤</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.text1, fontFamily: "'Syne', sans-serif", lineHeight: 1.1 }}>Work Activity Profile</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{dateRange}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.6, padding: "8px 12px", background: `rgba(255,255,255,0.03)`, borderRadius: 8, border: `1px solid ${T.border}` }}>
              {summary}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()} style={{ marginLeft: 14, flexShrink: 0 }}>⬇ Export PDF</button>
        </div>

        {/* Stats strip */}
        <div style={{ display: "flex", gap: 0, marginTop: 18, borderTop: `1px solid ${T.border}`, paddingTop: 16, flexWrap: "wrap" }}>
          {[
            { l: "Entries", v: entries.length, c: T.accent },
            { l: "Focus Areas", v: topFocus.length, c: T.teal },
            { l: "Collaborators", v: Object.keys(allCollabs).length, c: T.gold },
            { l: "JIRA Tickets", v: allJiras.size, c: T.coral },
            { l: "Skills Tagged", v: Object.keys(allTags).length, c: T.green },
          ].map((s, i, arr) => (
            <div key={s.l} style={{ flex: 1, minWidth: 70, paddingRight: 16, borderRight: i < arr.length-1 ? `1px solid ${T.border}` : "none", marginRight: i < arr.length-1 ? 16 : 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.c, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 9, color: T.text3, marginTop: 5, letterSpacing: 1, textTransform: "uppercase" }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Focus Areas ── */}
      {topFocus.length > 0 && (
        <div className="card resume-section" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 14 }}>🎯 Where I Spent My Time</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {topFocus.map(([fa, count], i) => {
              const col = faPalette[i % faPalette.length];
              const pct = Math.round((count / maxFA) * 100);
              return (
                <div key={fa}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: T.text1, fontWeight: i < 3 ? 600 : 400 }}>{fa}</span>
                    <span style={{ fontSize: 10, color: col, fontFamily: "'DM Mono', monospace" }}>{count}d</span>
                  </div>
                  <div style={{ height: 5, background: T.navy3, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: `linear-gradient(90deg, ${col}80, ${col})`, transition: "width 0.6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Collaborators ── */}
      {topCollabs.length > 0 && (
        <div className="card resume-section" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 14 }}>🤝 Collaboration Network</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
            {topCollabs.map(([name, count], i) => {
              const col = faPalette[i % faPalette.length];
              const barW = Math.max(20, Math.round((count / (topCollabs[0]?.[1] || 1)) * 100));
              return (
                <div key={name} style={{ background: T.navy3, borderRadius: 10, padding: "10px 12px", border: `1px solid ${T.border}`, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", bottom: 0, left: 0, width: `${barW}%`, height: 2, background: col, opacity: 0.5 }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: `${col}18`, border: `1px solid ${col}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: col, flexShrink: 0 }}>
                      {initials(name)}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                  </div>
                  <div style={{ fontSize: 10, color: T.text3 }}>{count} entr{count === 1 ? "y" : "ies"} together</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Timeline ── */}
      {months.length > 0 && (
        <div className="card resume-section" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 16 }}>📅 Monthly Timeline</div>
          <div style={{ position: "relative" }}>
            {/* Vertical spine */}
            <div style={{ position: "absolute", left: 52, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, ${T.accent}40, ${T.teal}20)`, borderRadius: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {months.map(([m, data], i) => {
                const [yr, mo] = m.split("-");
                const label = new Date(Number(yr), Number(mo)-1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
                const topMood = Object.entries(data.moods).sort((a,b) => b[1]-a[1])[0]?.[0];
                const isLast = i === months.length - 1;
                return (
                  <div key={m} style={{ display: "flex", gap: 0, paddingBottom: isLast ? 0 : 16, position: "relative" }}>
                    {/* Month label */}
                    <div style={{ width: 52, flexShrink: 0, textAlign: "right", paddingRight: 14, paddingTop: 2 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.text2, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{label}</div>
                      <div style={{ fontSize: 9, color: T.text3, marginTop: 3 }}>{data.count}d</div>
                    </div>
                    {/* Dot on spine */}
                    <div style={{ position: "absolute", left: 48, top: 4, width: 8, height: 8, borderRadius: "50%", background: i === months.length - 1 ? T.teal : T.accent, border: `2px solid ${T.navy2}`, zIndex: 1 }} />
                    {/* Content */}
                    <div style={{ flex: 1, paddingLeft: 20 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: (data.collabs.size > 0 || topMood) ? 5 : 0 }}>
                        {[...data.focuses].slice(0, 4).map(fa => (
                          <span key={fa} style={{ fontSize: 10, padding: "2px 8px", background: `${T.accent}14`, color: T.accent, borderRadius: 20, border: `1px solid ${T.accent}22` }}>{fa}</span>
                        ))}
                        {[...data.focuses].length > 4 && <span style={{ fontSize: 10, color: T.text3, padding: "2px 6px" }}>+{[...data.focuses].length - 4}</span>}
                        {topMood && <span style={{ fontSize: 10, padding: "2px 8px", background: `${moodPal[topMood] || T.text3}14`, color: moodPal[topMood] || T.text3, borderRadius: 20, border: `1px solid ${(moodPal[topMood] || T.text3)}22` }}>{topMood}</span>}
                      </div>
                      {data.collabs.size > 0 && <div style={{ fontSize: 10, color: T.text3 }}>w/ {[...data.collabs].slice(0, 3).join(", ")}{data.collabs.size > 3 ? ` +${data.collabs.size - 3}` : ""}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Skills & Tickets ── */}
      {(topTags.length > 0 || allJiras.size > 0) && (
        <div className="card resume-section">
          {topTags.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 12 }}>🏷️ Skills & Domains</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: allJiras.size > 0 ? 20 : 0 }}>
                {topTags.map(([tag, count], i) => {
                  const col = faPalette[i % faPalette.length];
                  const sz = i < 3 ? 14 : i < 8 ? 12.5 : 11.5;
                  return (
                    <span key={tag} style={{ fontSize: sz, padding: "4px 11px", background: `${col}10`, color: col, borderRadius: 20, border: `1px solid ${col}25`, fontWeight: count > 2 ? 600 : 400 }}>
                      {tag}{count > 1 ? <span style={{ fontSize: 9, opacity: 0.55, marginLeft: 4 }}>×{count}</span> : null}
                    </span>
                  );
                })}
              </div>
            </>
          )}
          {allJiras.size > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 10, paddingTop: topTags.length > 0 ? 16 : 0, borderTop: topTags.length > 0 ? `1px solid ${T.border}` : "none" }}>🎫 JIRA Tickets Referenced ({allJiras.size})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {[...allJiras].slice(0, 30).map(j => (
                  <span key={j} style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", padding: "3px 8px", background: `${T.gold}0d`, color: T.gold, borderRadius: 6, border: `1px solid ${T.gold}22` }}>{j}</span>
                ))}
                {allJiras.size > 30 && <span style={{ fontSize: 11, color: T.text3, padding: "3px 6px" }}>+{allJiras.size - 30} more</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Work Map ─────────────────────────────────────────────────────────────────
function WorkMap() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    db.from("diary_entries").select("*", { order: "date.desc" }).then(d => {
      setEntries(d || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ color: T.text3, textAlign: "center", padding: 60 }}>Building work map…</div>;

  // ── Layout constants
  const SVG_W = 960, SVG_H = 560;
  const YOU_X = 108, YOU_Y = SVG_H / 2, YOU_R = 52;
  const FA_X = 370, FA_HW = 94, FA_HH = 34;
  const COL_CX = 658; // circle centre x for collaborators
  const NODE_R = 20;
  const faPalette = [T.accent, T.teal, T.gold, T.coral, "#a78bfa", "#38bdf8", "#fb923c", "#4ade80"];

  // ── Data processing
  const focusCounts = {};
  entries.forEach(e => { getFocusAreas(e).forEach(f => { focusCounts[f] = (focusCounts[f] || 0) + 1; }); });
  const focusAreas = Object.entries(focusCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const collabMap = {};
  entries.forEach(e => {
    (e.collaborators || []).forEach(c => {
      const name = (c || "").trim();
      if (!name) return;
      if (!collabMap[name]) collabMap[name] = { name, focusMap: {}, count: 0 };
      collabMap[name].count++;
      getFocusAreas(e).forEach(f => { collabMap[name].focusMap[f] = (collabMap[name].focusMap[f] || 0) + 1; });
    });
  });
  const collabs = Object.values(collabMap).sort((a, b) => b.count - a.count).slice(0, 12).map(c => ({
    ...c, primaryFocus: Object.entries(c.focusMap).sort((a, b) => b[1] - a[1])[0]?.[0] || focusAreas[0]?.[0],
  }));

  // ── Focus nodes
  const faLen = focusAreas.length;
  const focusNodes = focusAreas.map(([fa, count], i) => {
    const y = faLen <= 1 ? SVG_H / 2 : 110 + i * (SVG_H - 220) / (faLen - 1);
    return { id: `fa:${fa}`, label: fa, count, x: FA_X, y, color: faPalette[i % faPalette.length], type: "focus" };
  });

  // ── Person nodes — dynamic spacing, never overlap
  const pcLen = Math.min(collabs.length, 12);
  const colSpacing = Math.min(50, Math.max(36, (SVG_H - 80) / Math.max(pcLen, 1)));
  const totalColH = (pcLen - 1) * colSpacing;
  const colStartY = SVG_H / 2 - totalColH / 2;

  const personNodes = collabs.slice(0, 12).map((c, i) => {
    const fn = focusNodes.find(f => f.label === c.primaryFocus) || focusNodes[0];
    if (!fn) return null;
    return {
      id: `p:${c.name}`, label: c.name, count: c.count, r: NODE_R,
      x: COL_CX, y: colStartY + i * colSpacing,
      primaryFocus: c.primaryFocus, fpColor: fn.color, type: "person",
    };
  }).filter(Boolean);

  // ── Interaction helpers
  const active = selected || hovered;

  const isNodeLit = (nid) => {
    if (!active) return true;
    if (nid === active || active === "me") return true;
    if (active.startsWith("fa:")) {
      if (nid === "me") return true;
      const fa = active.slice(3);
      const pn = personNodes.find(p => p.id === nid);
      return !!(pn && pn.primaryFocus === fa);
    }
    if (active.startsWith("p:")) {
      const pn = personNodes.find(p => p.id === active);
      if (!pn) return false;
      return nid === "me" || nid === `fa:${pn.primaryFocus}`;
    }
    return false;
  };

  const isEdgeLit = (srcId, tgtId) => {
    if (!active) return true;
    if (active === "me") return true;
    if (active === srcId || active === tgtId) return true;
    if (active.startsWith("p:")) {
      const pn = personNodes.find(p => p.id === active);
      if (pn && tgtId === active && srcId === `fa:${pn.primaryFocus}`) return true;
    }
    return false;
  };

  // ── Stats
  const totalJiras = [...new Set(entries.flatMap(e => e.jira_links || []))].length;
  const topFocus = focusAreas[0]?.[0];
  const topCollab = collabs[0]?.name;

  // ── Tooltip data
  const getTooltip = () => {
    if (!active) return null;
    if (active === "me") return { title: "You", sub: `${entries.length} diary entries · ${focusNodes.length} focus areas`, color: T.accent };
    if (active.startsWith("fa:")) {
      const fn = focusNodes.find(n => n.id === active);
      if (!fn) return null;
      const cnt = personNodes.filter(p => p.primaryFocus === fn.label).length;
      return { title: fn.label, sub: `${fn.count} day${fn.count !== 1 ? "s" : ""} active · ${cnt} collaborator${cnt !== 1 ? "s" : ""}`, color: fn.color };
    }
    if (active.startsWith("p:")) {
      const pn = personNodes.find(n => n.id === active);
      if (!pn) return null;
      return { title: pn.label, sub: `Collaborated ${pn.count} time${pn.count !== 1 ? "s" : ""} · via ${pn.primaryFocus}`, color: pn.fpColor };
    }
    return null;
  };
  const tooltip = getTooltip();

  return (
    <div className="echo-content fade-in">
      {/* ── Stats strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Focus Areas",   value: focusNodes.length,  color: T.accent, icon: "🎯" },
          { label: "Collaborators", value: personNodes.length, color: T.teal,   icon: "🤝" },
          { label: "JIRA Tickets",  value: totalJiras,         color: T.gold,   icon: "🎫" },
          { label: "Diary Entries", value: entries.length,     color: T.text2,  icon: "📓" },
        ].map(s => (
          <div key={s.label} className="card" style={{ flex: 1, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Syne',sans-serif", lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 3, letterSpacing: 0.5, textTransform: "uppercase" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {focusNodes.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "70px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🕸️</div>
          <div style={{ fontSize: 15, color: T.text2, marginBottom: 8 }}>No connections yet</div>
          <div style={{ fontSize: 13, color: T.text3 }}>Log diary entries with focus areas and collaborators — your work map will build itself.</div>
        </div>
      ) : (
        <>
          {/* ── Insight bar */}
          {(topFocus || topCollab) && (
            <div style={{ background: `${T.accent}0d`, border: `1px solid ${T.accent}1a`, borderRadius: 10, padding: "10px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              {topFocus  && <span style={{ fontSize: 12, color: T.text2 }}>Most active in <strong style={{ color: T.accent }}>{topFocus}</strong></span>}
              {topCollab && <span style={{ fontSize: 12, color: T.text2 }}>Top collaborator <strong style={{ color: T.teal }}>{topCollab}</strong></span>}
              <span style={{ fontSize: 11, color: T.text3, marginLeft: "auto" }}>Click any node to pin · hover to explore</span>
            </div>
          )}

          <div style={{ position: "relative" }}>
            <div className="card" style={{ padding: 0, overflow: "hidden", background: T.navy0 }}
              onClick={e => { if (e.target.tagName === "svg" || e.target === e.currentTarget) setSelected(null); }}>
              <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: "100%", display: "block" }}>
                <defs>
                  <radialGradient id="wm-you-bg" cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor={T.accent} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={T.accent} stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="wm-you-fill" cx="40%" cy="35%" r="60%">
                    <stop offset="0%"   stopColor="#1e1b36" />
                    <stop offset="100%" stopColor={T.navy0} />
                  </radialGradient>
                  <filter id="wm-glow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="wm-glow-sm" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="wm-glow-xs" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>

                {/* Subtle grid */}
                {[1,2,3,4,5,6,7].map(i => (
                  <line key={`vg${i}`} x1={i*SVG_W/8} y1={0} x2={i*SVG_W/8} y2={SVG_H} stroke="rgba(255,255,255,0.018)" strokeWidth="1" />
                ))}
                {[1,2,3,4,5].map(i => (
                  <line key={`hg${i}`} x1={0} y1={i*SVG_H/6} x2={SVG_W} y2={i*SVG_H/6} stroke="rgba(255,255,255,0.018)" strokeWidth="1" />
                ))}

                {/* Column labels */}
                <text x={YOU_X} y={26} textAnchor="middle" fill="rgba(255,255,255,0.14)" fontSize="8" fontFamily="'DM Sans',sans-serif" fontWeight="700" letterSpacing="2.5">YOU</text>
                <text x={FA_X} y={26} textAnchor="middle" fill="rgba(255,255,255,0.14)" fontSize="8" fontFamily="'DM Sans',sans-serif" fontWeight="700" letterSpacing="2.5">FOCUS AREAS</text>
                {personNodes.length > 0 && <text x={COL_CX + 86} y={26} textAnchor="middle" fill="rgba(255,255,255,0.14)" fontSize="8" fontFamily="'DM Sans',sans-serif" fontWeight="700" letterSpacing="2.5">COLLABORATORS</text>}

                {/* Dashed section dividers */}
                <line x1={(YOU_X + FA_X) / 2} y1={36} x2={(YOU_X + FA_X) / 2} y2={SVG_H - 10} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 7" />
                {personNodes.length > 0 && (
                  <line x1={FA_X + FA_HW + 62} y1={36} x2={FA_X + FA_HW + 62} y2={SVG_H - 10} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 7" />
                )}

                {/* ── Edges: YOU → Focus Areas */}
                {focusNodes.map(fn => {
                  const x1 = YOU_X + YOU_R, y1 = YOU_Y;
                  const x2 = FA_X - FA_HW, y2 = fn.y;
                  const cpx = (x1 + x2) / 2;
                  const lit = isEdgeLit("me", fn.id);
                  return (
                    <path key={`ef-${fn.id}`}
                      d={`M ${x1} ${y1} C ${cpx} ${y1} ${cpx} ${y2} ${x2} ${y2}`}
                      fill="none" stroke={fn.color}
                      strokeWidth={lit ? 2.4 : 0.6}
                      strokeOpacity={lit ? 0.55 : 0.07}
                      style={{ transition: "all 0.25s ease", pointerEvents: "none" }} />
                  );
                })}

                {/* ── Edges: Focus Areas → Collaborators */}
                {personNodes.map(pn => {
                  const fn = focusNodes.find(f => f.label === pn.primaryFocus);
                  if (!fn) return null;
                  const x1 = FA_X + FA_HW, y1 = fn.y;
                  const x2 = COL_CX - pn.r, y2 = pn.y;
                  const cpx = x1 + (x2 - x1) * 0.58;
                  const lit = isEdgeLit(fn.id, pn.id);
                  return (
                    <path key={`ep-${pn.id}`}
                      d={`M ${x1} ${y1} C ${cpx} ${y1} ${cpx} ${y2} ${x2} ${y2}`}
                      fill="none" stroke={fn.color}
                      strokeWidth={lit ? 1.8 : 0.5}
                      strokeOpacity={lit ? 0.45 : 0.06}
                      style={{ transition: "all 0.25s ease", pointerEvents: "none" }} />
                  );
                })}

                {/* ── Focus area pills */}
                {focusNodes.map(fn => {
                  const lit = isNodeLit(fn.id);
                  const isAct = active === fn.id;
                  const lbl = fn.label.length > 19 ? fn.label.slice(0, 18) + "…" : fn.label;
                  return (
                    <g key={fn.id} style={{ cursor: "pointer" }}
                      onMouseEnter={() => { if (!selected) setHovered(fn.id); }}
                      onMouseLeave={() => { if (!selected) setHovered(null); }}
                      onClick={e => { e.stopPropagation(); setSelected(selected === fn.id ? null : fn.id); setHovered(null); }}>
                      {/* outer glow halo */}
                      <rect x={FA_X - FA_HW - 16} y={fn.y - FA_HH - 16} width={(FA_HW + 16) * 2} height={(FA_HH + 16) * 2}
                        rx={FA_HH + 16} fill={fn.color}
                        opacity={isAct ? 0.1 : lit ? 0.04 : 0}
                        style={{ transition: "opacity 0.2s" }} />
                      {/* pill body */}
                      <rect x={FA_X - FA_HW} y={fn.y - FA_HH} width={FA_HW * 2} height={FA_HH * 2}
                        rx={FA_HH}
                        fill={`${fn.color}12`}
                        stroke={fn.color}
                        strokeWidth={isAct ? 2.5 : 1.6}
                        opacity={lit ? 1 : 0.13}
                        filter={isAct ? "url(#wm-glow-xs)" : "none"}
                        style={{ transition: "all 0.22s" }} />
                      {/* label */}
                      <text x={FA_X} y={fn.y - 5} textAnchor="middle"
                        fill={fn.color} fontSize="12" fontWeight="700" fontFamily="'DM Sans',sans-serif"
                        opacity={lit ? 1 : 0.13}
                        style={{ transition: "opacity 0.2s", userSelect: "none", pointerEvents: "none" }}>
                        {lbl}
                      </text>
                      {/* day count */}
                      <text x={FA_X} y={fn.y + 12} textAnchor="middle"
                        fill={fn.color} fontSize="9.5" fontFamily="'DM Mono',monospace"
                        opacity={lit ? 0.52 : 0.08}
                        style={{ transition: "opacity 0.2s", userSelect: "none", pointerEvents: "none" }}>
                        {fn.count} day{fn.count !== 1 ? "s" : ""}
                      </text>
                    </g>
                  );
                })}

                {/* ── Collaborator nodes — circle + name label to the right */}
                {personNodes.map(pn => {
                  const lit = isNodeLit(pn.id);
                  const isAct = active === pn.id;
                  const nameLbl = pn.label.length > 16 ? pn.label.slice(0, 15) + "…" : pn.label;
                  return (
                    <g key={pn.id} style={{ cursor: "pointer" }}
                      onMouseEnter={() => { if (!selected) setHovered(pn.id); }}
                      onMouseLeave={() => { if (!selected) setHovered(null); }}
                      onClick={e => { e.stopPropagation(); setSelected(selected === pn.id ? null : pn.id); setHovered(null); }}>
                      {/* halo */}
                      <circle cx={pn.x} cy={pn.y} r={pn.r + 11} fill={pn.fpColor}
                        opacity={isAct ? 0.13 : 0} style={{ transition: "opacity 0.2s" }} />
                      {/* circle */}
                      <circle cx={pn.x} cy={pn.y} r={pn.r}
                        fill={`${pn.fpColor}16`} stroke={pn.fpColor}
                        strokeWidth={isAct ? 2.5 : 1.6}
                        strokeOpacity={lit ? 1 : 0.13}
                        fillOpacity={lit ? 1 : 0.08}
                        filter={isAct ? "url(#wm-glow-xs)" : "none"}
                        style={{ transition: "all 0.22s" }} />
                      {/* initials */}
                      <text x={pn.x} y={pn.y + 1} textAnchor="middle" dominantBaseline="middle"
                        fill={pn.fpColor} fontSize="9.5" fontWeight="800" fontFamily="'DM Sans',sans-serif"
                        opacity={lit ? 1 : 0.13}
                        style={{ userSelect: "none", pointerEvents: "none", transition: "opacity 0.2s" }}>
                        {initials(pn.label)}
                      </text>
                      {/* full name — to the right of circle */}
                      <text x={pn.x + pn.r + 9} y={pn.y - 3} textAnchor="start"
                        fill={T.text1} fontSize="12" fontWeight={isAct ? "700" : "500"} fontFamily="'DM Sans',sans-serif"
                        opacity={lit ? (isAct ? 1 : 0.85) : 0.13}
                        style={{ userSelect: "none", pointerEvents: "none", transition: "all 0.2s" }}>
                        {nameLbl}
                      </text>
                      {/* interaction count */}
                      <text x={pn.x + pn.r + 9} y={pn.y + 12} textAnchor="start"
                        fill={pn.fpColor} fontSize="9" fontFamily="'DM Mono',monospace"
                        opacity={lit ? 0.6 : 0.07}
                        style={{ userSelect: "none", pointerEvents: "none", transition: "all 0.2s" }}>
                        {pn.count}×
                      </text>
                    </g>
                  );
                })}

                {/* ── YOU node — rendered last so it sits on top */}
                <g style={{ cursor: "pointer" }}
                  onMouseEnter={() => { if (!selected) setHovered("me"); }}
                  onMouseLeave={() => { if (!selected) setHovered(null); }}
                  onClick={e => { e.stopPropagation(); setSelected(selected === "me" ? null : "me"); setHovered(null); }}>
                  {/* ambient halo */}
                  <circle cx={YOU_X} cy={YOU_Y} r={YOU_R + 44} fill="url(#wm-you-bg)" />
                  {/* concentric pulse rings */}
                  <circle cx={YOU_X} cy={YOU_Y} r={YOU_R + 20} fill="none" stroke={T.accent} strokeWidth={1} strokeOpacity={0.14} />
                  <circle cx={YOU_X} cy={YOU_Y} r={YOU_R + 10} fill="none" stroke={T.accent} strokeWidth={1} strokeOpacity={0.26} />
                  {/* main body */}
                  <circle cx={YOU_X} cy={YOU_Y} r={YOU_R}
                    fill="url(#wm-you-fill)" stroke={T.accent}
                    strokeWidth={active === "me" ? 3 : 2.2}
                    filter={active === "me" ? "url(#wm-glow)" : "none"}
                    style={{ transition: "all 0.22s" }} />
                  <text x={YOU_X} y={YOU_Y - 7} textAnchor="middle"
                    fill={T.accent} fontSize="14" fontFamily="'Syne',sans-serif" fontWeight="900"
                    style={{ userSelect: "none", pointerEvents: "none" }}>YOU</text>
                  <text x={YOU_X} y={YOU_Y + 11} textAnchor="middle"
                    fill={T.text3} fontSize="9" fontFamily="'DM Mono',monospace"
                    style={{ userSelect: "none", pointerEvents: "none" }}>{entries.length}d</text>
                </g>
              </svg>
            </div>

            {/* ── Tooltip panel */}
            {tooltip && (
              <div style={{
                position: "absolute", bottom: 14, right: 14,
                background: `${T.navy2}f2`, backdropFilter: "blur(12px)",
                border: `1px solid ${tooltip.color}30`,
                borderRadius: 12, padding: "12px 16px",
                minWidth: 210,
                boxShadow: `0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)`,
                pointerEvents: "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: tooltip.color, boxShadow: `0 0 8px ${tooltip.color}` }} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: tooltip.color }}>{tooltip.title}</div>
                </div>
                <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.6 }}>{tooltip.sub}</div>
                {selected && <div style={{ fontSize: 10, color: T.text3, marginTop: 7, opacity: 0.55, fontStyle: "italic" }}>Click again to deselect</div>}
              </div>
            )}
          </div>

          {/* ── Focus area legend strip */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {focusNodes.map(fn => (
              <div key={fn.id}
                onClick={() => setSelected(selected === fn.id ? null : fn.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: `${fn.color}0e`, border: `1px solid ${fn.color}28`,
                  borderRadius: 20, padding: "5px 13px",
                  cursor: "pointer", transition: "all 0.2s",
                  boxShadow: selected === fn.id ? `0 0 0 2px ${fn.color}55` : "none",
                }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: fn.color, boxShadow: selected === fn.id ? `0 0 6px ${fn.color}` : "none" }} />
                <span style={{ fontSize: 11, color: fn.color, fontWeight: 600 }}>{fn.label}</span>
                <span style={{ fontSize: 10, color: T.text3 }}>{fn.count}d</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Credit Tracker ───────────────────────────────────────────────────────────
function CreditTracker({ user }) {
  const [credits, setCredits] = useState([]);
  const [tab, setTab]         = useState("received");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "received", person: "", what: "", project: "", date: new Date().toISOString().split("T")[0] });

  useEffect(() => {
    if (!user?.id) return;
    db.from("user_credits").select("*", { eq: ["user_id", user.id], order: "inserted_at.desc" }).then(rows => {
      setCredits(rows || []);
    });
  }, [user]);

  const teammates = loadTeammates();
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = async () => {
    if (!form.person.trim() || !form.what.trim()) return;
    await db.from("user_credits").insert({ user_id: user.id, type: form.type, person: form.person.trim(), what: form.what.trim(), project: form.project, date: form.date });
    const rows = await db.from("user_credits").select("*", { eq: ["user_id", user.id], order: "inserted_at.desc" });
    setCredits(rows || []);
    setForm({ type: tab, person: "", what: "", project: "", date: new Date().toISOString().split("T")[0] });
    setShowForm(false);
  };

  const remove = async (id) => {
    await db.from("user_credits").delete(id);
    setCredits(c => c.filter(x => x.id !== id));
  };

  const filtered = credits.filter(c => c.type === tab);
  const givenCount    = credits.filter(c => c.type === "given").length;
  const receivedCount = credits.filter(c => c.type === "received").length;
  const balance = credits.length === 0 ? "—" : receivedCount > givenCount ? "↑ More received" : receivedCount < givenCount ? "↓ More given" : "= Balanced";
  const balCol  = receivedCount > givenCount ? T.gold : receivedCount < givenCount ? T.teal : T.text2;

  return (
    <div className="echo-content fade-in">
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Credits Received", v: receivedCount, c: T.gold, icon: "⭐" },
          { l: "Credits Given", v: givenCount, c: T.teal, icon: "🤝" },
          { l: "Balance", v: balance, c: balCol, icon: "⚖️", mono: false },
        ].map(s => (
          <div key={s.l} className="card" style={{ flex: 1, textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.c, fontFamily: s.mono !== false ? "'DM Mono', monospace" : "'DM Sans', sans-serif" }}>{s.v}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", background: T.navy2, borderRadius: 8, border: `1px solid ${T.border}`, overflow: "hidden" }}>
          {[{ k: "received", label: "⭐ Received", col: T.gold }, { k: "given", label: "🤝 Given", col: T.teal }].map(t => (
            <button key={t.k} onClick={() => { setTab(t.k); sf("type", t.k); }}
              style={{ padding: "8px 18px", fontSize: 13, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", border: "none",
                background: tab === t.k ? `${t.col}18` : "transparent",
                color: tab === t.k ? t.col : T.text3, fontWeight: tab === t.k ? 600 : 400, transition: "all 0.15s" }}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { sf("type", tab); setShowForm(s => !s); }}>
          {showForm ? "Cancel" : "+ Log Credit"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16, border: `1px solid ${tab === "received" ? T.gold + "35" : T.teal + "35"}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text3, marginBottom: 12 }}>
            {tab === "received" ? "⭐ Log a Credit You Received" : "🤝 Log a Credit You Gave"}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 2 }}>
              <label className="form-label">{tab === "received" ? "From" : "To"}</label>
              <input type="text" className="form-input" placeholder="Name" value={form.person} onChange={e => sf("person", e.target.value)} />
              {teammates.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                  {teammates.filter(t => form.person !== t.name).map((t, i) => (
                    <button key={i} onClick={() => sf("person", t.name)}
                      style={{ fontSize: 11, padding: "2px 9px", background: `${T.accent}10`, border: `1px solid ${T.border}`, borderRadius: 20, color: T.accent, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                      {t.emoji || "👤"} {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={form.date} onChange={e => sf("date", e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">What was recognised?</label>
            <input type="text" className="form-input" placeholder="e.g. Fixed the deployment issue under pressure" value={form.what} onChange={e => sf("what", e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label className="form-label">Project / context (optional)</label>
            <input type="text" className="form-input" placeholder="e.g. Auth migration, Q2 release" value={form.project} onChange={e => sf("project", e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={add}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "50px 0" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{tab === "received" ? "⭐" : "🤝"}</div>
          <div style={{ fontSize: 14, color: T.text2, marginBottom: 6 }}>No {tab} credits yet</div>
          <div style={{ fontSize: 12, color: T.text3 }}>
            {tab === "received" ? "When someone praises or credits your work, log it here. Invaluable at review time." : "Log credits you give to colleagues — track whether the balance is fair."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(c => (
            <div key={c.id} className="card" style={{ padding: "14px 18px", border: `1px solid ${c.type === "received" ? T.gold + "22" : T.teal + "22"}`, display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: c.type === "received" ? `${T.gold}15` : `${T.teal}15`, border: `1.5px solid ${c.type === "received" ? T.gold : T.teal}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: c.type === "received" ? T.gold : T.teal, flexShrink: 0 }}>
                {initials(c.person)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{c.person}</span>
                  <span className={`credit-${c.type}`} style={{ fontSize: 11, padding: "1px 8px", borderRadius: 20 }}>
                    {c.type === "received" ? "⭐ credited you" : "🤝 you credited"}
                  </span>
                  {c.project && <span style={{ fontSize: 11, color: T.text3 }}>· {c.project}</span>}
                  <span style={{ fontSize: 11, color: T.text3, marginLeft: "auto" }}>{fmtDate(c.date)}</span>
                </div>
                <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5, fontStyle: "italic" }}>"{c.what}"</div>
              </div>
              <button onClick={() => remove(c.id)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 14, padding: "0 4px", flexShrink: 0, lineHeight: 1 }} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

const RESOLVE_MILESTONES = [
  { days: 3,   label: "3 Days",  emoji: "🌱" },
  { days: 7,   label: "1 Week",  emoji: "⚡" },
  { days: 21,  label: "21 Days", emoji: "🔥" },
  { days: 30,  label: "1 Month", emoji: "🏆" },
  { days: 100, label: "100 Days",emoji: "💎" },
  { days: 365, label: "1 Year",  emoji: "🌟" },
];

function getStreak(h) {
  const base = h.last_slip || h.lastSlip || h.created_at || h.createdAt;
  return Math.max(0, Math.floor((Date.now() - new Date(base + "T00:00:00").getTime()) / 86400000));
}

function getMilestone(streak) {
  return [...RESOLVE_MILESTONES].reverse().find(m => streak >= m.days) || null;
}

function getNextMilestone(streak) {
  return RESOLVE_MILESTONES.find(m => m.days > streak) || null;
}

function Resolve({ user }) {
  const [habits, setHabits]       = useState([]);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ name: "", emoji: "" });
  const [justSlipped, setJustSlipped] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    db.from("resolve_habits").select("*", { eq: ["user_id", user.id] }).then(rows => {
      setHabits(rows || []);
    });
  }, [user]);

  const addHabit = async () => {
    if (!form.name.trim()) return;
    const today = new Date().toISOString().split("T")[0];
    await db.from("resolve_habits").insert({ user_id: user.id, name: form.name.trim(), emoji: form.emoji.trim() || "✊", created_at: today, last_slip: null, slip_history: [] });
    const rows = await db.from("resolve_habits").select("*", { eq: ["user_id", user.id] });
    setHabits(rows || []);
    setForm({ name: "", emoji: "" });
    setShowForm(false);
  };

  const confirmSlip = async (id) => {
    const today = new Date().toISOString().split("T")[0];
    const h = habits.find(x => x.id === id);
    if (!h) return;
    const slip_history = [...(h.slip_history || []), today];
    await db.from("resolve_habits").update({ last_slip: today, slip_history }, id);
    setHabits(prev => prev.map(x => x.id === id ? { ...x, last_slip: today, slip_history } : x));
    setConfirmId(null);
    setJustSlipped(id);
    setTimeout(() => setJustSlipped(null), 3500);
  };

  const remove = async (id) => {
    await db.from("resolve_habits").delete(id);
    setHabits(prev => prev.filter(x => x.id !== id));
  };

  const sorted = [...habits].sort((a, b) => getStreak(b) - getStreak(a));

  const totalDays = habits.reduce((s, h) => s + getStreak(h), 0);
  const best      = habits.reduce((mx, h) => Math.max(mx, getStreak(h)), 0);

  const RCard = ({ h }) => {
    const streak    = getStreak(h);
    const milestone = getMilestone(streak);
    const next      = getNextMilestone(streak);
    const slipped   = justSlipped === h.id;
    const confirming = confirmId === h.id;

    const numCol = streak >= 100 ? T.gold : streak >= 21 ? T.teal : streak >= 7 ? T.accent : T.text1;

    return (
      <div style={{
        background: T.navy2,
        border: `1px solid ${slipped ? "rgba(240,117,98,0.45)" : milestone ? "rgba(232,198,106,0.22)" : T.border}`,
        borderRadius: 18, padding: "22px 20px 16px",
        display: "flex", flexDirection: "column",
        position: "relative", overflow: "hidden",
        transition: "border-color 0.35s",
      }}>
        {milestone && (
          <div style={{ position: "absolute", top: 0, right: 0, width: 70, height: 70,
            borderRadius: "0 18px 0 70px", background: "rgba(232,198,106,0.05)", pointerEvents: "none" }} />
        )}

        {/* Top row: emoji + name + delete */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>{h.emoji}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: T.text2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
          <button onClick={() => remove(h.id)} title="Delete" style={{
            background: "transparent", border: "none", color: T.text3, cursor: "pointer",
            fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0,
          }}>✕</button>
        </div>

        {slipped ? (
          <div style={{ textAlign: "center", padding: "16px 0 10px" }}>
            <div style={{ fontSize: 34, marginBottom: 6 }}>💔</div>
            <div style={{ fontSize: 13, color: T.coral, fontWeight: 500 }}>Streak reset. Day 0.</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>You've got this. Start again.</div>
          </div>
        ) : (
          <>
            {/* Big number */}
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 56, fontWeight: 800,
              color: numCol, lineHeight: 1, marginBottom: 2 }}>{streak}</div>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
              {streak === 1 ? "day without slipping" : "days without slipping"}
            </div>

            {/* Milestone badge */}
            {milestone && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5,
                background: "rgba(232,198,106,0.1)", border: "1px solid rgba(232,198,106,0.22)",
                borderRadius: 20, padding: "3px 10px", fontSize: 11, color: T.gold,
                width: "fit-content", marginBottom: 6 }}>
                {milestone.emoji} {milestone.label}
              </div>
            )}

            {/* Progress to next milestone */}
            {next && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text3, marginBottom: 4 }}>
                  <span>→ {next.emoji} {next.label}</span>
                  <span>{next.days - streak}d left</span>
                </div>
                <div style={{ height: 3, background: T.border, borderRadius: 2 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: T.accent,
                    width: `${Math.min(100, (streak / next.days) * 100)}%`, transition: "width 0.4s" }} />
                </div>
              </div>
            )}

            {/* Slip count */}
            {(h.slip_history || []).length > 0 && (
              <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>
                {h.slip_history.length} slip{h.slip_history.length !== 1 ? "s" : ""} recorded
              </div>
            )}
          </>
        )}

        {/* Slip button / confirm */}
        {!slipped && (
          confirming ? (
            <div style={{ marginTop: 10, background: "rgba(240,117,98,0.08)",
              border: "1px solid rgba(240,117,98,0.25)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, color: T.coral, marginBottom: 8, fontWeight: 500 }}>
                Reset {streak > 0 ? `${streak}-day ` : ""}streak?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => confirmSlip(h.id)} style={{
                  flex: 1, background: T.coral, border: "none", borderRadius: 7,
                  color: "#fff", fontSize: 12, cursor: "pointer", padding: "6px 0",
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
                }}>Yes, I slipped</button>
                <button onClick={() => setConfirmId(null)} style={{
                  flex: 1, background: "transparent", border: `1px solid ${T.border}`,
                  borderRadius: 7, color: T.text3, fontSize: 12, cursor: "pointer",
                  padding: "6px 0", fontFamily: "'DM Sans', sans-serif",
                }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmId(h.id)} style={{
              marginTop: 10, width: "100%",
              background: "rgba(240,117,98,0.07)", border: "1px solid rgba(240,117,98,0.18)",
              borderRadius: 9, color: T.coral, fontSize: 12, cursor: "pointer",
              padding: "8px 0", fontFamily: "'DM Sans', sans-serif",
            }}>I slipped today</button>
          )
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: "32px 28px 64px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, color: T.text3, letterSpacing: 1.5,
            textTransform: "uppercase", marginBottom: 4 }}>Resolve</div>
          <div style={{ fontSize: 26, fontFamily: "'Syne', sans-serif",
            fontWeight: 700, color: T.text1, lineHeight: 1.2 }}>Days You Stayed Strong</div>
          <div style={{ fontSize: 13, color: T.text2, marginTop: 5 }}>
            Track habits you're breaking — every clean day counts.
          </div>
        </div>
        <button onClick={() => setShowForm(true)} style={{
          background: T.accent, border: "none", borderRadius: 10, color: "#fff",
          fontSize: 13, fontWeight: 500, cursor: "pointer", padding: "10px 18px",
          fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
        }}>+ New Habit</button>
      </div>

      {/* Summary bar */}
      {habits.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          {[
            { label: "Habits tracked", value: habits.length, col: T.text1 },
            { label: "Combined clean days", value: totalDays, col: T.teal },
            { label: "Best streak", value: `${best}d`, col: T.gold },
          ].map(s => (
            <div key={s.label} style={{ background: T.navy2, border: `1px solid ${T.border}`,
              borderRadius: 12, padding: "14px 20px", flex: 1, minWidth: 120 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22,
                fontWeight: 700, color: s.col }}>{s.value}</div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {habits.length === 0 && (
        <div style={{ textAlign: "center", padding: "70px 20px", color: T.text3 }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>✊</div>
          <div style={{ fontSize: 18, color: T.text2, marginBottom: 8 }}>Nothing to resist yet</div>
          <div style={{ fontSize: 13 }}>Add a habit you want to break — the streak starts today.</div>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
        {sorted.map(h => <RCard key={h.id} h={h} />)}
      </div>

      {/* Add habit modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,16,0.82)",
          backdropFilter: "blur(8px)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: T.navy2, border: `1px solid ${T.border2}`,
            borderRadius: 20, padding: "36px 36px 32px", width: "100%", maxWidth: 400 }}>
            <div style={{ fontSize: 18, fontFamily: "'Syne', sans-serif",
              fontWeight: 700, color: T.text1, marginBottom: 4 }}>Break a habit</div>
            <div style={{ fontSize: 13, color: T.text3, marginBottom: 22 }}>
              Name it. Own it. Start your streak from today.
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input
                value={form.emoji}
                onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                placeholder="✊"
                maxLength={2}
                style={{ width: 52, textAlign: "center", fontSize: 22, flexShrink: 0,
                  background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 10,
                  color: T.text1, padding: "10px 0", outline: "none",
                  fontFamily: "'DM Sans', sans-serif" }}
              />
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addHabit()}
                placeholder="e.g. Eating chips, Doom scrolling…"
                autoFocus
                style={{ flex: 1, background: T.navy3, border: `1px solid ${T.border}`,
                  borderRadius: 10, color: T.text1, padding: "10px 14px",
                  fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={addHabit} style={{
                flex: 1, background: T.accent, border: "none", borderRadius: 10,
                color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer",
                padding: "11px 0", fontFamily: "'DM Sans', sans-serif",
              }}>Start streak</button>
              <button onClick={() => setShowForm(false)} style={{
                flex: 1, background: "transparent", border: `1px solid ${T.border}`,
                borderRadius: 10, color: T.text2, fontSize: 13, cursor: "pointer",
                padding: "11px 0", fontFamily: "'DM Sans', sans-serif",
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brag Doc ─────────────────────────────────────────────────────────────────
function BragDoc() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("quarter");
  const [filterTag, setFilterTag] = useState(null);
  const [copied, setCopied] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    probeIsWin().then(ok => {
      setSupported(ok);
      if (!ok) { setLoading(false); return; }
      db.from("diary_entries").select("*", { order: "date.desc" }).then(rows => {
        setEntries((rows || []).filter(e => e.is_win));
        setLoading(false);
      });
    });
  }, []);

  const PERIODS = [
    { key: "month", label: "This Month" },
    { key: "quarter", label: "This Quarter" },
    { key: "year", label: "This Year" },
    { key: "all", label: "All Time" },
  ];

  const getQuarterStart = () => {
    const n = new Date();
    return new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1);
  };

  const filtered = entries.filter(e => {
    if (!e.date) return false;
    const d = new Date(e.date + "T00:00:00");
    const n = new Date();
    if (period === "month") return d >= new Date(n.getFullYear(), n.getMonth(), 1);
    if (period === "quarter") return d >= getQuarterStart();
    if (period === "year") return d >= new Date(n.getFullYear(), 0, 1);
    return true;
  }).filter(e => !filterTag || (e.win_tags || []).includes(filterTag));

  const byTag = {};
  WIN_TAGS.forEach(wt => { byTag[wt.key] = []; });
  byTag.untagged = [];
  filtered.forEach(e => {
    const tags = e.win_tags?.length ? e.win_tags : ["untagged"];
    tags.forEach(t => { if (byTag[t]) byTag[t].push(e); else byTag.untagged.push(e); });
  });

  const getEntryBullets = (e) => {
    // Prefer AI-rewritten category items over raw content
    const cats = e.categories || {};
    const catItems = ["execution", "validation", "meeting", "other"].flatMap(k => cats[k] || []);
    if (catItems.length) return catItems;
    return (e.content || "").split("\n").filter(Boolean);
  };

  const generateEvidence = () => {
    const periodLabel = PERIODS.find(p => p.key === period)?.label || period;
    const lines = [`PERFORMANCE EVIDENCE — ${periodLabel.toUpperCase()}`,
      `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
      "═".repeat(55), ""];
    WIN_TAGS.forEach(wt => {
      const wins = byTag[wt.key];
      if (!wins?.length) return;
      lines.push(`${wt.icon} ${wt.label.toUpperCase()} (${wins.length})`);
      wins.forEach(e => {
        const pts = getEntryBullets(e);
        lines.push(`  • [${e.date}] ${pts[0] || (e.focus_areas || []).join(", ") || "Win logged"}`);
        pts.slice(1, 4).forEach(p => lines.push(`    − ${p}`));
      });
      lines.push("");
    });
    if (byTag.untagged?.length) {
      lines.push(`📌 GENERAL (${byTag.untagged.length})`);
      byTag.untagged.forEach(e => {
        const pts = getEntryBullets(e);
        lines.push(`  • [${e.date}] ${pts[0] || "Win logged"}`);
      });
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); });
  };

  if (!supported) return (
    <div className="echo-content fade-in">
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1, marginBottom: 8 }}>Run the migration first</div>
        <pre style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 16px", margin: "16px auto", fontSize: 12, color: T.teal, textAlign: "left", maxWidth: 500, whiteSpace: "pre-wrap" }}>
{`ALTER TABLE diary_entries
  ADD COLUMN IF NOT EXISTS is_win boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS win_tags jsonb DEFAULT '[]';`}
        </pre>
      </div>
    </div>
  );

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 4, background: T.navy2, borderRadius: 10, padding: 4 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{
              fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
              background: period === p.key ? T.accent : "transparent",
              color: period === p.key ? "#fff" : T.text2, border: "none", transition: "all 0.15s",
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={generateEvidence} disabled={filtered.length === 0} style={{
          display: "flex", alignItems: "center", gap: 8,
          background: copied ? T.teal : `linear-gradient(135deg, ${T.accentDim}, ${T.accent})`,
          color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px",
          fontSize: 13, fontWeight: 600, cursor: filtered.length === 0 ? "not-allowed" : "pointer",
          opacity: filtered.length === 0 ? 0.5 : 1, transition: "all 0.2s",
        }}>{copied ? "✓ Copied to clipboard" : "📋 Generate Appraisal Evidence"}</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => setFilterTag(null)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, cursor: "pointer", background: !filterTag ? `${T.accent}22` : "transparent", color: !filterTag ? T.accent : T.text3, border: `1px solid ${!filterTag ? T.accent : T.border}` }}>
          All ({filtered.length})
        </button>
        {WIN_TAGS.map(wt => {
          const cnt = (byTag[wt.key] || []).length;
          return (
            <button key={wt.key} onClick={() => setFilterTag(filterTag === wt.key ? null : wt.key)} style={{
              fontSize: 11, padding: "4px 12px", borderRadius: 20, cursor: "pointer",
              background: filterTag === wt.key ? `${wt.color}22` : "transparent",
              color: filterTag === wt.key ? wt.color : (cnt > 0 ? T.text2 : T.text3),
              border: `1px solid ${filterTag === wt.key ? wt.color : T.border}`, opacity: cnt === 0 ? 0.4 : 1,
            }}>{wt.icon} {wt.label} {cnt > 0 ? `(${cnt})` : ""}</button>
          );
        })}
      </div>
      {loading ? (
        <div style={{ textAlign: "center", color: T.text3, padding: 40 }}>Loading wins…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text1, marginBottom: 8 }}>No wins logged yet</div>
          <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.7 }}>Open any diary entry and tap <strong style={{ color: T.gold }}>🏆 Mark as Win</strong>.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map(e => {
            const pts = (e.content || "").split("\n").filter(Boolean);
            const tags = e.win_tags || [];
            return (
              <div key={e.id} className="card" style={{ borderLeft: `3px solid ${T.gold}`, background: `${T.gold}06` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>🏆</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: T.text3 }}>{e.date}</span>
                      {(e.focus_areas || []).slice(0, 2).map(f => <span key={f} className="focus-badge" style={{ fontSize: 10 }}>{f}</span>)}
                      {tags.map(t => { const wt = WIN_TAGS.find(x => x.key === t); return wt ? <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: `${wt.color}22`, color: wt.color, border: `1px solid ${wt.color}40` }}>{wt.icon} {wt.label}</span> : null; })}
                    </div>
                    {pts.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {pts.slice(0, 4).map((p, i) => <div key={i} style={{ fontSize: 13, color: i === 0 ? T.text1 : T.text2, lineHeight: 1.5 }}>{i === 0 ? p : `• ${p}`}</div>)}
                        {pts.length > 4 && <div style={{ fontSize: 11, color: T.text3 }}>+{pts.length - 4} more lines</div>}
                      </div>
                    ) : <div style={{ fontSize: 13, color: T.text3, fontStyle: "italic" }}>No content logged</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Commitments ──────────────────────────────────────────────────────────────
function Commitments({ user }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ direction: "i_owe", person: "", what: "" });
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [tableExists, setTableExists] = useState(true);

  const load = useCallback(async () => {
    const rows = await db.from("commitments").select("*", { order: "inserted_at.asc" });
    if (rows && rows.code) { setTableExists(false); setLoading(false); return; }
    setItems(rows || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isConfigured()) load(); else setLoading(false); }, [load]);

  const add = async () => {
    if (!form.person.trim() || !form.what.trim()) return;
    await db.from("commitments").insert({ user_id: user.id, direction: form.direction, person: form.person.trim(), what: form.what.trim() });
    setForm(f => ({ ...f, person: "", what: "" }));
    load();
  };

  const resolve = async (id) => { await db.from("commitments").update({ resolved_at: new Date().toISOString() }, id); load(); };
  const reopen  = async (id) => { await db.from("commitments").update({ resolved_at: null }, id); load(); };
  const remove  = async (id) => { await db.from("commitments").delete(id); setItems(prev => prev.filter(i => i.id !== id)); };

  const daysSince = (ts) => Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  const open = items.filter(i => !i.resolved_at);
  const resolved = items.filter(i => !!i.resolved_at);
  const iOwe     = open.filter(i => i.direction === "i_owe").sort((a, b) => new Date(a.inserted_at) - new Date(b.inserted_at));
  const waitingOn = open.filter(i => i.direction === "waiting_on").sort((a, b) => new Date(a.inserted_at) - new Date(b.inserted_at));

  if (!tableExists) return (
    <div className="echo-content fade-in">
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🤝</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1, marginBottom: 8 }}>Run the migration first</div>
        <pre style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 16px", margin: "16px auto", fontSize: 12, color: T.teal, textAlign: "left", maxWidth: 580, whiteSpace: "pre-wrap" }}>
{`create table commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  direction text not null,
  person text not null,
  what text not null,
  source text default 'manual',
  resolved_at timestamptz,
  inserted_at timestamptz default now()
);
alter table commitments enable row level security;
create policy "own" on commitments for all using (auth.uid()=user_id);`}
        </pre>
      </div>
    </div>
  );

  const CommitCard = ({ item }) => {
    const days = daysSince(item.inserted_at);
    const urgentColor = item.direction === "waiting_on" && days >= 5 ? T.coral : days >= 3 ? T.gold : T.text3;
    return (
      <div style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${item.direction === "i_owe" ? T.accent : T.coral}` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: T.text1, fontWeight: 500, lineHeight: 1.4, marginBottom: 4 }}>{item.what}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>
              {item.direction === "i_owe" ? "→ " : "← "}<span style={{ color: T.text2, fontWeight: 500 }}>{item.person}</span>
              <span style={{ color: urgentColor, marginLeft: 8 }}>· {days === 0 ? "today" : `${days}d ago`}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button onClick={() => resolve(item.id)} title="Mark done" style={{ background: `${T.teal}18`, color: T.teal, border: `1px solid ${T.teal}40`, borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>✓</button>
            <button onClick={() => remove(item.id)} style={{ background: "none", color: T.text3, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text1, marginBottom: 12 }}>Log a commitment</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: T.navy3, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}`, flexShrink: 0 }}>
            {[{ key: "i_owe", label: "I owe", color: T.accent }, { key: "waiting_on", label: "Waiting on", color: T.coral }].map(d => (
              <button key={d.key} onClick={() => setForm(f => ({ ...f, direction: d.key }))} style={{
                padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: form.direction === d.key ? `${d.color}22` : "transparent",
                color: form.direction === d.key ? d.color : T.text3, border: "none", transition: "all 0.15s",
              }}>{d.label}</button>
            ))}
          </div>
          <input className="form-input" placeholder="Person" value={form.person} style={{ width: 140, flex: "none" }} onChange={e => setForm(f => ({ ...f, person: e.target.value }))} />
          <input className="form-input" placeholder="What exactly…" value={form.what} style={{ flex: 1, minWidth: 180 }} onChange={e => setForm(f => ({ ...f, what: e.target.value }))} onKeyDown={e => e.key === "Enter" && add()} />
          <button className="btn btn-primary" onClick={add} disabled={!form.person.trim() || !form.what.trim()} style={{ flexShrink: 0 }}>Add</button>
        </div>
      </div>
      {loading ? (
        <div style={{ color: T.text3, textAlign: "center", padding: 40 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: T.accent }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text1 }}>I owe</div>
                {iOwe.length > 0 && <span style={{ fontSize: 11, background: `${T.accent}22`, color: T.accent, borderRadius: 10, padding: "1px 7px" }}>{iOwe.length}</span>}
              </div>
              {iOwe.length === 0 ? <div style={{ fontSize: 13, color: T.text3, fontStyle: "italic" }}>You're all caught up.</div> : iOwe.map(item => <CommitCard key={item.id} item={item} />)}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: T.coral }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text1 }}>Waiting on</div>
                {waitingOn.length > 0 && <span style={{ fontSize: 11, background: `${T.coral}22`, color: T.coral, borderRadius: 10, padding: "1px 7px" }}>{waitingOn.length}</span>}
              </div>
              {waitingOn.length === 0 ? <div style={{ fontSize: 13, color: T.text3, fontStyle: "italic" }}>Nothing blocked on others.</div> : waitingOn.map(item => <CommitCard key={item.id} item={item} />)}
            </div>
          </div>
          {resolved.length > 0 && (
            <div>
              <button onClick={() => setShowResolved(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: T.text3, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                {showResolved ? "▾" : "▸"} {resolved.length} resolved
              </button>
              {showResolved && resolved.map(item => (
                <div key={item.id} style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 6, display: "flex", gap: 10, alignItems: "center", opacity: 0.6 }}>
                  <span style={{ fontSize: 12, color: T.teal }}>✓</span>
                  <span style={{ flex: 1, fontSize: 12, color: T.text3, textDecoration: "line-through" }}>{item.what}</span>
                  <span style={{ fontSize: 11, color: T.text3 }}>{item.person}</span>
                  <button onClick={() => reopen(item.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: T.text3 }}>reopen</button>
                  <button onClick={() => remove(item.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: T.text3 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Incident Log ─────────────────────────────────────────────────────────────
function IncidentLog({ user }) {
  const [incidents, setIncidents] = useState([]);
  const [form, setForm] = useState({ date: today(), type: "escaped_defect", module: "", root_cause: "", test_gap: "", severity: "medium", notes: "" });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tableExists, setTableExists] = useState(true);

  const load = useCallback(async () => {
    const rows = await db.from("incidents").select("*", { order: "date.desc" });
    if (rows && rows.code) { setTableExists(false); setLoading(false); return; }
    setIncidents(rows || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isConfigured()) load(); else setLoading(false); }, [load]);

  const save = async () => {
    if (!form.root_cause.trim()) return;
    setSaving(true);
    await db.from("incidents").insert({ user_id: user.id, ...form });
    setForm({ date: today(), type: "escaped_defect", module: "", root_cause: "", test_gap: "", severity: "medium", notes: "" });
    setAdding(false); setSaving(false); load();
  };

  const moduleCounts = {};
  incidents.forEach(i => { if (i.module) moduleCounts[i.module] = (moduleCounts[i.module] || 0) + 1; });
  const topModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const rcPatterns = {};
  incidents.forEach(i => {
    if (!i.root_cause) return;
    const lc = i.root_cause.toLowerCase();
    const cat = lc.includes("test") ? "Missing Tests" : lc.includes("env") || lc.includes("config") ? "Config/Env" : lc.includes("data") ? "Data Issue" : lc.includes("timeout") || lc.includes("race") ? "Timing/Race" : "Logic Error";
    rcPatterns[cat] = (rcPatterns[cat] || 0) + 1;
  });

  if (!tableExists) return (
    <div className="echo-content fade-in">
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🐛</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1, marginBottom: 8 }}>Run the migration first</div>
        <pre style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 16px", margin: "16px auto", fontSize: 12, color: T.teal, textAlign: "left", maxWidth: 540, whiteSpace: "pre-wrap" }}>
{`create table incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null default current_date,
  type text not null default 'escaped_defect',
  module text default '', root_cause text default '',
  test_gap text default '', severity text default 'medium',
  notes text default '',
  inserted_at timestamptz default now()
);
alter table incidents enable row level security;
create policy "own" on incidents for all using (auth.uid()=user_id);`}
        </pre>
      </div>
    </div>
  );

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />
      {incidents.length >= 3 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: `3px solid ${T.coral}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.coral, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>📊 Escape Patterns</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {topModules.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: T.text3, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>By Module</div>
                {topModules.map(([mod, cnt]) => (
                  <div key={mod} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1, height: 4, background: T.navy3, borderRadius: 2 }}>
                      <div style={{ width: `${(cnt / topModules[0][1]) * 100}%`, height: "100%", background: T.coral, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, color: T.text2, minWidth: 70 }}>{mod}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.coral, minWidth: 20 }}>{cnt}</span>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(rcPatterns).length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: T.text3, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>By Root Cause</div>
                {Object.entries(rcPatterns).sort((a, b) => b[1] - a[1]).map(([cat, cnt]) => (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: T.text2, flex: 1 }}>{cat}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.gold }}>{cnt}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: T.text3 }}>{incidents.length} incident{incidents.length !== 1 ? "s" : ""} logged</div>
        <button className="btn btn-primary" onClick={() => setAdding(o => !o)}>{adding ? "Cancel" : "+ Log Incident"}</button>
      </div>
      {adding && (
        <div className="card" style={{ marginBottom: 20, border: `1px solid ${T.coral}40` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Module / Area</label>
              <input className="form-input" placeholder="e.g. 3DS, Payment Flow" value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="form-label">Type</label>
              <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {INCIDENT_TYPES.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="form-label">Severity</label>
              <select className="form-input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {SEVERITY.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ margin: "0 0 10px" }}>
            <label className="form-label">Root Cause *</label>
            <input className="form-input" placeholder="What caused this to escape?" value={form.root_cause} onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: "0 0 12px" }}>
            <label className="form-label">What test would have caught it?</label>
            <input className="form-input" placeholder="e.g. Integration test for 3DS redirect flow" value={form.test_gap} onChange={e => setForm(f => ({ ...f, test_gap: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !form.root_cause.trim()}>{saving ? "Saving…" : "Log Incident"}</button>
          </div>
        </div>
      )}
      {loading ? (
        <div style={{ color: T.text3, textAlign: "center", padding: 40 }}>Loading…</div>
      ) : incidents.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🐛</div>
          <div style={{ fontSize: 15, color: T.text1, marginBottom: 6 }}>No incidents logged</div>
          <div style={{ fontSize: 13, color: T.text3 }}>Log every escaped defect and prod issue. Patterns emerge after 3–4 entries.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {incidents.map(inc => {
            const tm = INCIDENT_TYPES.find(t => t.key === inc.type) || INCIDENT_TYPES[0];
            const sm = SEVERITY.find(s => s.key === inc.severity) || SEVERITY[1];
            return (
              <div key={inc.id} className="card" style={{ borderLeft: `3px solid ${tm.color}` }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{tm.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: T.text3 }}>{inc.date}</span>
                      {inc.module && <span style={{ fontSize: 11, fontWeight: 600, color: tm.color, background: `${tm.color}18`, borderRadius: 4, padding: "1px 6px" }}>{inc.module}</span>}
                      <span style={{ fontSize: 11, color: sm.color, background: `${sm.color}18`, borderRadius: 4, padding: "1px 6px" }}>{sm.label}</span>
                    </div>
                    <div style={{ fontSize: 13, color: T.text1, marginBottom: 4 }}>{inc.root_cause}</div>
                    {inc.test_gap && <div style={{ fontSize: 12, color: T.teal, marginTop: 4 }}><span style={{ color: T.text3 }}>Test gap: </span>{inc.test_gap}</div>}
                  </div>
                  <button onClick={() => { db.from("incidents").delete(inc.id); setIncidents(p => p.filter(i => i.id !== inc.id)); }} style={{ background: "none", border: "none", cursor: "pointer", color: T.text3, fontSize: 13, flexShrink: 0 }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Decision Log ─────────────────────────────────────────────────────────────
function DecisionLog({ user }) {
  const [decisions, setDecisions] = useState([]);
  const [form, setForm] = useState({ date: today(), decision: "", context: "", people: "" });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [tableExists, setTableExists] = useState(true);

  const load = useCallback(async () => {
    const rows = await db.from("decisions").select("*", { order: "date.desc" });
    if (rows && rows.code) { setTableExists(false); setLoading(false); return; }
    setDecisions(rows || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isConfigured()) load(); else setLoading(false); }, [load]);

  const save = async () => {
    if (!form.decision.trim()) return;
    setSaving(true);
    await db.from("decisions").insert({ user_id: user.id, ...form });
    setForm({ date: today(), decision: "", context: "", people: "" });
    setAdding(false); setSaving(false); load();
  };

  const filtered = decisions.filter(d => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return d.decision?.toLowerCase().includes(q) || d.context?.toLowerCase().includes(q) || d.people?.toLowerCase().includes(q);
  });

  if (!tableExists) return (
    <div className="echo-content fade-in">
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🧠</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1, marginBottom: 8 }}>Run the migration first</div>
        <pre style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 16px", margin: "16px auto", fontSize: 12, color: T.teal, textAlign: "left", maxWidth: 540, whiteSpace: "pre-wrap" }}>
{`create table decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null default current_date,
  decision text not null,
  context text default '',
  people text default '',
  inserted_at timestamptz default now()
);
alter table decisions enable row level security;
create policy "own" on decisions for all using (auth.uid()=user_id);`}
        </pre>
      </div>
    </div>
  );

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />
      <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
        <input className="form-input" placeholder="Search decisions…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, maxWidth: 360 }} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setAdding(o => !o)}>{adding ? "Cancel" : "+ Log Decision"}</button>
      </div>
      {adding && (
        <div className="card" style={{ marginBottom: 20, border: `1px solid ${T.teal}40` }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, marginBottom: 10 }}>
            <div><label className="form-label">Date</label>
              <input type="date" className="form-input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div><label className="form-label">Decision *</label>
              <input className="form-input" placeholder="What was decided?" value={form.decision} onChange={e => setForm(f => ({ ...f, decision: e.target.value }))} />
            </div>
          </div>
          <div className="form-group" style={{ margin: "0 0 10px" }}>
            <label className="form-label">Context / Why</label>
            <input className="form-input" placeholder="Why this? What options were considered?" value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: "0 0 12px" }}>
            <label className="form-label">Who was in the room</label>
            <input className="form-input" placeholder="e.g. Sundar, Rohit, PM" value={form.people} onChange={e => setForm(f => ({ ...f, people: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !form.decision.trim()}>{saving ? "Saving…" : "Save Decision"}</button>
          </div>
        </div>
      )}
      {loading ? (
        <div style={{ color: T.text3, textAlign: "center", padding: 40 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
          <div style={{ fontSize: 15, color: T.text1, marginBottom: 6 }}>{search ? "No matching decisions" : "No decisions logged yet"}</div>
          <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.7, maxWidth: 380, margin: "0 auto" }}>
            Log architectural choices, process calls, and key decisions. Boring now; invaluable when someone asks why in six months.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(d => (
            <div key={d.id} className="card" style={{ borderLeft: `3px solid ${T.teal}` }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>🧠</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: T.text3 }}>{d.date}</span>
                    {d.people && d.people.split(",").map(p => <span key={p} style={{ fontSize: 10, color: T.text2, background: T.navy3, borderRadius: 4, padding: "1px 6px" }}>{p.trim()}</span>)}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 4, lineHeight: 1.4 }}>{d.decision}</div>
                  {d.context && <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.5 }}>{d.context}</div>}
                </div>
                <button onClick={() => { db.from("decisions").delete(d.id); setDecisions(p => p.filter(x => x.id !== d.id)); }} style={{ background: "none", border: "none", cursor: "pointer", color: T.text3, fontSize: 13, flexShrink: 0 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Weekly Update Modal ───────────────────────────────────────────────────────
function WeeklyUpdateModal({ user, onClose }) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured() || !user) { setText("Configure Supabase first."); setLoading(false); return; }
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
    const wStr = weekStart.toISOString().split("T")[0];
    const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    Promise.all([
      db.from("diary_entries").select("*", { order: "date.desc" }),
      db.from("one_on_one_sessions").select("*", { order: "session_date.desc" }),
      db.from("commitments").select("*", { order: "inserted_at.desc" }),
    ]).then(([entries, sessions, commitments]) => {
      const thisWeek = (entries || []).filter(e => e.date >= wStr);
      const thisSess = (sessions || []).filter(s => s.session_date >= wStr);
      const wins = thisWeek.filter(e => e.is_win);
      const openBlocks = Array.isArray(commitments) ? commitments.filter(c => !c.resolved_at && c.direction === "waiting_on") : [];
      const closed = Array.isArray(commitments) ? commitments.filter(c => !!c.resolved_at && new Date(c.resolved_at) >= weekStart) : [];
      const allPts = thisWeek.flatMap(e => (e.content || "").split("\n").filter(Boolean).map(p => ({ text: p, win: e.is_win })));
      const lines = [`📋 Weekly Update — w/e ${fmt(new Date().toISOString().split("T")[0])}`, ""];
      if (allPts.length > 0) {
        lines.push("✅ Done this week");
        allPts.slice(0, 8).forEach(p => lines.push(`  • ${p.text}${p.win ? " 🏆" : ""}`));
        if (allPts.length > 8) lines.push(`  … and ${allPts.length - 8} more`);
        lines.push("");
      }
      if (wins.length > 0) {
        lines.push(`🏆 Wins (${wins.length})`);
        wins.forEach(w => { const f = (w.content || "").split("\n").filter(Boolean)[0]; if (f) lines.push(`  • ${f}`); });
        lines.push("");
      }
      if (thisSess.length > 0) {
        lines.push("👥 1:1s held");
        thisSess.forEach(s => { lines.push(`  • ${s.teammate_name} — ${s.session_date}`); if (s.notes?.trim()) lines.push(`    ${s.notes.split("\n")[0].slice(0, 80)}`); });
        lines.push("");
      }
      if (closed.length > 0) {
        lines.push(`✓ Commitments closed (${closed.length})`);
        closed.forEach(c => lines.push(`  • ${c.direction === "i_owe" ? "Delivered to" : "Received from"} ${c.person}: ${c.what}`));
        lines.push("");
      }
      if (openBlocks.length > 0) {
        lines.push("🚧 Blocked on others");
        openBlocks.forEach(c => { const days = Math.floor((Date.now() - new Date(c.inserted_at).getTime()) / 86400000); lines.push(`  • Waiting on ${c.person}: ${c.what} (${days}d)`); });
        lines.push("");
      }
      if (allPts.length === 0 && wins.length === 0 && thisSess.length === 0) lines.push("No diary entries this week. Log some activity first.");
      setText(lines.join("\n"));
      setLoading(false);
    }).catch(() => {
      Promise.all([
        db.from("diary_entries").select("*", { order: "date.desc" }),
        db.from("one_on_one_sessions").select("*", { order: "session_date.desc" }),
      ]).then(([entries, sessions]) => {
        const thisWeek = (entries || []).filter(e => e.date >= wStr);
        const thisSess = (sessions || []).filter(s => s.session_date >= wStr);
        const allPts = thisWeek.flatMap(e => (e.content || "").split("\n").filter(Boolean));
        const lines = ["📋 Weekly Update", ""];
        if (allPts.length > 0) { lines.push("✅ Done"); allPts.slice(0, 8).forEach(p => lines.push(`  • ${p}`)); lines.push(""); }
        if (thisSess.length > 0) { lines.push("👥 1:1s"); thisSess.forEach(s => lines.push(`  • ${s.teammate_name}`)); lines.push(""); }
        setText(lines.join("\n") || "No activity this week.");
        setLoading(false);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = () => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }); };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-title">
          <span>📋 Weekly Update Draft</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: T.text3, marginBottom: 14 }}>Auto-built from your diary, 1:1s, and commitments. Edit before sending.</div>
        {loading ? (
          <div style={{ textAlign: "center", color: T.text3, padding: 30 }}>Building your update…</div>
        ) : (
          <textarea value={text} onChange={e => setText(e.target.value)} style={{ width: "100%", minHeight: 300, background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", fontSize: 13, color: T.text1, fontFamily: "'DM Mono', monospace", lineHeight: 1.7, resize: "vertical" }} />
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={copy} disabled={loading}>{copied ? "✓ Copied!" : "Copy to Clipboard"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Release Tracker ─────────────────────────────────────────────────────────
const RELEASE_KEY = "echo_release_logs";
const getReleaseDay = (date) => {
  try { return JSON.parse(localStorage.getItem(RELEASE_KEY) || "{}")[date] || []; } catch { return []; }
};
const saveReleaseDay = (date, owners) => {
  try {
    const all = JSON.parse(localStorage.getItem(RELEASE_KEY) || "{}");
    all[date] = owners;
    localStorage.setItem(RELEASE_KEY, JSON.stringify(all));
  } catch {}
};

function ReleaseTracker() {
  const [date, setDate] = useState(today);
  const [owners, setOwners] = useState(() => getReleaseDay(today()));
  const [addingOwner, setAddingOwner] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [editingItem, setEditingItem] = useState(null); // {ownerIdx, itemIdx}
  const [itemForm, setItemForm] = useState({ ticket: "", note: "", status: "today" });
  const [addingItemFor, setAddingItemFor] = useState(null); // ownerIdx

  const loadDate = (d) => { setDate(d); setOwners(getReleaseDay(d)); setAddingOwner(false); setAddingItemFor(null); setEditingItem(null); };
  const persist = (next) => { setOwners(next); saveReleaseDay(date, next); };

  const addOwner = () => {
    const name = newOwner.trim();
    if (!name) return;
    if (owners.some(o => o.name.toLowerCase() === name.toLowerCase())) { setNewOwner(""); setAddingOwner(false); return; }
    persist([...owners, { name, items: [] }]);
    setNewOwner(""); setAddingOwner(false);
  };
  const removeOwner = (idx) => { if (!window.confirm("Remove this owner's entries?")) return; persist(owners.filter((_, i) => i !== idx)); };

  const startAddItem = (ownerIdx) => { setAddingItemFor(ownerIdx); setEditingItem(null); setItemForm({ ticket: "", note: "", status: "today" }); };
  const addItem = (ownerIdx) => {
    const t = itemForm.ticket.trim(), n = itemForm.note.trim();
    if (!t && !n) return;
    const next = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: [...o.items, { ticket: t, note: n, status: itemForm.status }] });
    persist(next); setAddingItemFor(null); setItemForm({ ticket: "", note: "", status: "today" });
  };
  const startEditItem = (ownerIdx, itemIdx) => {
    setEditingItem({ ownerIdx, itemIdx }); setAddingItemFor(null);
    const item = owners[ownerIdx].items[itemIdx];
    setItemForm({ ticket: item.ticket || "", note: item.note || "", status: item.status || "today" });
  };
  const saveEditItem = () => {
    const { ownerIdx, itemIdx } = editingItem;
    const next = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: o.items.map((it, j) => j !== itemIdx ? it : { ticket: itemForm.ticket.trim(), note: itemForm.note.trim(), status: itemForm.status }) });
    persist(next); setEditingItem(null);
  };
  const removeItem = (ownerIdx, itemIdx) => {
    const next = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: o.items.filter((_, j) => j !== itemIdx) });
    persist(next);
  };

  const teammates = loadTeammates();

  return (
    <div className="echo-content fade-in">
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <input type="date" className="form-input" style={{ width: 160 }} value={date} onChange={e => loadDate(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={() => setAddingOwner(true)}>+ Add Owner</button>
        {teammates.length > 0 && !addingOwner && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {teammates.filter(t => !owners.some(o => o.name.toLowerCase() === t.name.toLowerCase())).map((t, i) => (
              <button key={i} className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
                onClick={() => persist([...owners, { name: t.name, items: [] }])}
              >{t.emoji || "👤"} {t.name}</button>
            ))}
          </div>
        )}
      </div>

      {addingOwner && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input autoFocus className="form-input" style={{ maxWidth: 220 }} placeholder="Owner name…" value={newOwner}
            onChange={e => setNewOwner(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addOwner(); if (e.key === "Escape") { setAddingOwner(false); setNewOwner(""); } }} />
          <button className="btn btn-primary btn-sm" onClick={addOwner}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAddingOwner(false); setNewOwner(""); }}>Cancel</button>
        </div>
      )}

      {owners.length === 0 && (
        <div style={{ textAlign: "center", color: T.text3, fontSize: 14, padding: "60px 0" }}>
          No release entries for {date}.<br />
          <span style={{ fontSize: 12 }}>Click "+ Add Owner" or use the team quick-add above.</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {owners.map((owner, oi) => (
          <div key={oi} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
            {/* Owner header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: `${T.accent}08`, borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 16 }}>👤</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: T.text1 }}>{owner.name}</span>
              <span style={{ fontSize: 12, color: T.text3 }}>{owner.items.length} item{owner.items.length !== 1 ? "s" : ""}</span>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => startAddItem(oi)}>+ Add</button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: T.coral }} onClick={() => removeOwner(oi)}>✕</button>
            </div>

            {/* Items */}
            <div style={{ padding: "8px 0" }}>
              {owner.items.length === 0 && addingItemFor !== oi && (
                <div style={{ padding: "12px 16px", fontSize: 12, color: T.text3, fontStyle: "italic" }}>No items yet. Click "+ Add" to log a ticket or note.</div>
              )}
              {owner.items.map((item, ii) => {
                const rs = RELEASE_STATUSES.find(s => s.key === item.status);
                const isEditing = editingItem?.ownerIdx === oi && editingItem?.itemIdx === ii;
                if (isEditing) {
                  return (
                    <div key={ii} style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, background: `${T.accent}06` }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input className="form-input" style={{ flex: 1 }} placeholder="Ticket / task (e.g. DN-1234)" value={itemForm.ticket}
                          onChange={e => setItemForm(f => ({ ...f, ticket: e.target.value }))} />
                        <select className="form-select" style={{ width: 140 }} value={itemForm.status} onChange={e => setItemForm(f => ({ ...f, status: e.target.value }))}>
                          {RELEASE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                        </select>
                      </div>
                      <textarea className="form-textarea" style={{ minHeight: 56, marginBottom: 8 }} placeholder="Release note / status detail…"
                        value={itemForm.note} onChange={e => setItemForm(f => ({ ...f, note: e.target.value }))} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={saveEditItem}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingItem(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={ii} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ fontSize: 15, marginTop: 1 }}>{rs?.icon || "📌"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {item.ticket && <div style={{ fontSize: 12, fontWeight: 600, color: T.text1, marginBottom: 2 }}>{item.ticket}</div>}
                      {item.note && <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.5 }}>{item.note}</div>}
                    </div>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: `${rs?.color || T.text3}18`, color: rs?.color || T.text3, border: `1px solid ${rs?.color || T.text3}40`, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {rs?.label || item.status}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11, flexShrink: 0 }} onClick={() => startEditItem(oi, ii)}>✏</button>
                    <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11, flexShrink: 0, color: T.coral }} onClick={() => removeItem(oi, ii)}>✕</button>
                  </div>
                );
              })}

              {/* Inline add item form */}
              {addingItemFor === oi && (
                <div style={{ padding: "10px 16px", background: `${T.accent}06` }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input autoFocus className="form-input" style={{ flex: 1 }} placeholder="Ticket / task (e.g. DN-1234 or description)" value={itemForm.ticket}
                      onChange={e => setItemForm(f => ({ ...f, ticket: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && addItem(oi)} />
                    <select className="form-select" style={{ width: 140 }} value={itemForm.status} onChange={e => setItemForm(f => ({ ...f, status: e.target.value }))}>
                      {RELEASE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                    </select>
                  </div>
                  <textarea className="form-textarea" style={{ minHeight: 56, marginBottom: 8 }} placeholder="Release note / status detail…"
                    value={itemForm.note} onChange={e => setItemForm(f => ({ ...f, note: e.target.value }))} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => addItem(oi)}>Add Item</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setAddingItemFor(null); setItemForm({ ticket: "", note: "", status: "today" }); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard",   label: "Dashboard",      icon: "🏠", section: "Overview" },
  { id: "diary",       label: "Corporate Diary", icon: "📓", dot: T.accent, section: "Modules" },
  { id: "locker",      label: "DigiLocker",      icon: "🗂️", dot: T.teal,   section: "Modules" },
  { id: "commitments", label: "Commitments",     icon: "🤝", dot: T.coral,  section: "Modules" },
  { id: "incidents",   label: "Incident Log",    icon: "🐛", dot: T.coral,  section: "Modules" },
  { id: "decisions",   label: "Decision Log",    icon: "🧠", dot: T.teal,   section: "Modules" },
  { id: "releases",   label: "Release Status",  icon: "🚀", dot: T.teal,   section: "Modules" },
  { id: "team",        label: "My Team",         icon: "👥", section: "Insights" },
  { id: "brag",        label: "Brag Doc",        icon: "🏆", dot: T.gold,   section: "Insights" },
  { id: "resume",      label: "Shadow Resume",   icon: "📋", dot: T.gold,   section: "Insights" },
  { id: "workmap",     label: "Work Map",        icon: "🕸️", dot: T.teal,   section: "Insights" },
  { id: "credits",     label: "Credit Tracker",  icon: "⭐", dot: T.gold,   section: "Insights" },
  { id: "resolve",     label: "Resolve",         icon: "🔥", dot: T.coral,  section: "Insights" },
];

const PAGE_META = {
  dashboard:   { title: "Dashboard",       sub: "Your personal command centre" },
  diary:       { title: "Corporate Diary", sub: "Daily work log — tickets, feedback, notes" },
  locker:      { title: "DigiLocker",      sub: "Secure document storage & retrieval" },
  commitments: { title: "Commitments",     sub: "What you owe and what others owe you — nothing leaks" },
  incidents:   { title: "Incident Log",    sub: "Escaped defects and prod issues — patterns over time" },
  decisions:   { title: "Decision Log",    sub: "Dated record of what was decided and why" },
  releases:    { title: "Release Status",  sub: "Track team ticket and release status by date" },
  team:        { title: "My Team",         sub: "Saved teammates for quick collaborator selection" },
  brag:        { title: "Brag Doc",        sub: "Your wins, tagged by impact — appraisal evidence on demand" },
  resume:      { title: "Shadow Resume",   sub: "Auto-built from your diary — your work in numbers" },
  workmap:     { title: "Work Map",        sub: "How your focus areas, collaborators and tickets connect" },
  credits:     { title: "Credit Tracker",  sub: "Log credit given and received — track the balance" },
  resolve:     { title: "Resolve",         sub: "Days you stayed strong — track habits you're breaking" },
};

export default function Echo() {
  useEffect(() => { injectStyles(); }, []);
  const [view, setView]               = useState(() => localStorage.getItem("echo_view") || "dashboard");
  const [diaryCount, setDiaryCount]   = useState(0);
  const [docCount, setDocCount]       = useState(0);
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [reminderEnabled, setReminderEnabled] = useState(() => localStorage.getItem("echo_reminder_on") === "true");
  const [reminderTime, setReminderTime]       = useState(() => localStorage.getItem("echo_reminder_time") || "17:30");
  const [padOpen, setPadOpen]                 = useState(false);
  const [showPatternInterrupt, setShowPatternInterrupt] = useState(false);
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [profileOpen, setProfileOpen]         = useState(false);
  const [displayName, setDisplayName]         = useState(() => localStorage.getItem("echo_display_name") || "");
  const [avatarData, setAvatarData]           = useState(() => localStorage.getItem("echo_avatar") || "");
  const [profileDraft, setProfileDraft]       = useState({ name: "", avatar: "" });

  useEffect(() => {
    db.auth.getUser().then(u => {
      if (u?.id) setUser(u);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
  }, []);

  useEffect(() => { localStorage.setItem("echo_view", view); }, [view]);

  useEffect(() => {
    if (!user) return;
    refreshTeammates();
    refreshScratchNotes(user.id);
  }, [user]);

  useEffect(() => {
    if (!user || !isConfigured()) return;
    db.from("diary_entries").select("id").then(rows => setDiaryCount((rows || []).length));
    db.from("documents").select("id").then(rows => setDocCount((rows || []).length));
  }, [user]);

  useEffect(() => {
    if (!user || !isConfigured()) return;
    const dismissed = localStorage.getItem("echo_pi_dismissed");
    if (dismissed && Date.now() - Number(dismissed) < 86400000) return;
    db.from("diary_entries").select("date,mood", { order: "date.desc" }).then(rows => {
      if (!rows || rows.length < 3) return;
      const badMoods = ["frustrated", "challenged"];
      let streak = 0;
      for (const e of rows.slice(0, 5)) {
        if (badMoods.includes(e.mood)) streak++;
        else break;
      }
      if (streak >= 3) setShowPatternInterrupt(true);
    });
  }, [user]);

  useEffect(() => {
    if (!reminderEnabled) return;
    const check = async () => {
      const now = new Date();
      const [h, m] = reminderTime.split(":").map(Number);
      if (now.getHours() !== h || now.getMinutes() !== m) return;
      const todayStr = now.toISOString().split("T")[0];
      if (localStorage.getItem("echo_last_notified") === todayStr) return;
      const rows = await db.from("diary_entries").select("id", { eq: ["date", todayStr] });
      if ((rows || []).length > 0) return;
      if (Notification.permission === "granted") {
        new Notification("Echo — time to log your day 📓", {
          body: "You haven't recorded today's diary entry yet.",
          icon: "/favicon.ico",
        });
        localStorage.setItem("echo_last_notified", todayStr);
      }
    };
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [reminderEnabled, reminderTime]);

  const openProfile = () => {
    setProfileDraft({ name: displayName, avatar: avatarData });
    setProfileOpen(true);
  };
  const saveProfile = () => {
    setDisplayName(profileDraft.name);
    setAvatarData(profileDraft.avatar);
    localStorage.setItem("echo_display_name", profileDraft.name);
    if (profileDraft.avatar) localStorage.setItem("echo_avatar", profileDraft.avatar);
    else localStorage.removeItem("echo_avatar");
    setProfileOpen(false);
  };
  const handleAvatarFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setProfileDraft(d => ({ ...d, avatar: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const logout = async () => {
    await db.auth.signOut();
    setUser(null);
    localStorage.removeItem("echo_view");
    setView("dashboard");
    setDiaryCount(0);
    setDocCount(0);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: T.navy0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ color: T.text3, fontSize: 14 }}>Loading…</div>
    </div>
  );

  if (!user) return <AuthPage onLogin={u => { setUser(u); }} />;

  const isOwner = user.email === OWNER_EMAIL;
  const visibleNav = NAV.filter(n => n.id !== "locker" || isOwner);
  const sections   = [...new Set(visibleNav.map(n => n.section))];

  return (
    <div className="echo-root">
      {/* Mobile backdrop — tap to close sidebar */}
      <div className={`mobile-overlay ${sidebarOpen ? "mob-open" : ""}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`echo-sidebar ${sidebarOpen ? "mob-open" : ""}`}>
        <div className="echo-logo">
          <EchoLogo size={32} withText dark />
          <div className="echo-logo-sub">Personal workspace</div>
        </div>

        <nav className="echo-nav">
          {sections.map(sec => (
            <div key={sec}>
              <div className="echo-nav-section">{sec}</div>
              {visibleNav.filter(n => n.section === sec).map(n => (
                <div key={n.id} className={`echo-nav-item ${view === n.id ? "active" : ""}`} onClick={() => { setView(n.id); setSidebarOpen(false); }}>
                  <span style={{ fontSize: 15 }}>{n.icon}</span>
                  <span>{n.label}</span>
                  {n.id === "diary" && diaryCount > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, background: "rgba(79,142,247,0.15)", color: T.accent, padding: "1px 7px", borderRadius: 10 }}>{diaryCount}</span>
                  )}
                  {n.id === "locker" && docCount > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, background: "rgba(63,207,180,0.15)", color: T.teal, padding: "1px 7px", borderRadius: 10 }}>{docCount}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="echo-sidebar-footer">
          <div onClick={openProfile} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "6px 8px", borderRadius: 8, marginBottom: 4, transition: "background 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${T.accent}30`, border: `1.5px solid ${T.accent}50`, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {avatarData
                ? <img src={avatarData} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: 13, color: T.accent, fontWeight: 700 }}>{(displayName || user.email || "?")[0].toUpperCase()}</span>
              }
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName || user.email.split("@")[0]}</div>
              <div style={{ fontSize: 10, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            </div>
          </div>
          {isOwner && <div style={{ fontSize: 10, color: T.teal, marginBottom: 4, paddingLeft: 8 }}>Owner</div>}

          {/* End-of-day reminder */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 0", borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, marginBottom: 8 }}>
            <span style={{ fontSize: 12 }} title="End-of-day diary reminder">🔔</span>
            <input
              type="time"
              value={reminderTime}
              onChange={e => { setReminderTime(e.target.value); localStorage.setItem("echo_reminder_time", e.target.value); }}
              style={{ flex: 1, background: "transparent", border: "none", color: reminderEnabled ? T.text2 : T.text3, fontSize: 11, fontFamily: "'DM Mono', monospace", outline: "none" }}
            />
            <button
              onClick={() => {
                if (!reminderEnabled && Notification.permission !== "granted") {
                  Notification.requestPermission().then(p => {
                    if (p === "granted") { setReminderEnabled(true); localStorage.setItem("echo_reminder_on", "true"); }
                  });
                } else {
                  const next = !reminderEnabled;
                  setReminderEnabled(next);
                  localStorage.setItem("echo_reminder_on", String(next));
                }
              }}
              style={{
                background: reminderEnabled ? T.teal : "transparent",
                border: `1px solid ${reminderEnabled ? T.teal : T.border}`,
                borderRadius: 4, color: reminderEnabled ? T.navy0 : T.text3,
                fontSize: 10, fontWeight: 600, padding: "2px 7px", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >{reminderEnabled ? "ON" : "OFF"}</button>
          </div>

          <button onClick={logout} style={{
            background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6,
            color: T.text3, cursor: "pointer", fontSize: 11, padding: "5px 12px",
            fontFamily: "'DM Sans', sans-serif", width: "100%",
          }}>Sign out</button>
        </div>
      </aside>

      <main className="echo-main">
        <div className="echo-topbar">
          <div style={{ display: "flex", alignItems: "center" }}>
            <button className="echo-hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>
            <div>
              <div className="echo-page-title">{PAGE_META[view]?.title}</div>
              <div className="echo-page-sub">{PAGE_META[view]?.sub}</div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: T.text3 }}>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>

        {view === "dashboard"   && <Dashboard setView={setView} diaryCount={diaryCount} docCount={docCount} user={user} />}
        {view === "diary"       && <Diary onCountChange={setDiaryCount} user={user} />}
        {view === "locker"      && isOwner && <DigiLocker onCountChange={setDocCount} />}
        {view === "locker"      && !isOwner && (
          <div style={{ padding: 40, textAlign: "center", color: T.text3 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16 }}>DigiLocker is private.</div>
          </div>
        )}
        {view === "commitments" && <Commitments user={user} />}
        {view === "incidents"   && <IncidentLog user={user} />}
        {view === "decisions"   && <DecisionLog user={user} />}
        {view === "releases"    && <ReleaseTracker />}
        {view === "team"        && <MyTeam user={user} />}
        {view === "brag"        && <BragDoc />}
        {view === "resume"      && <ShadowResume />}
        {view === "workmap"     && <WorkMap />}
        {view === "credits"     && <CreditTracker user={user} />}
        {view === "resolve"     && <Resolve user={user} />}
      </main>

      {/* ── Pattern Interrupt overlay ── */}
      {showPatternInterrupt && (
        <PatternInterrupt onDismiss={() => {
          setShowPatternInterrupt(false);
          localStorage.setItem("echo_pi_dismissed", String(Date.now()));
        }} user={user} />
      )}

      {/* ── Floating Scratch Pad ── */}
      {padOpen && <ScratchPad onClose={() => setPadOpen(false)} user={user} />}

      {/* ── Profile Modal ── */}
      {profileOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setProfileOpen(false)}
          style={{ zIndex: 10001 }}>
          <div className="modal-box" style={{ maxWidth: 380, width: "90%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Edit Profile</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setProfileOpen(false)}>✕</button>
            </div>
            {/* Avatar */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <label htmlFor="avatar-upload" style={{ cursor: "pointer", position: "relative" }}>
                <div style={{ width: 80, height: 80, borderRadius: "50%", background: `${T.accent}25`, border: `2px solid ${T.accent}50`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {profileDraft.avatar
                    ? <img src={profileDraft.avatar} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 28, color: T.accent, fontWeight: 700 }}>{(profileDraft.name || user.email || "?")[0].toUpperCase()}</span>
                  }
                </div>
                <div style={{ position: "absolute", bottom: 0, right: 0, width: 24, height: 24, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>📷</div>
              </label>
              <input id="avatar-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarFile} />
              <div style={{ fontSize: 11, color: T.text3 }}>Click to upload photo</div>
              {profileDraft.avatar && (
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, color: T.coral }} onClick={() => setProfileDraft(d => ({ ...d, avatar: "" }))}>Remove photo</button>
              )}
            </div>
            {/* Display name */}
            <div style={{ marginBottom: 14 }}>
              <div className="diary-section-heading" style={{ marginBottom: 6 }}>Display name</div>
              <input className="form-input" placeholder="Your name (shown in sidebar)"
                value={profileDraft.name}
                onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            {/* Email (read-only) */}
            <div style={{ marginBottom: 20 }}>
              <div className="diary-section-heading" style={{ marginBottom: 6 }}>Email</div>
              <input className="form-input" value={user.email} readOnly style={{ opacity: 0.5, cursor: "not-allowed" }} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={saveProfile}>Save Profile</button>
          </div>
        </div>
      )}

      <button
        onClick={() => setPadOpen(o => !o)}
        title="Scratch Pad"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          width: 48, height: 48, borderRadius: "50%",
          background: padOpen ? T.accent : `linear-gradient(135deg, ${T.accentDim}, ${T.accent})`,
          border: `2px solid ${padOpen ? T.accent : T.accentDim}`,
          boxShadow: `0 4px 20px ${T.accentGlow}`,
          color: "#fff", fontSize: 20, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.2s ease",
        }}
      >
        {padOpen ? "✕" : "📝"}
      </button>
    </div>
  );
}
