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
      if (opts.match) Object.entries(opts.match).forEach(([k, v]) => { url += `&${k}=eq.${encodeURIComponent(v)}`; });
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
      let r = await fetch(`${_REST()}/${table}`, {
        method: "POST",
        headers: { ...h(), Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      if (r.status === 401) {
        await _refreshToken();
        r = await fetch(`${_REST()}/${table}`, {
          method: "POST",
          headers: { ...h(), Prefer: "return=representation" },
          body: JSON.stringify(data),
        });
      }
      const text = await r.text();
      try { return text ? JSON.parse(text) : {}; } catch { return {}; }
    },
    update: async (data, id) => {
      let r = await fetch(`${_REST()}/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...h(), Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      if (r.status === 401) {
        await _refreshToken();
        r = await fetch(`${_REST()}/${table}?id=eq.${id}`, {
          method: "PATCH",
          headers: { ...h(), Prefer: "return=representation" },
          body: JSON.stringify(data),
        });
      }
      const text = await r.text();
      try { return text ? JSON.parse(text) : {}; } catch { return {}; }
    },
    delete: async (id) => {
      await fetch(`${_REST()}/${table}?id=eq.${id}`, { method: "DELETE", headers: h() });
    },
    upsert: async (data, onConflict) => {
      const qs = onConflict ? `?on_conflict=${onConflict}` : "";
      let r = await fetch(`${_REST()}/${table}${qs}`, {
        method: "POST",
        headers: { ...h(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(data),
      });
      if (r.status === 401) {
        await _refreshToken();
        r = await fetch(`${_REST()}/${table}${qs}`, {
          method: "POST",
          headers: { ...h(), Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(data),
        });
      }
      const text = await r.text();
      try { return text ? JSON.parse(text) : {}; } catch { return {}; }
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

// ─── release_logs table probe ────────────────────────────────────────────────
let _rlCheck = null;
let _rlSupported = null;
const probeReleaseTable = () => {
  if (_rlSupported !== null) return Promise.resolve(_rlSupported);
  if (_rlCheck) return _rlCheck;
  _rlCheck = fetch(`${_REST()}/release_logs?select=id&limit=0`, { headers: h() })
    .then(r => { _rlSupported = r.ok; return r.ok; })
    .catch(() => { _rlSupported = false; return false; })
    .finally(() => { _rlCheck = null; });
  return _rlCheck;
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

let _uidDiaryCheck = null;
let _uidDiarySupported = null;
const probeUserIdDiary = () => {
  if (_uidDiarySupported !== null) return Promise.resolve(_uidDiarySupported);
  if (_uidDiaryCheck) return _uidDiaryCheck;
  _uidDiaryCheck = fetch(`${_REST()}/diary_entries?select=user_id&limit=0`, { headers: h() })
    .then(r => { _uidDiarySupported = r.ok; return r.ok; })
    .catch(() => { _uidDiarySupported = false; return false; })
    .finally(() => { _uidDiaryCheck = null; });
  return _uidDiaryCheck;
};

let _dueDateCheck = null;
let _dueDateSupported = null;
const probeCommitmentDueDate = () => {
  if (_dueDateSupported !== null) return Promise.resolve(_dueDateSupported);
  if (_dueDateCheck) return _dueDateCheck;
  _dueDateCheck = fetch(`${_REST()}/commitments?select=due_date&limit=0`, { headers: h() })
    .then(r => { _dueDateSupported = r.ok; return r.ok; })
    .catch(() => { _dueDateSupported = false; return false; })
    .finally(() => { _dueDateCheck = null; });
  return _dueDateCheck;
};

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || "";
// Non-person words the AI sometimes wrongly extracts as collaborator names
const _NAME_BLOCKLIST = new Set([
  "team","everyone","all","management","midnight","morning","evening","afternoon","night",
  "dev","devs","developer","developers","engineer","engineers","qa","qas","tester","testers",
  "stakeholder","stakeholders","client","clients","user","users","channel","slack","jira",
  "github","standup","scrum","sprint","meeting","group","cross","functional","product",
  "business","ops","support","infra","backend","frontend","mobile","web","platform",
]);

async function callGroq(bullets, knownPeople = []) {
  if (!bullets.length) return null;
  if (!GROQ_API_KEY) throw new Error("AI categorisation is not configured — REACT_APP_GROQ_API_KEY is missing from the build.");
  const teamCtx = knownPeople.length
    ? `Known team members — use exact spellings if they appear: ${knownPeople.join(", ")}.`
    : "";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `You are a professional work diary assistant for a QA engineer. Process each work item and return a single JSON object.

ATOMIC RULE (most important): Each numbered item is ONE indivisible unit. Assign the ENTIRE item to exactly ONE category. Do NOT split an item at dashes, semicolons, commas, or conjunctions — the text after a dash is a qualifier, not a separate item. Never produce more category entries than input items.

CATEGORIES — assign each item to exactly one (pick the PRIMARY work type):
- validation: test execution, test case design, bug filing, regression, smoke/sanity testing, exploratory testing, verifying a fix, signoff, QA review, reviewing a PR for quality
- meeting: standups, 1:1s, planning sessions, catch-ups, calls, syncs, discussions with named people
- execution: writing test plans, automation scripts, documentation, configuring tools, deployments, investigations
- other: admin tasks, reading docs, unclear items

REWRITE RULES (for the text inside each category array):
- Include the FULL original item text (including any sub-clauses after dashes)
- Use past tense, professional English
- Keep ALL proper nouns, product names, system names, tool names, and ticket IDs EXACTLY as written — do not paraphrase them
- Fix grammar only — do not add context, expand abbreviations, or invent detail not in the original
- QA terms (regression, smoke, sanity, signoff, UAT, bug) must remain unchanged

PERSON EXTRACTION — "people" array rules (STRICT):
- Include ONLY individual human names: first names or full names (e.g. "Nitish", "Muzammil Shaikh")
- ${teamCtx}
- EXCLUDE: group nouns (team, everyone, devs, stakeholders, management), role labels (dev, QA, engineer), time words (midnight, morning), tool/product names, company names, anything starting with lowercase

Return ONLY valid JSON, no explanation: {"validation":[],"meeting":[],"execution":[],"other":[],"people":[]}` },
        { role: "user", content: `Work items:\n${bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}` }
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
  // Filter people: must be a proper noun (starts with uppercase) and not in the blocklist
  if (Array.isArray(parsed.people)) {
    parsed.people = parsed.people.filter(p => {
      if (!p || p.length < 2) return false;
      if (_NAME_BLOCKLIST.has(p.trim().toLowerCase())) return false;
      // Must start with an uppercase letter (proper noun)
      if (!/^[A-Z]/.test(p.trim())) return false;
      // Reject single characters or purely numeric strings
      if (/^[^a-zA-Z]/.test(p.trim())) return false;
      return true;
    });
  }
  return parsed;
}

// AI insight — generates a work reflection from recent diary entries
async function callGroqInsight(entries) {
  if (!GROQ_API_KEY || !entries.length) return null;
  const summary = entries.slice(0, 7).map(e => {
    const parts = [];
    if (e.content) parts.push(e.content.split("\n").filter(Boolean).slice(0, 3).join("; "));
    if (e.mood) parts.push(`mood: ${e.mood}`);
    if (e.is_win) parts.push("marked as a win");
    if (e.blockers) parts.push(`blocker: ${e.blockers}`);
    return `${e.date}: ${parts.join(" | ")}`;
  }).join("\n");
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: "You are a professional work coach. Given a person's recent diary entries, write 2-3 sentences of insightful reflection. Focus on patterns, strengths, and one forward-looking suggestion. Be specific and encouraging. Do not use generic platitudes. Write in second person (you). Max 80 words." },
          { role: "user", content: `Recent work diary entries:\n${summary}` }
        ],
        temperature: 0.7,
        max_tokens: 150,
      })
    });
    const json = await res.json();
    if (!res.ok) return null;
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
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
      ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: T.accent, wordBreak: "break-all" }}>{part}</a>
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
// create table release_logs (id uuid primary key default gen_random_uuid(), user_id uuid not null, release_date date not null, owners jsonb default '[]', updated_at timestamptz default now(), unique(user_id, release_date)); alter table release_logs enable row level security; create policy "own" on release_logs for all using (auth.uid()=user_id);

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
  amber: "#F5C243",
  violet: "#7B6EF6",
  red: "#FF3B30",
  emerald: "#4CAF50",
  muted: "#9A99AD",
  accent2: "#A89BF8",
  white: "#ffffff",
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

    .modal-box {
      background: ${T.navy1};
      border: 1px solid ${T.border};
      border-radius: 16px;
      padding: 28px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
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

    /* ── Page title — Syne font, stronger weight ── */
    .echo-page-title {
      font-family: 'Syne', sans-serif;
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }

    /* ── Modal entrance animation ── */
    @keyframes modalEnter {
      from { opacity: 0; transform: scale(0.96) translateY(6px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .modal     { animation: modalEnter 0.22s cubic-bezier(0.34, 1.3, 0.64, 1); }
    .modal-box { animation: modalEnter 0.22s cubic-bezier(0.34, 1.3, 0.64, 1); }

    /* ── Toast notifications ── */
    @keyframes toastIn  {
      from { opacity: 0; transform: translateX(14px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes toastOut {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to   { opacity: 0; transform: translateX(14px) scale(0.97); }
    }
    .echo-toast-wrap {
      position: fixed; bottom: 82px; right: 24px;
      display: flex; flex-direction: column; gap: 8px;
      z-index: 99999; pointer-events: none;
    }
    .echo-toast {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 16px; border-radius: 10px;
      font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      animation: toastIn 0.25s cubic-bezier(0.34, 1.3, 0.64, 1);
      pointer-events: all; backdrop-filter: blur(12px);
      min-width: 180px; max-width: 340px;
    }
    .echo-toast-icon { font-size: 13px; flex-shrink: 0; line-height: 1; font-weight: 700; }
    .echo-toast.success { background: rgba(10,14,26,0.96); border: 1px solid rgba(78,203,141,0.45); color: ${T.green}; }
    .echo-toast.error   { background: rgba(10,14,26,0.96); border: 1px solid rgba(240,117,98,0.45); color: ${T.coral}; }
    .echo-toast.info    { background: rgba(10,14,26,0.96); border: 1px solid ${T.borderHover}; color: ${T.text2}; }
    .echo-toast.warning { background: rgba(10,14,26,0.96); border: 1px solid rgba(245,194,67,0.45); color: ${T.amber}; }
    .echo-toast.exiting { animation: toastOut 0.22s ease forwards; }

    /* ── Stat card hover ── */
    .stat-card {
      transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
      cursor: default;
    }
    .stat-card:hover {
      border-color: ${T.borderHover};
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.22);
    }
    .stat-value { font-size: 30px; }

    /* ── Nav active state — left accent bar (Linear-style) ── */
    .echo-nav-item { position: relative; }
    .echo-nav-item.active::before {
      content: '';
      position: absolute;
      left: -12px; top: 50%; transform: translateY(-50%);
      height: 16px; width: 3px;
      border-radius: 0 3px 3px 0;
      background: ${T.accent};
    }

    /* ── Nav shortcut key hints ── */
    .nav-hint {
      margin-left: auto; opacity: 0;
      font-size: 10px; color: ${T.text3};
      background: ${T.navy4}; border: 1px solid ${T.border};
      border-radius: 4px; padding: 1px 5px;
      font-family: 'DM Mono', monospace;
      transition: opacity 0.15s;
      flex-shrink: 0; line-height: 1.5;
    }
    .echo-nav-item:hover .nav-hint { opacity: 1; }
    .echo-nav-item.active .nav-hint { opacity: 0 !important; }

    /* ── Nav SVG icon ── */
    .echo-nav-icon {
      flex-shrink: 0; opacity: 0.6;
      transition: opacity 0.15s;
    }
    .echo-nav-item:hover .echo-nav-icon,
    .echo-nav-item.active .echo-nav-icon { opacity: 1; }

    /* ── Loading animation ── */
    .echo-loading-dots { display: flex; gap: 6px; align-items: center; }
    @keyframes echoLoadPulse {
      0%, 100% { opacity: 0.25; transform: scale(0.85); }
      50%       { opacity: 1;    transform: scale(1.05); }
    }
    .echo-loading-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: ${T.accent};
      animation: echoLoadPulse 1.2s ease-in-out infinite;
    }
    .echo-loading-dot:nth-child(2) { animation-delay: 0.18s; }
    .echo-loading-dot:nth-child(3) { animation-delay: 0.36s; }

    /* ── Topbar divider ── */
    .topbar-divider {
      width: 1px; height: 18px; border-radius: 2px;
      background: ${T.border}; margin: 0 2px; flex-shrink: 0;
    }

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

// ─── Diary Entry Templates ────────────────────────────────────────────────────
const DIARY_TEMPLATES = [
  {
    key: "standup",
    label: "Standup",
    icon: "📋",
    content: ["Yesterday: ", "Today: "],
    blockers: "Blocked by: ",
  },
  {
    key: "meeting",
    label: "Meeting",
    icon: "🤝",
    content: ["Meeting: ", "Attendees: ", "Decision: ", "Action: "],
  },
  {
    key: "eod",
    label: "End of Day",
    icon: "🌙",
    content: ["Completed: ", "Pending: ", "Tomorrow: "],
    blockers: "Blocked by: ",
  },
];

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
  { key: "released", label: "Released",    icon: "✅", color: T.emerald },
  { key: "today",    label: "Today",       icon: "🚀", color: T.teal    },
  { key: "tomorrow", label: "Tomorrow",    icon: "🌅", color: T.violet  },
  { key: "review",   label: "In Review",   icon: "🔄", color: T.accent  },
  { key: "eta",      label: "ETA Pending", icon: "⏳", color: T.amber   },
  { key: "nextweek", label: "Next Week",   icon: "🗓️", color: T.text2   },
  { key: "blocked",  label: "Blocked",     icon: "🔴", color: T.coral   },
  { key: "leave",    label: "On Leave",    icon: "🏖️", color: T.text3   },
];

// attendance options shown on each owner card and included in the copy report
const OWNER_ATT = [
  { key: "wfh",  label: "WFH",      icon: "🏠", color: T.accent },
  { key: "half", label: "Half Day", icon: "🌓", color: T.amber  },
  { key: "leave",label: "On Leave", icon: "🏖️", color: T.coral  },
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

// ─── Navigation SVG Icons ────────────────────────────────────────────────────
function NavIcon({ id, size = 15 }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" };
  const shapes = {
    dashboard:   <><rect key="a" x="2" y="2" width="5" height="5" rx="1" {...p}/><rect key="b" x="9" y="2" width="5" height="5" rx="1" {...p}/><rect key="c" x="2" y="9" width="5" height="5" rx="1" {...p}/><rect key="d" x="9" y="9" width="5" height="5" rx="1" {...p}/></>,
    diary:       <><path key="a" d="M5 2h7a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" {...p}/><path key="b" d="M7 5.5h3M7 8h3M7 10.5h2" {...p}/><line key="c" x1="4" y1="2" x2="4" y2="14" {...p}/></>,
    locker:      <><path key="a" d="M11.5 7H4.5A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11.5 7Z" {...p}/><path key="b" d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" {...p}/><circle key="c" cx="8" cy="10.5" r="1" fill="currentColor" stroke="none"/></>,
    commitments: <><rect key="a" x="3" y="4" width="10" height="10" rx="1.5" {...p}/><path key="b" d="M5.5 2.5v2M10.5 2.5v2" {...p}/><path key="c" d="M5.5 9l1.5 1.5 3.5-3.5" {...p}/></>,
    incidents:   <><path key="a" d="M8 2.5 1.5 13.5h13L8 2.5Z" {...p}/><path key="b" d="M8 7v3" {...p}/><circle key="c" cx="8" cy="11.5" r="0.75" fill="currentColor" stroke="none"/></>,
    decisions:   <><circle key="a" cx="8" cy="8" r="3.5" {...p}/><path key="b" d="M8 1.5V4.5M8 11.5V14.5M1.5 8H4.5M11.5 8H14.5" {...p}/></>,
    releases:    <><path key="a" d="M8 2.5v9M4.5 6 8 2.5 11.5 6" {...p}/><path key="b" d="M3 13.5h10" {...p}/></>,
    team:        <><circle key="a" cx="6" cy="5.5" r="2" {...p}/><path key="b" d="M1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" {...p}/><circle key="c" cx="11.5" cy="5.5" r="1.5" {...p}/><path key="d" d="M11.5 9.5c2 .3 3 1.5 3 3.5" {...p}/></>,
    brag:        <><path key="a" d="M8 1.5 9.7 5.5l4.2.6-3 2.9.7 4.2L8 11l-3.6 2.2.7-4.2-3-2.9 4.2-.6L8 1.5Z" {...p}/></>,
    resume:      <><rect key="a" x="2.5" y="1.5" width="11" height="13" rx="1.5" {...p}/><path key="b" d="M5.5 5h5M5.5 8h5M5.5 11h3" {...p}/></>,
    workmap:     <><circle key="a" cx="3.5" cy="8" r="1.5" {...p}/><circle key="b" cx="12.5" cy="3.5" r="1.5" {...p}/><circle key="c" cx="12.5" cy="12.5" r="1.5" {...p}/><circle key="d" cx="8" cy="8" r="1.5" {...p}/><path key="e" d="M5 8h1.5M9.5 8l1.7-3M9.5 8l1.7 3" {...p}/></>,
    credits:     <><path key="a" d="M8 2 9.5 5.5l3.8.6-2.7 2.6.6 3.7L8 10.5l-3.2 1.9.6-3.7L2.7 6.1l3.8-.6L8 2Z" {...p}/></>,
    resolve:     <><path key="a" d="M8 1.5c.3 2.2-2.5 4-2.5 6.5a2.5 2.5 0 005 0C10.5 5.5 7.7 3.7 8 1.5Z" {...p}/><path key="b" d="M6.5 11.5c.3.8.9 1.5 1.5 1.5" {...p}/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="echo-nav-icon" aria-hidden="true" style={{ display: "block" }}>
      {shapes[id] || null}
    </svg>
  );
}

// ─── Toast System ─────────────────────────────────────────────────────────────
let _toastSeq = 0;
const _toastBus = { cbs: [] };
const toast = (msg, type = "success", dur = 3000) => {
  const id = ++_toastSeq;
  _toastBus.cbs.forEach(fn => fn({ id, msg, type, dur }));
};

function ToastContainer() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = (t) => {
      setItems(prev => [...prev, { ...t, exiting: false }]);
      setTimeout(() => {
        setItems(prev => prev.map(x => x.id === t.id ? { ...x, exiting: true } : x));
        setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), 240);
      }, t.dur);
    };
    _toastBus.cbs.push(add);
    return () => { _toastBus.cbs = _toastBus.cbs.filter(f => f !== add); };
  }, []);
  if (!items.length) return null;
  const ICONS = { success: "✓", error: "✕", warning: "⚠", info: "·" };
  return (
    <div className="echo-toast-wrap">
      {items.map(t => (
        <div key={t.id} className={`echo-toast ${t.type}${t.exiting ? " exiting" : ""}`}>
          <span className="echo-toast-icon">{ICONS[t.type] || "·"}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ setView, diaryCount, docCount, user, displayName = "" }) {
  const [recentEntries, setRecentEntries] = useState([]);
  const [heatEntries, setHeatEntries]     = useState([]);
  const [recentDocs, setRecentDocs]       = useState([]);
  const [onThisDay, setOnThisDay]         = useState({ week: null, month: null, quarter: null, year: null });
  const [openCommitCount, setOpenCommitCount] = useState(null);
  const [allCommits, setAllCommits]       = useState([]);
  const [teamPulse, setTeamPulse]         = useState(null);
  const [aiInsight, setAiInsight]         = useState(() => {
    try { const c = JSON.parse(localStorage.getItem("echo_ai_insight") || "null"); return c?.date === new Date().toISOString().slice(0, 10) ? c.text : null; } catch { return null; }
  });
  const [aiLoading, setAiLoading]         = useState(false);
  const [weeklyModal, setWeeklyModal]     = useState(false);
  const [calMonth, setCalMonth]           = useState(() => new Date().toISOString().slice(0, 7));
  const [calSelected, setCalSelected]     = useState(null);
  const [calEntry, setCalEntry]           = useState(null);

  useEffect(() => {
    if (!isConfigured()) return;
    probeUserIdDiary().then(uidOk => {
      const dOpts = { order: "date.desc" };
      if (uidOk && user?.id) dOpts.match = { user_id: user.id };
      db.from("diary_entries").select("*", dOpts).then(d => {
        setRecentEntries((d || []).slice(0, 3));
        setHeatEntries(d || []);
      });
      const offsetDay = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
      const wStr = offsetDay(7); const mStr = offsetDay(30); const qStr = offsetDay(90); const yStr = offsetDay(365);
      const uid = uidOk && user?.id ? { user_id: user.id } : {};
      db.from("diary_entries").select("*", { eq: ["date", wStr], match: uid }).then(d => { if (d?.[0]) setOnThisDay(prev => ({ ...prev, week: d[0] })); });
      db.from("diary_entries").select("*", { eq: ["date", mStr], match: uid }).then(d => { if (d?.[0]) setOnThisDay(prev => ({ ...prev, month: d[0] })); });
      db.from("diary_entries").select("*", { eq: ["date", qStr], match: uid }).then(d => { if (d?.[0]) setOnThisDay(prev => ({ ...prev, quarter: d[0] })); });
      db.from("diary_entries").select("*", { eq: ["date", yStr], match: uid }).then(d => { if (d?.[0]) setOnThisDay(prev => ({ ...prev, year: d[0] })); });
    });
    db.from("documents").select("*", { order: "created_at.desc" }).then(d => setRecentDocs((d || []).slice(0, 4)));
    db.from("commitments").select("*", { order: "inserted_at.asc" }).then(rows => {
      const arr = rows || [];
      setAllCommits(arr);
      setOpenCommitCount(arr.filter(r => !r.resolved_at).length);
    });

    const members = (loadTeammates() || []).filter(t => (t.relationship || "direct") === "direct");
    if (members.length) {
      const monthStart = new Date().toISOString().slice(0, 7) + "-01";
      fetch(`${_REST()}/one_on_one_sessions?select=teammate_id&session_date=gte.${monthStart}`, { headers: h() })
        .then(r => r.ok ? r.json() : [])
        .then(rows => {
          const done = new Set((rows || []).map(s => s.teammate_id));
          setTeamPulse({ total: members.length, done: members.filter(m => done.has(m.id)).length });
        }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const diaryStreak = (() => {
    if (!heatEntries.length) return 0;
    const dates = new Set(heatEntries.map(e => e.date));
    // Work entirely with UTC date strings — dates are stored via toISOString() (UTC)
    // so local-midnight Date objects would shift the date in non-UTC timezones
    const getDow  = (s) => new Date(s + "T00:00:00Z").getUTCDay(); // 0=Sun, 6=Sat
    const isWknd  = (s) => { const w = getDow(s); return w === 0 || w === 6; };
    const prevDay = (s) => {
      const d = new Date(s + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    };

    // Start from today's UTC date (same representation as stored dates)
    let d = new Date().toISOString().slice(0, 10);
    while (isWknd(d)) d = prevDay(d);

    // If today's nearest weekday has no entry yet (still mid-day) — check previous weekday
    if (!dates.has(d)) {
      d = prevDay(d);
      while (isWknd(d)) d = prevDay(d);
    }

    // Count consecutive weekdays with entries going backward (weekends transparent)
    let count = 0;
    while (true) {
      while (isWknd(d)) d = prevDay(d);
      if (!dates.has(d)) break;
      count++;
      d = prevDay(d);
    }
    return count;
  })();

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: T.text1 }}>{greeting}{displayName ? `, ${displayName.split(" ")[0]}` : ""}</div>
          {diaryStreak >= 2 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              background: `${T.coral}15`, border: `1px solid ${T.coral}40`,
              borderRadius: 20, padding: "3px 12px", fontSize: 13, fontWeight: 700, color: T.coral,
            }} title="Consecutive days with a diary entry">
              🔥 {diaryStreak} day streak
            </div>
          )}
        </div>
        <div style={{ fontSize: 14, color: T.text3, marginBottom: 16 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
        {/* Quick Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "+ Log Today", color: T.accent, bg: `${T.accent}18`, border: `${T.accent}40`, action: () => { setView("diary"); localStorage.setItem("echo_diary_new", "1"); } },
            { label: "+ Commitment", color: T.teal, bg: `${T.teal}12`, border: `${T.teal}35`, action: () => setView("commitments") },
            { label: "+ Decision", color: T.violet, bg: `${T.violet}12`, border: `${T.violet}35`, action: () => setView("decisions") },
            { label: "📋 Weekly Update", color: T.gold, bg: `${T.gold}12`, border: `${T.gold}35`, action: () => setWeeklyModal(true) },
          ].map(q => (
            <button key={q.label} onClick={q.action} style={{
              flex: "1 1 120px", padding: "9px 14px", borderRadius: 10,
              background: q.bg, border: `1px solid ${q.border}`, color: q.color,
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              transition: "opacity 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
              onMouseLeave={e => e.currentTarget.style.opacity = "1"}
            >{q.label}</button>
          ))}
        </div>
      </div>

      {/* ── Productivity Pulse ── */}
      {(() => {
        const todayMonth = new Date().toISOString().slice(0, 7);
        const entriesThisMonth = heatEntries.filter(e => e.date?.startsWith(todayMonth));
        const winsThisMonth = entriesThisMonth.filter(e => e.is_win).length;
        const totalCommits = allCommits.length;
        const resolvedCommits = allCommits.filter(c => !!c.resolved_at).length;
        const richEntries = entriesThisMonth.filter(e => e.mood && e.content?.trim()).length;

        // Working days this month so far
        const now = new Date();
        let workingDays = 0;
        for (let d = 1; d <= now.getDate(); d++) {
          const dow = new Date(now.getFullYear(), now.getMonth(), d).getDay();
          if (dow !== 0 && dow !== 6) workingDays++;
        }

        const streakPts    = Math.min(diaryStreak * 3, 30);
        const winPts       = entriesThisMonth.length > 0 ? Math.round((winsThisMonth / entriesThisMonth.length) * 20) : 0;
        const commitPts    = totalCommits > 0 ? Math.round((resolvedCommits / totalCommits) * 25) : 15;
        const qualityPts   = entriesThisMonth.length > 0 ? Math.round((richEntries / entriesThisMonth.length) * 15) : 0;
        const consistencyPts = workingDays > 0 ? Math.round(Math.min(entriesThisMonth.length / workingDays, 1) * 10) : 0;
        const score = Math.min(streakPts + winPts + commitPts + qualityPts + consistencyPts, 100);

        const scoreColor = score >= 80 ? T.teal : score >= 60 ? T.gold : T.coral;
        const scoreLabel = score >= 90 ? "Peak Performance" : score >= 75 ? "Strong momentum" : score >= 60 ? "Building well" : score >= 40 ? "Developing" : "Getting started";
        const circumference = 2 * Math.PI * 28;
        const dashOffset = circumference * (1 - score / 100);

        return (
          <div className="card mb-16" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
                <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="36" cy="36" r="28" fill="none" stroke={`${scoreColor}20`} strokeWidth="6" />
                  <circle cx="36" cy="36" r="28" fill="none" stroke={scoreColor} strokeWidth="6"
                    strokeDasharray={circumference} strokeDashoffset={dashOffset}
                    strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>{score}</div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.text1 }}>Productivity Pulse</div>
                <div style={{ fontSize: 13, color: scoreColor, fontWeight: 600, marginTop: 2 }}>{scoreLabel}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                  {[
                    { label: "Streak", val: streakPts, max: 30, color: T.coral },
                    { label: "Quality", val: qualityPts + consistencyPts, max: 25, color: T.teal },
                    { label: "Wins", val: winPts, max: 20, color: T.gold },
                    { label: "Commitments", val: commitPts, max: 25, color: T.accent },
                  ].map(bar => (
                    <div key={bar.label} style={{ minWidth: 80 }}>
                      <div style={{ fontSize: 9, color: T.text3, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{bar.label}</div>
                      <div style={{ height: 4, background: `${bar.color}20`, borderRadius: 2, position: "relative" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(bar.val / bar.max) * 100}%`, background: bar.color, borderRadius: 2, transition: "width 0.8s ease" }} />
                      </div>
                      <div style={{ fontSize: 9, color: bar.color, marginTop: 2 }}>{bar.val}/{bar.max}</div>
                    </div>
                  ))}
                </div>
              </div>
              {teamPulse && (
                <div style={{ flexShrink: 0, textAlign: "center", borderLeft: `1px solid ${T.border}`, paddingLeft: 20 }}>
                  <div style={{ fontSize: 11, color: T.text3, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Team Pulse</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: teamPulse.done === teamPulse.total ? T.teal : teamPulse.done > 0 ? T.gold : T.coral }}>
                    {teamPulse.done}/{teamPulse.total}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3 }}>1:1s this month</div>
                  <div style={{ marginTop: 4, fontSize: 10, color: teamPulse.done === teamPulse.total ? T.teal : T.text3 }}>
                    {teamPulse.done === teamPulse.total ? "✓ All done" : `${teamPulse.total - teamPulse.done} pending`}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* ── Monthly Diary Calendar ── */}
      {(() => {
        const [yr, mo] = calMonth.split("-").map(Number);
        const firstDow = new Date(yr, mo - 1, 1).getDay();
        const totalDays = new Date(yr, mo, 0).getDate();
        const monthLabel = new Date(yr, mo - 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        const todayStr = new Date().toISOString().split("T")[0];
        const shiftMo = (n) => {
          const d = new Date(yr, mo - 1 + n, 1);
          setCalMonth(d.toISOString().slice(0, 7));
        };
        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push(null);
        for (let d = 1; d <= totalDays; d++) cells.push(`${calMonth}-${String(d).padStart(2, "0")}`);
        const moodColor = { productive: T.green, resolved: T.teal, collaborative: T.accent, challenged: T.gold, frustrated: T.coral };
        const entriesThisMonth = heatEntries.filter(e => e.date?.startsWith(calMonth));
        const winsThisMonth = entriesThisMonth.filter(e => e.is_win).length;
        return (
          <div className="card mb-16" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>📅 Diary Calendar</div>
                {entriesThisMonth.length > 0 && (
                  <span style={{ fontSize: 11, color: T.text3 }}>
                    {entriesThisMonth.length} entr{entriesThisMonth.length !== 1 ? "ies" : "y"}
                    {winsThisMonth > 0 && <span style={{ color: T.gold, marginLeft: 6 }}>· 🏆 {winsThisMonth} win{winsThisMonth !== 1 ? "s" : ""}</span>}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => shiftMo(-1)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text2, cursor: "pointer", padding: "3px 10px", fontSize: 14 }}>‹</button>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.text1, minWidth: 120, textAlign: "center" }}>{monthLabel}</span>
                <button onClick={() => shiftMo(1)} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text2, cursor: "pointer", padding: "3px 10px", fontSize: 14 }}>›</button>
                {calMonth !== new Date().toISOString().slice(0, 7) && (
                  <button onClick={() => { setCalMonth(new Date().toISOString().slice(0, 7)); setCalSelected(null); setCalEntry(null); }}
                    style={{ background: `${T.accent}14`, border: `1px solid ${T.accent}30`, borderRadius: 6, color: T.accent, cursor: "pointer", padding: "3px 9px", fontSize: 11, fontWeight: 600 }}>Today</button>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <div key={i} style={{ textAlign: "center", fontSize: 9, color: T.text3, fontWeight: 600, padding: "2px 0", letterSpacing: 0.5, textTransform: "uppercase" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
              {cells.map((dateStr, i) => {
                if (!dateStr) return <div key={i} />;
                const entry = heatEntries.find(e => e.date === dateStr);
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === calSelected;
                const mood = entry ? MOODS.find(m => m.key === entry.mood) : null;
                const col = mood ? (moodColor[mood.key] || T.accent) : null;
                const day = parseInt(dateStr.split("-")[2]);
                return (
                  <div key={dateStr} onClick={() => {
                    const wasSelected = calSelected === dateStr;
                    setCalSelected(wasSelected ? null : dateStr);
                    setCalEntry(wasSelected ? null : (entry || null));
                  }}
                    style={{
                      height: 38, borderRadius: 7, cursor: "pointer", display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", gap: 1,
                      background: isSelected ? `${T.accent}28` : entry ? `${col || T.accent}14` : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isSelected ? T.accent : entry ? `${col || T.accent}35` : T.border}`,
                      outline: isToday ? `2px solid ${T.accent}60` : "none", outlineOffset: 1,
                      transition: "all 0.12s",
                    }}>
                    <span style={{ fontSize: 11, lineHeight: 1, fontWeight: isToday ? 700 : 400, color: isSelected ? T.text1 : entry ? T.text1 : T.text3 }}>{day}</span>
                    {entry?.is_win ? <span style={{ fontSize: 8 }}>🏆</span> : mood ? <span style={{ fontSize: 9, opacity: 0.8 }}>{mood.emoji}</span> : null}
                  </div>
                );
              })}
            </div>
            {calSelected && (
              <div style={{ marginTop: 14, background: T.navy3, borderRadius: 8, border: `1px solid ${T.border}`, animation: "fadeIn 0.15s ease", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase", letterSpacing: 1 }}>
                    {new Date(calSelected + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {calEntry && (
                      <button onClick={() => { localStorage.setItem("echo_diary_jump", calSelected); setView("diary"); }}
                        style={{ background: `${T.accent}18`, border: `1px solid ${T.accent}40`, borderRadius: 6, color: T.accent, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 12px", fontFamily: "'DM Sans', sans-serif" }}>
                        Open full entry →
                      </button>
                    )}
                    <button onClick={() => { setCalSelected(null); setCalEntry(null); }} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                </div>
                <div style={{ padding: "12px 16px", cursor: calEntry ? "pointer" : "default" }}
                  onClick={() => { if (calEntry) { localStorage.setItem("echo_diary_jump", calSelected); setView("diary"); } }}>
                  {calEntry ? (
                    <>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        {getFocusAreas(calEntry).map(f => <span key={f} className="focus-badge" style={{ fontSize: 10 }}>{f}</span>)}
                        {calEntry.mood && <span style={{ fontSize: 12 }}>{MOODS.find(m => m.key === calEntry.mood)?.emoji} <span style={{ fontSize: 11, color: T.text3 }}>{MOODS.find(m => m.key === calEntry.mood)?.label}</span></span>}
                        {calEntry.is_win && <span style={{ fontSize: 11, background: `${T.gold}14`, color: T.gold, padding: "2px 8px", borderRadius: 10 }}>🏆 Win</span>}
                      </div>
                      {calEntry.content && <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.65, marginBottom: 8 }}>{calEntry.content}</div>}
                      {(calEntry.collaborators || []).length > 0 && <div style={{ fontSize: 11, color: T.text3, marginBottom: calEntry.blockers ? 4 : 0 }}>👥 {calEntry.collaborators.map(c => cleanCollab(c)).filter(Boolean).join(", ")}</div>}
                      {calEntry.blockers && <div style={{ fontSize: 11, color: T.coral }}>⚠ {calEntry.blockers}</div>}
                      <div style={{ fontSize: 11, color: T.accent, marginTop: 10, opacity: 0.7 }}>Click anywhere to open full entry →</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: T.text3, textAlign: "center", padding: "10px 0" }}>No diary entry for this day</div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Working-Day Mood Heatmap ── */}
      {(() => {
        const moodColor = { productive: T.green, resolved: T.teal, collaborative: T.accent, challenged: T.gold, frustrated: T.coral };

        // UTC helpers — dates stored in Supabase are UTC strings so we stay consistent
        const utcDayStr = (offsetDays) => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - offsetDays);
          return d.toISOString().slice(0, 10);
        };
        const utcDow = (dateStr) => new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=Sun

        // Build last 14 relevant days: weekdays always, weekends only if entry exists
        const days = [];
        let offset = 0;
        while (days.length < 14 && offset < 60) {
          const dateStr = utcDayStr(offset);
          const dow = utcDow(dateStr);
          const isWeekend = dow === 0 || dow === 6;
          const day = parseInt(dateStr.split("-")[2]);
          const wd = new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
          const entry = heatEntries.find(e => e.date === dateStr);
          if (!isWeekend || entry) {
            days.unshift({ dateStr, day, wd, entry, isToday: offset === 0, isWeekend });
          }
          offset++;
        }

        // Streak: consecutive working days backward using UTC (weekends transparent)
        const streak = (() => {
          let s = 0, o = 0;
          while (o < 60) {
            const dateStr = utcDayStr(o);
            const dow = utcDow(dateStr);
            if (dow === 0 || dow === 6) { o++; continue; }
            if (!heatEntries.some(e => e.date === dateStr)) break;
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
                    onClick={() => { if (entry) { localStorage.setItem("echo_diary_jump", dateStr); setView("diary"); } }}
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

      {/* ── AI Insight ── */}
      {GROQ_API_KEY && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>✨ AI Work Reflection</div>
            <button
              onClick={async () => {
                if (aiLoading) return;
                setAiLoading(true);
                const insight = await callGroqInsight(heatEntries.slice(0, 7));
                setAiLoading(false);
                if (insight) {
                  setAiInsight(insight);
                  try { localStorage.setItem("echo_ai_insight", JSON.stringify({ date: new Date().toISOString().slice(0, 10), text: insight })); } catch {}
                }
              }}
              disabled={aiLoading}
              style={{
                background: `${T.violet}18`, border: `1px solid ${T.violet}40`, borderRadius: 8,
                color: aiLoading ? T.text3 : T.violet, fontSize: 11, fontWeight: 600,
                padding: "4px 12px", cursor: aiLoading ? "default" : "pointer", fontFamily: "'DM Sans', sans-serif",
              }}>
              {aiLoading ? "Thinking…" : aiInsight ? "↺ Refresh" : "Generate"}
            </button>
          </div>
          {aiInsight
            ? <div style={{ fontSize: 14, color: T.text2, lineHeight: 1.8, fontStyle: "italic" }}>"{aiInsight}"</div>
            : <div style={{ fontSize: 13, color: T.text3, textAlign: "center", padding: "12px 0" }}>
                Click <strong style={{ color: T.violet }}>Generate</strong> to get an AI reflection on your recent work patterns
              </div>
          }
        </div>
      )}

      {/* ── On This Day ── */}
      {(onThisDay.week || onThisDay.month || onThisDay.quarter || onThisDay.year) && (
        <div className="card" style={{ marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 14 }}>🕰 On This Day</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {[
              { label: "1 week ago",    entry: onThisDay.week    },
              { label: "1 month ago",   entry: onThisDay.month   },
              { label: "3 months ago",  entry: onThisDay.quarter },
              { label: "1 year ago",    entry: onThisDay.year    },
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
function NoteRow({ n, isActive, onClick, onDelete }) {
  const [hov, setHov] = useState(false);
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={onClick}
      style={{ display: "flex", alignItems: "center", padding: "7px 10px", cursor: "pointer", gap: 6,
        background: isActive ? "rgba(79,142,247,0.12)" : hov ? "rgba(255,255,255,0.03)" : "transparent",
        borderLeft: `2px solid ${isActive ? T.accent : "transparent"}`, transition: "background 0.1s" }}>
      <span style={{ flex: 1, fontSize: 12, color: isActive ? T.text1 : T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {n.title || "Untitled"}
      </span>
      {hov && (
        <span onClick={onDelete} title="Delete" style={{ fontSize: 14, color: T.text3, lineHeight: 1, cursor: "pointer", flexShrink: 0, padding: "0 2px" }}>×</span>
      )}
    </div>
  );
}

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

  const groups = [...new Set(notes.map(n => n.group || "").filter(Boolean))];

  return (
    <div style={{
      position: "fixed", bottom: 84, right: 24, width: 600, height: 500,
      background: T.navy1, border: `1px solid ${T.borderHover}`,
      borderRadius: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.65)",
      display: "flex", flexDirection: "column", zIndex: 9998, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: T.navy2, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>📝 Scratch Pad</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 4px" }}>✕</button>
      </div>

      {/* Body: sidebar + editor */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left sidebar: note list ── */}
        <div style={{ width: 180, borderRight: `1px solid ${T.border}`, background: T.navy2, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* Ungrouped notes */}
            {notes.filter(n => !n.group).map((n, _i) => {
              const idx = notes.indexOf(n);
              const isActive = idx === realIdx;
              return (
                <NoteRow key={n.id} n={n} isActive={isActive}
                  onClick={() => { setActiveIdx(notes.filter(x => !x.group).indexOf(n)); setActiveGroup("All"); }}
                  onDelete={e => deleteNote(notes.filter(x => !x.group).indexOf(n), e)}
                />
              );
            })}
            {/* Grouped notes */}
            {groups.map(g => (
              <div key={g}>
                <div style={{ padding: "8px 10px 3px", fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.07em", userSelect: "none" }}>{g}</div>
                {notes.filter(n => (n.group || "") === g).map(n => {
                  const visArr = notes.filter(x => (x.group || "") === g);
                  const visI = visArr.indexOf(n);
                  const isActive = notes.indexOf(n) === realIdx;
                  return (
                    <NoteRow key={n.id} n={n} isActive={isActive}
                      onClick={() => { setActiveGroup(g); setActiveIdx(visI); }}
                      onDelete={e => deleteNote(visI, e)}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Sidebar footer: new note + new group */}
          <div style={{ borderTop: `1px solid ${T.border}`, padding: "6px 8px", display: "flex", gap: 4 }}>
            <button onClick={addNote} title="New note" style={{ flex: 1, background: T.accentGlow, border: `1px solid ${T.accent}`, borderRadius: 7, padding: "5px 0", fontSize: 11, color: T.accent, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}>＋ Note</button>
            {showGroupInput ? (
              <input autoFocus value={newGroupInput}
                onChange={e => setNewGroupInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addGroup(); if (e.key === "Escape") { setShowGroupInput(false); setNewGroupInput(""); } }}
                onBlur={addGroup}
                placeholder="Group…"
                style={{ flex: 1, background: T.navy3, border: `1px solid ${T.accent}`, borderRadius: 7, padding: "5px 7px", fontSize: 11, color: T.text1, outline: "none", fontFamily: "'DM Sans',sans-serif" }}
              />
            ) : (
              <button onClick={() => setShowGroupInput(true)} title="New group" style={{ flex: 1, background: "transparent", border: `1px dashed ${T.border}`, borderRadius: 7, padding: "5px 0", fontSize: 11, color: T.text3, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>＋ Group</button>
            )}
          </div>
        </div>

        {/* ── Right editor ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Title + group tag */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <input
              type="text"
              value={active?.title || ""}
              onChange={e => updateActive("title", e.target.value)}
              placeholder="Note title…"
              style={{ flex: 1, background: "transparent", border: "none", color: T.text1, fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "'DM Sans',sans-serif" }}
            />
            <select
              value={active?.group || ""}
              onChange={e => updateActive("group", e.target.value)}
              style={{ background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 7px", fontSize: 11, color: active?.group ? T.accent : T.text3, outline: "none", fontFamily: "'DM Sans',sans-serif", cursor: "pointer" }}
            >
              <option value="">No group</option>
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Textarea */}
          <textarea
            value={active?.text || ""}
            onChange={e => updateActive("text", e.target.value)}
            placeholder="Jot something down…"
            style={{ flex: 1, background: "transparent", border: "none", color: T.text2, fontSize: 13, padding: "12px 16px", outline: "none", resize: "none", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.8 }}
          />

          {/* Footer */}
          <div style={{ padding: "5px 14px", borderTop: `1px solid ${T.border}`, fontSize: 11, color: T.text3, display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
            <span>{active?.text?.length || 0} chars</span>
            <span>{notes.length} note{notes.length !== 1 ? "s" : ""} · auto-saved</span>
          </div>
        </div>
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
  const [hadSessionThisMonth, setHadSessionThisMonth] = useState(new Set());
  const [nextSessionMap, setNextSessionMap] = useState({});

  useEffect(() => {
    if (!user?.id) return;
    probeTeammateRelationship().then(ok => setRelSupported(ok));
    refreshTeammates().then(rows => setTeammates(rows));
    probeUserIdDiary().then(uidOk => {
      const opts = { order: "date.desc" };
      if (uidOk && user?.id) opts.match = { user_id: user.id };
      db.from("diary_entries").select("date,collaborators", opts).then(rows => {
      const seen = {};
      (rows || []).forEach(e => {
        (e.collaborators || []).forEach(name => {
          const n = name.trim();
          if (n && !seen[n]) seen[n] = e.date;
        });
      });
      setLastSeen(seen);
      });
    });
    const monthStart = new Date().toISOString().slice(0, 7) + "-01";
    fetch(`${_REST()}/one_on_one_sessions?select=teammate_id&session_date=gte.${monthStart}`, { headers: h() })
      .then(r => r.ok ? r.json() : [])
      .then(rows => setHadSessionThisMonth(new Set((rows || []).map(s => s.teammate_id))));
    db.from("one_on_one_sessions").select("teammate_id,next_session_date", { order: "session_date.desc" }).then(rows => {
      const map = {};
      (rows || []).forEach(s => {
        if (s.next_session_date && !map[s.teammate_id]) map[s.teammate_id] = s.next_session_date;
      });
      setNextSessionMap(map);
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

  const isLastWeekOfMonth = (() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return lastDay - now.getDate() < 7;
  })();
  const overdueDirects = teammates.filter(t =>
    (t.relationship || "direct") === "direct" && !hadSessionThisMonth.has(t.id)
  );

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {/* Monthly 1:1 reminder banner */}
      {isLastWeekOfMonth && overdueDirects.length > 0 && (
        <div style={{
          background: `${T.amber}0f`, border: `1px solid ${T.amber}50`,
          borderRadius: 12, padding: "14px 18px", marginBottom: 20,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>🔔</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.amber, marginBottom: 4 }}>
              Monthly 1:1 reminder — it's the last week of the month
            </div>
            <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
              No 1:1 logged this month with:{" "}
              {overdueDirects.map((t, i) => (
                <span key={t.id}>
                  <button onClick={() => setOneOnOne(t)} style={{
                    background: "none", border: "none", padding: 0,
                    color: T.amber, cursor: "pointer", fontWeight: 600,
                    fontSize: 12, fontFamily: "inherit", textDecoration: "underline",
                  }}>{t.name}</button>
                  {i < overdueDirects.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
              Click a name to open their 1:1 session now.
            </div>
          </div>
        </div>
      )}

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
                        {rt.key === "direct" && (() => {
                          const ns = nextSessionMap[t.id];
                          if (!ns) return null;
                          const daysLeft = Math.ceil((new Date(ns + "T00:00:00").getTime() - Date.now()) / 86400000);
                          if (daysLeft < -3 || daysLeft > 30) return null;
                          const overdue = daysLeft < 0;
                          const col = overdue ? T.coral : daysLeft <= 3 ? T.amber : T.teal;
                          return (
                            <div style={{ fontSize: 10, color: col, marginTop: 3, fontWeight: 600 }}>
                              {overdue ? `1:1 overdue ${Math.abs(daysLeft)}d` : daysLeft === 0 ? "1:1 today!" : `1:1 in ${daysLeft}d`}
                            </div>
                          );
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
  { key: "external", label: "External",   color: T.muted  },
];

const TEAM_ROLES = [
  { key: "manager",           label: "Manager",           color: T.amber,   tip: "Upward — focus on alignment, blockers, and strategic goals" },
  { key: "developer",         label: "Developer",         color: T.violet,  tip: "Peer — focus on delivery, code quality, and collaboration" },
  { key: "scrum_master",      label: "Scrum Master",      color: T.teal,    tip: "Process — focus on sprint health, impediments, and retrospectives" },
  { key: "product_owner",     label: "Product Owner",     color: T.accent2, tip: "Product — focus on requirements clarity, priorities, and backlog" },
  { key: "designer",          label: "Designer",          color: T.coral,   tip: "Creative — focus on UX outcomes, design reviews, and feedback loops" },
  { key: "qa",                label: "QA / Tester",       color: T.teal,    tip: "Quality — focus on test coverage, bugs, and release readiness" },
  { key: "sdet_i",            label: "SDET I",            color: T.teal,    tip: "Junior SDET — automation, test scripting, bug verification" },
  { key: "sdet_ii",           label: "SDET II",           color: T.teal,    tip: "Mid SDET — framework development, CI integration, test design" },
  { key: "sdet_iii",          label: "SDET III",          color: T.teal,    tip: "Senior SDET — architecture, mentoring, strategy" },
  { key: "associate_sdet",    label: "Associate SDET",    color: T.teal,    tip: "Entry SDET — learning automation, manual + scripting" },
  { key: "tech_lead",         label: "Tech Lead",         color: T.violet,  tip: "Technical — focus on architecture decisions, code reviews, and mentoring" },
  { key: "data_analyst",      label: "Data Analyst",      color: T.amber,   tip: "Data — focus on insights, metrics, and analytical deliverables" },
  { key: "devops",            label: "DevOps",             color: T.coral,   tip: "Infrastructure — focus on pipelines, reliability, and release process" },
  { key: "delivery_manager",  label: "Delivery Manager",  color: T.accent2, tip: "Delivery — focus on timelines, dependencies, and stakeholder reporting" },
  { key: "stakeholder",       label: "Stakeholder",       color: T.muted,   tip: "External — focus on status updates, risks, and expectations" },
  { key: "trainee",           label: "Trainee",           color: T.muted,   tip: "Entry level — learning the codebase, guided tasks" },
];

const SESSION_SENTIMENTS = [
  { key: "excellent",       label: "Excellent",       color: T.teal   },
  { key: "positive",        label: "Good",            color: T.violet },
  { key: "neutral",         label: "Neutral",         color: T.amber  },
  { key: "needs_attention", label: "Needs Attention", color: T.coral  },
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
  const [feedbackPreloaded, setFeedbackPreloaded] = useState(0);

  useEffect(() => {
    if (!user?.id || !teammate?.id) return;
    const agqOk = probeAgendaQueue();
    probeUserIdDiary().then(uidOk => {
    const dOpts = { order: "date.desc", ...(uidOk && user?.id ? { match: { user_id: user.id } } : {}) };
    Promise.all([
      db.from("diary_entries").select("*", dOpts),
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
      // Pre-populate feedback given since the last 1:1 session
      const lastSessionDate = (past || [])[0]?.session_date || null;
      const prefillFeedback = rel
        .flatMap(e => (e.feedback_given || []).filter(f => f.to === name).map(f => ({ type: f.type, note: f.note, _date: e.date })))
        .filter(f => !lastSessionDate || f._date > lastSessionDate)
        .map(({ type, note }) => ({ type, note }));
      if (prefillFeedback.length > 0) {
        setForm(prev => ({ ...prev, feedback_given: prefillFeedback }));
        setFeedbackPreloaded(prefillFeedback.length);
      }
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
    }); // probeUserIdDiary
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
        background: T.navy1, border: `1px solid ${T.borderHover}`,
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
                    {feedbackPreloaded > 0 && (
                      <div style={{ fontSize: 11, color: T.teal, padding: "5px 10px", background: `${T.teal}12`, border: `1px solid ${T.teal}25`, borderRadius: 6, marginBottom: 8 }}>
                        ✓ {feedbackPreloaded} feedback item{feedbackPreloaded !== 1 ? "s" : ""} pre-loaded from your diary since last 1:1 — remove any that aren't relevant
                      </div>
                    )}
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
  const [saveError, setSaveError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [attDbOk, setAttDbOk] = useState(null);

  useEffect(() => { probeAttendance().then(setAttDbOk); }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const categorise = async () => {
    const bullets = (form.content || "").split("\n").filter(b => b.trim());
    if (!bullets.length) return;
    setAiLoading(true); setAiError("");
    try {
      const knownPeople = (loadTeammates() || []).map(t => t.name);
      const cats = await callGroq(bullets, knownPeople);
      if (cats) {
        let savedForm = null;
        setForm(f => {
          const existing = f.collaborators || [];
          const existingLower = existing.map(x => x.toLowerCase());
          const fresh = (cats.people || []).filter(p => p && !existingLower.includes(p.toLowerCase()));
          const merged = [...existing, ...fresh];
          const collaborators = merged.filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
          const next = { ...f, categories: cats, collaborators };
          savedForm = next;
          return next;
        });
        // Auto-save silently after categorisation — only for existing entries (form.id exists).
        // New entries have no id yet; calling onAutoSave without an id does an INSERT each time, creating duplicates.
        if (onAutoSave && savedForm?.id) {
          await onAutoSave({ ...savedForm, title: fmtDate(savedForm.date), focus_area: (savedForm.focus_areas || [])[0] || savedForm.focus_area || "" });
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
    setSaveError("");
    const result = await onSave({ ...form, title: fmtDate(form.date), focus_area: (form.focus_areas || [])[0] || form.focus_area || "" });
    setSaving(false);
    if (result?.error) { setSaveError(result.error); return; }
    if (result?.warning) {
      setSaveError(`⚠️ These fields were NOT saved because the columns are missing in Supabase: ${result.warning.join(", ")}. Run the SQL shown below to fix this permanently.`);
      return; // keep form open so data isn't lost
    }
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

            {/* ── Quick Templates (shown only when content is empty) ── */}
            {!(form.content || "").trim() && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Start with:</span>
                {DIARY_TEMPLATES.map(t => (
                  <button key={t.key} onClick={() => {
                    set("content", t.content.join("\n"));
                    if (t.blockers) set("blockers", t.blockers);
                    setPointInput("");
                  }} style={{
                    padding: "4px 11px", fontSize: 11, borderRadius: 20, cursor: "pointer",
                    background: "transparent", color: T.text2,
                    border: `1px solid ${T.border}`, fontFamily: "'DM Sans', sans-serif",
                    transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.accent; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.text2; }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            )}

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
              {(() => {
                const items = (form.content || "").split("\n").filter(p => p.trim());
                const words = items.join(" ").split(/\s+/).filter(Boolean).length;
                const readMin = Math.ceil(words / 200);
                if (!words) return null;
                return (
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 5, display: "flex", gap: 10 }}>
                    <span>Press Enter to add · Paste multiple lines to bulk-add</span>
                    <span style={{ marginLeft: "auto", color: T.text3 }}>{words} words · ~{readMin} min read</span>
                  </div>
                );
              })() || <div style={{ fontSize: 11, color: T.text3, marginTop: 5 }}>Press Enter to add · Paste multiple lines to bulk-add</div>}
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
            {attDbOk === false && (
              <div style={{ background: `${T.coral}18`, border: `1px solid ${T.coral}40`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: T.coral }}>
                ⚠️ Attendance data won't save until you run this in Supabase SQL editor:
                <div style={{ fontFamily: "monospace", marginTop: 6, padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 4, fontSize: 11, color: T.text2, wordBreak: "break-all" }}>
                  ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS team_attendance jsonb DEFAULT '[]';
                </div>
              </div>
            )}
            {(() => {
              const teammates = loadTeammates().filter(t => (t.relationship || "direct") === "direct");
              if (teammates.length === 0) return (
                <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "28px 0" }}>
                  No My Team members found. Add teammates with the "My Team" relationship in <strong>My Team</strong>.
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
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: T.navy3, borderRadius: 8, border: `1px solid ${cur ? attColor(cur) + "40" : T.border}` }}>
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

        {saveError && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(240,122,110,0.12)", border: `1px solid ${T.coral}`, borderRadius: 8, fontSize: 12, color: T.coral }}>
            {saveError === "jwt_expired" ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Your session has expired.</div>
                <div style={{ color: T.text2, marginBottom: 10 }}>Sign out and sign back in, then save again. Your form data is still here.</div>
                <button onClick={() => { db.auth.signOut(); window.location.reload(); }}
                  style={{ padding: "6px 14px", background: T.coral, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                  Sign out now
                </button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: saveError.includes("Supabase") ? 8 : 0 }}>{saveError}</div>
                {saveError.toLowerCase().includes("jwt") && (
                  <div style={{ marginTop: 6, color: T.text2 }}>Your session has expired. Sign out and sign back in, then try again.</div>
                )}
              </>
            )}
            {saveError.includes("Supabase") && (
              <pre style={{ margin: 0, fontSize: 11, color: T.teal, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "6px 10px", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{`ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS team_updates jsonb DEFAULT '[]';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS feedback_given jsonb DEFAULT '[]';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS blockers text DEFAULT '';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS jira_links jsonb DEFAULT '[]';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS collaborators jsonb DEFAULT '[]';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS carry_forward jsonb DEFAULT '[]';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS reminders jsonb DEFAULT '[]';\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS linked_note text;\nALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS categories jsonb DEFAULT '{}';`}</pre>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
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
  const [uidReady, setUidReady]   = useState(null);
  const [search, setSearch]       = useState("");
  const [modal, setModal]         = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [standup, setStandup]     = useState(null);
  const [weeklyReport, setWeeklyReport]   = useState(false);
  const [filterMood, setFilterMood]       = useState("");
  const [filterFocus, setFilterFocus]     = useState("");
  const [filterStarred, setFilterStarred] = useState(false);
  const [filterPeriod, setFilterPeriod]   = useState("");
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
    probeCategories().then(ok => setCatColReady(ok));
    const uidOk = await probeUserIdDiary();
    setUidReady(uidOk);
    const diaryOpts = { order: "date.desc" };
    if (uidOk && user?.id) diaryOpts.match = { user_id: user.id };
    const d = await db.from("diary_entries").select("*", diaryOpts);
    setEntries(d || []);
    setPrevEntry(d?.[0] || null);
    onCountChange?.(d?.length || 0);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-open entry when navigated from Dashboard calendar
  useEffect(() => {
    if (!entries.length) return;
    const jumpDate = localStorage.getItem("echo_diary_jump");
    if (!jumpDate) return;
    localStorage.removeItem("echo_diary_jump");
    const target = entries.find(e => e.date === jumpDate);
    if (target) setViewEntry(target);
  }, [entries]);

  // Auto-open new entry form when triggered by N keyboard shortcut
  useEffect(() => {
    if (loading) return;
    const flag = localStorage.getItem("echo_diary_new");
    if (!flag) return;
    localStorage.removeItem("echo_diary_new");
    setModal("new");
  }, [loading]);

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
    const doOne = async (data) => {
      if (data.id) { const { id, ...rest } = data; return db.from("diary_entries").update(rest, id); }
      return db.from("diary_entries").insert(data);
    };
    // Columns that may not exist yet — stripped one at a time if Supabase errors on them
    const OPTIONAL_COLS = ["user_id","focus_areas","is_win","win_tags","team_attendance","categories",
                           "team_updates","feedback_given","blockers","jira_links",
                           "collaborators","carry_forward","reminders","linked_note","ticket_number"];
    const [hasFocusAreas, hasWin, hasCats, hasAtt] = await Promise.all([probeFocusAreas(), probeIsWin(), probeCategories(), probeAttendance()]);
    let saveData = form;
    // Stamp user_id on new entries for data isolation (requires user_id column + RLS in Supabase)
    if (user?.id && !saveData.id) saveData = { ...saveData, user_id: user.id };
    if (!hasFocusAreas) { const { focus_areas, ...rest } = saveData; saveData = rest; }
    if (!hasWin)        { const { is_win, win_tags, ...rest } = saveData; saveData = rest; }
    if (!hasAtt)        { const { team_attendance, ...rest } = saveData; saveData = rest; }
    if (!hasCats)       { const { categories, ...rest } = saveData; saveData = rest; }

    // JWT expired — refresh token and retry once before anything else
    const isJwtError = (r) => {
      const msg = (r?.message || "").toLowerCase();
      return r?.code && (msg.includes("jwt") || msg.includes("token") || r?.code === "PGRST301");
    };
    const droppedCols = [];
    let result = await doOne(saveData);
    if (isJwtError(result)) {
      const ok = await _refreshToken();
      if (!ok) return { error: "jwt_expired" };
      result = await doOne(saveData);
    }
    // Generic retry: if Supabase errors on an unknown column, strip it and retry
    for (let attempt = 0; attempt < OPTIONAL_COLS.length && result?.code; attempt++) {
      const msg = (result.message || "").toLowerCase();
      const bad = OPTIONAL_COLS.find(c => msg.includes(c));
      if (!bad) break; // unrecoverable error (not a missing-column issue)
      droppedCols.push(bad);
      const { [bad]: _dropped, ...stripped } = saveData;
      saveData = stripped;
      result = await doOne(saveData);
    }
    if (result?.code) {
      // Save truly failed — return error so the form can display it
      return { error: result.message || "Unknown error" };
    }
    if (droppedCols.length > 0) {
      // Saved successfully but some fields were silently dropped due to missing DB columns
      load();
      return { warning: droppedCols };
    }
    load();
  };

  const del = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    await db.from("diary_entries").delete(id);
    setViewEntry(null);
    load();
  };

  const periodStart = (() => {
    if (!filterPeriod) return null;
    const now = new Date();
    if (filterPeriod === "7d")    { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 7);  return d.toISOString().slice(0, 10); }
    if (filterPeriod === "30d")   { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); }
    if (filterPeriod === "month") return now.toISOString().slice(0, 7) + "-01";
    if (filterPeriod === "week")  { const d = new Date(now); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); }
    return null;
  })();

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
    const matchPeriod  = !periodStart   || e.date >= periodStart;
    return matchSearch && matchMood && matchFocus && matchStarred && matchPeriod;
  });

  const isFiltered = !!(search || filterMood || filterFocus || filterStarred || filterPeriod);
  const clearFilters = () => { setSearch(""); setFilterMood(""); setFilterFocus(""); setFilterStarred(false); setFilterPeriod(""); };

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

      {uidReady === false && (
        <div style={{ background: `rgba(240,117,98,0.1)`, border: `1px solid ${T.coral}40`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: T.coral }}>
          <strong>⚠️ Diary entries are not private yet</strong> — all users can see each other's data.
          Run this once in your <strong>Supabase SQL editor</strong> to enable per-user isolation, then reload:
          <pre style={{ marginTop: 8, background: "rgba(0,0,0,0.25)", borderRadius: 6, padding: "8px 12px", fontFamily: "monospace", fontSize: 11, color: T.teal, userSelect: "all", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{`ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);\nALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "own" ON diary_entries FOR ALL USING (auth.uid() = user_id);\nUPDATE diary_entries SET user_id = auth.uid() WHERE user_id IS NULL;`}</pre>
        </div>
      )}

      {!catColReady && (
        <div style={{ background: `${T.amber}15`, border: `1px solid ${T.amber}40`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: T.amber }}>
          <strong>AI categories won't save yet.</strong> Run this in Supabase SQL editor, then reload:
          <div style={{ marginTop: 6, background: T.navy0, borderRadius: 6, padding: "7px 12px", fontFamily: "monospace", fontSize: 11, color: T.text2, userSelect: "all" }}>
            ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS categories jsonb DEFAULT {'{}'};
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <span style={{ color: T.text3, fontSize: 16 }}>🔍</span>
          <input placeholder="Search notes, tickets, team members, tags…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 120 }} value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
          <option value="">All time</option>
          <option value="week">This week</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
        </select>
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
        <button className="btn btn-ghost" title="Export diary as CSV" onClick={() => {
          if (!entries.length) return;
          const rows = entries.filter(e => !periodStart || e.date >= periodStart).map(e => ({
            date: e.date, mood: e.mood || "", focus_areas: getFocusAreas(e).join("; "),
            content: (e.content || "").replace(/\n/g, " | "),
            blockers: (e.blockers || "").replace(/\n/g, " | "),
            collaborators: (e.collaborators || []).map(cleanCollab).join("; "),
            tags: (e.tags || []).join("; "), jira_links: (e.jira_links || []).join("; "),
            is_win: e.is_win ? "Yes" : "No",
          }));
          const hdrs = Object.keys(rows[0]);
          const csv = [hdrs.join(","), ...rows.map(r => hdrs.map(h => `"${String(r[h]).replace(/"/g, '""')}"`).join(","))].join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = `echo-diary-${today()}.csv`; a.click(); URL.revokeObjectURL(url);
        }}>⬇ CSV</button>
        <button className="btn btn-primary" onClick={() => setModal("new")}>+ New Entry</button>
      </div>

      {isFiltered && entries.length > 0 && (
        <div style={{ fontSize: 12, color: T.text3, marginBottom: 12, paddingLeft: 2, display: "flex", alignItems: "center", gap: 12 }}>
          Showing <strong style={{ color: T.text2 }}>{filtered.length}</strong> of {entries.length} entries
          {filtered.length !== entries.length && (
            <button onClick={clearFilters} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans', sans-serif", padding: 0 }}>✕ Clear filters</button>
          )}
        </div>
      )}

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
function ShadowResume({ user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    probeUserIdDiary().then(uidOk => {
      const opts = { order: "date.asc" };
      if (uidOk && user?.id) opts.match = { user_id: user.id };
      db.from("diary_entries").select("*", opts).then(d => {
        setEntries(d || []);
        setLoading(false);
      });
    });
  }, [user]);

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
    (e.collaborators || []).forEach(c => { const n = cleanCollab(c); if (n && n.trim()) allCollabs[n.trim()] = (allCollabs[n.trim()] || 0) + 1; });
    (e.jira_links || []).forEach(j => { if (j && j.trim()) allJiras.add(j.trim()); });
  });

  const topFocus   = Object.entries(allFocusAreas).sort((a,b) => b[1]-a[1]);
  const topCollabs = Object.entries(allCollabs).sort((a,b) => b[1]-a[1]).slice(0, 12);
  const topTags    = Object.entries(allTags).sort((a,b) => b[1]-a[1]).slice(0, 24);
  const maxFA      = topFocus[0]?.[1] || 1;
  const faPalette  = [T.accent, T.teal, T.gold, T.coral, T.green, "#a78bfa", "#fb923c", "#38bdf8"];
  const byMonth = {};
  entries.forEach(e => {
    const m = e.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { count: 0, focuses: new Set(), collabs: new Set(), moods: {} };
    byMonth[m].count++;
    getFocusAreas(e).forEach(f => byMonth[m].focuses.add(f));
    (e.collaborators || []).forEach(c => { const n = cleanCollab(c); if (n && n.trim()) byMonth[m].collabs.add(n.trim()); });
    if (e.mood) byMonth[m].moods[e.mood] = (byMonth[m].moods[e.mood] || 0) + 1;
  });
  const months = Object.entries(byMonth).sort((a,b) => a[0].localeCompare(b[0]));
  const dateRange = `${fmtDate(entries[0].date)} — ${fmtDate(entries[entries.length-1].date)}`;
  const numMonths = months.length;

  const top3Focus   = topFocus.slice(0, 3).map(([f]) => f);
  const topCollab   = topCollabs[0]?.[0];
  const winEntries  = entries.filter(e => e.is_win);
  const myName      = localStorage.getItem("echo_display_name") || "";
  const avgPerMonth = numMonths > 0 ? Math.round(entries.length / numMonths) : 0;
  const maxMonthCount = Math.max(...months.map(([, d]) => d.count), 1);

  return (
    <div className="echo-content fade-in">

      {/* ── Hero Header ── */}
      <div style={{ marginBottom: 16, background: `linear-gradient(135deg, ${T.navy2} 0%, ${T.navy3} 60%, ${T.navy4} 100%)`, border: `1px solid ${T.borderHover}`, borderRadius: 14, padding: "24px 28px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${T.accent}, ${T.teal}, ${T.gold})` }} />
        <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle, ${T.accent}08, transparent 70%)`, pointerEvents: "none" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: `linear-gradient(135deg, ${T.accent}40, ${T.teal}30)`, border: `2px solid ${T.accent}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                {myName ? <span style={{ fontWeight: 800, fontSize: 18, color: T.accent, fontFamily: "'Syne', sans-serif" }}>{myName[0].toUpperCase()}</span> : "👤"}
              </div>
              <div>
                {myName && <div style={{ fontSize: 22, fontWeight: 800, color: T.text1, fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>{myName}</div>}
                <div style={{ fontSize: 12, color: T.text3, marginTop: myName ? 3 : 0, fontFamily: "'DM Mono', monospace" }}>{dateRange}</div>
              </div>
            </div>

            {/* Narrative summary */}
            <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.7, marginBottom: 0 }}>
              {top3Focus.length > 0 && <><span style={{ color: T.text1, fontWeight: 500 }}>Primary focus:</span> {top3Focus.join(", ")}. </>}
              {topCollab && <><span style={{ color: T.text1, fontWeight: 500 }}>Most frequent collaborator:</span> {topCollab}. </>}
              {winEntries.length > 0 && <><span style={{ color: T.gold }}>🏆 {winEntries.length} win{winEntries.length !== 1 ? "s" : ""} logged</span> this period. </>}
              {allJiras.size > 0 && <><span style={{ color: T.text3 }}>{allJiras.size} JIRA tickets referenced.</span></>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()} style={{ flexShrink: 0 }}>⬇ PDF</button>
        </div>

        {/* Stats strip */}
        <div style={{ display: "flex", gap: 0, marginTop: 20, paddingTop: 18, borderTop: `1px solid ${T.border}`, flexWrap: "wrap" }}>
          {[
            { l: "Total Entries",  v: entries.length,                   c: T.accent, icon: "📓" },
            { l: "Avg / Month",    v: avgPerMonth,                       c: T.teal,   icon: "📈" },
            { l: "Wins Logged",    v: winEntries.length,                 c: T.gold,   icon: "🏆" },
            { l: "Collaborators",  v: Object.keys(allCollabs).length,    c: "#a78bfa", icon: "🤝" },
            { l: "JIRA Tickets",   v: allJiras.size,                     c: T.coral,  icon: "🎫" },
            { l: "Skills Tagged",  v: Object.keys(allTags).length,       c: T.green,  icon: "🏷️" },
          ].map((s, i, arr) => (
            <div key={s.l} style={{ flex: 1, minWidth: 80, paddingRight: 16, borderRight: i < arr.length - 1 ? `1px solid ${T.border}` : "none", marginRight: i < arr.length - 1 ? 16 : 0, marginBottom: 4 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.c, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: 9, color: T.text3, marginTop: 4, letterSpacing: 0.8, textTransform: "uppercase" }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two-column: Focus + Top Collaborators ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>

        {/* Focus Areas */}
        {topFocus.length > 0 && (
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>🎯 Time Allocation</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topFocus.map(([fa, count], i) => {
                const col = faPalette[i % faPalette.length];
                const pct = Math.round((count / maxFA) * 100);
                return (
                  <div key={fa}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: i < 3 ? T.text1 : T.text2, fontWeight: i < 3 ? 600 : 400 }}>{fa}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: col, fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{count}d</span>
                        <span style={{ fontSize: 9, color: T.text3 }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: `${T.navy0}80`, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: `linear-gradient(90deg, ${col}70, ${col})`, transition: "width 0.7s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top Collaborators */}
        {topCollabs.length > 0 && (
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>🤝 Most Worked With</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {topCollabs.slice(0, 8).map(([name, count], i) => {
                const col = faPalette[i % faPalette.length];
                const barW = Math.round((count / (topCollabs[0]?.[1] || 1)) * 100);
                return (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${col}18`, border: `1.5px solid ${col}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: col, flexShrink: 0 }}>
                      {initials(name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: T.text1, fontWeight: i === 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                        <span style={{ fontSize: 10, color: T.text3, marginLeft: 6, flexShrink: 0 }}>{count}×</span>
                      </div>
                      <div style={{ height: 3, background: `${T.navy0}80`, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 2, width: `${barW}%`, background: col, opacity: 0.5 }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              {topCollabs.length > 8 && <div style={{ fontSize: 10, color: T.text3, paddingLeft: 38 }}>+{topCollabs.length - 8} more collaborators</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── Wins Gallery ── */}
      {winEntries.length > 0 && (
        <div className="card" style={{ marginBottom: 12, padding: "18px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>🏆 Wins & Highlights</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {winEntries.slice(0, 6).map((e, i) => (
              <div key={e.id || i} style={{ background: `${T.gold}08`, border: `1px solid ${T.gold}22`, borderRadius: 10, padding: "10px 14px", borderLeft: `3px solid ${T.gold}60` }}>
                <div style={{ fontSize: 10, color: T.gold, fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>{fmtDate(e.date)}</div>
                <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.5 }}>
                  {(e.content || "").slice(0, 100)}{(e.content || "").length > 100 ? "…" : ""}
                </div>
                {getFocusAreas(e).length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                    {getFocusAreas(e).map(f => <span key={f} style={{ fontSize: 9, padding: "1px 6px", background: `${T.gold}14`, color: T.gold, borderRadius: 8 }}>{f}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
          {winEntries.length > 6 && <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>+{winEntries.length - 6} more wins — see Brag Doc for full list</div>}
        </div>
      )}

      {/* ── Monthly Activity Timeline ── */}
      {months.length > 0 && (
        <div className="card" style={{ marginBottom: 12, padding: "18px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16 }}>📅 Monthly Activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {months.map(([m, data], i) => {
              const [yr, mo] = m.split("-");
              const label = new Date(Number(yr), Number(mo) - 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
              const topMood = Object.entries(data.moods).sort((a, b) => b[1] - a[1])[0]?.[0];
              const moodEmoji = { productive: "💚", resolved: "🔵", collaborative: "💜", challenged: "🟡", frustrated: "🔴" };
              const barPct = Math.round((data.count / maxMonthCount) * 100);
              const isLatest = i === months.length - 1;
              return (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: i < months.length - 1 ? `1px solid ${T.border}30` : "none" }}>
                  <div style={{ width: 44, flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontWeight: isLatest ? 700 : 500, color: isLatest ? T.accent : T.text2, fontFamily: "'DM Mono', monospace" }}>{label}</div>
                  </div>
                  <div style={{ flex: 1, position: "relative", height: 18, background: `${T.navy0}60`, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${barPct}%`, background: isLatest ? `linear-gradient(90deg, ${T.accent}50, ${T.accent}80)` : `linear-gradient(90deg, ${T.teal}30, ${T.teal}50)`, borderRadius: 4, transition: "width 0.7s ease" }} />
                    <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 4 }}>
                      {[...data.focuses].slice(0, 3).map(fa => (
                        <span key={fa} style={{ fontSize: 9, color: isLatest ? T.accent : T.teal, fontWeight: 600, whiteSpace: "nowrap" }}>{fa}</span>
                      ))}
                      {data.collabs.size > 0 && <span style={{ fontSize: 9, color: T.text3 }}>· {[...data.collabs].slice(0, 2).join(", ")}</span>}
                    </div>
                  </div>
                  <div style={{ width: 46, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    {topMood && <span style={{ fontSize: 12 }}>{moodEmoji[topMood] || ""}</span>}
                    <span style={{ fontSize: 11, color: T.text3, fontFamily: "'DM Mono', monospace" }}>{data.count}d</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Skills & JIRA Tickets ── */}
      {(topTags.length > 0 || allJiras.size > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: topTags.length > 0 && allJiras.size > 0 ? "1fr 1fr" : "1fr", gap: 12 }}>
          {topTags.length > 0 && (
            <div className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>🏷️ Skills & Domains</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {topTags.map(([tag, count], i) => {
                  const col = faPalette[i % faPalette.length];
                  const sz = i < 3 ? 13 : i < 8 ? 12 : 11;
                  return (
                    <span key={tag} style={{ fontSize: sz, padding: "4px 11px", background: `${col}10`, color: col, borderRadius: 20, border: `1px solid ${col}25`, fontWeight: count > 2 ? 600 : 400 }}>
                      {tag}{count > 1 ? <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 4 }}>×{count}</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {allJiras.size > 0 && (
            <div className="card" style={{ padding: "18px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>🎫 JIRA Tickets <span style={{ color: T.text3, fontWeight: 400 }}>({allJiras.size})</span></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {[...allJiras].slice(0, 30).map(j => (
                  <span key={j} style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", padding: "3px 9px", background: `${T.gold}0c`, color: T.gold, borderRadius: 6, border: `1px solid ${T.gold}20` }}>{j}</span>
                ))}
                {allJiras.size > 30 && <span style={{ fontSize: 11, color: T.text3, padding: "3px 6px" }}>+{allJiras.size - 30} more</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Work Map ─────────────────────────────────────────────────────────────────
function WorkMap({ user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    probeUserIdDiary().then(uidOk => {
      const opts = { order: "date.desc" };
      if (uidOk && user?.id) opts.match = { user_id: user.id };
      db.from("diary_entries").select("*", opts).then(d => {
        setEntries(d || []);
        setLoading(false);
      });
    });
  }, [user]);

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
      if (_NAME_BLOCKLIST.has(name.toLowerCase())) return;
      if (!/^[A-Z]/.test(name)) return;
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
        <div className="card" style={{ textAlign: "center", padding: "40px 32px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{tab === "received" ? "⭐" : "🤝"}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text2, marginBottom: 8 }}>No {tab} credits yet</div>
          <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.7, maxWidth: 360, margin: "0 auto 20px" }}>
            {tab === "received" ? "When someone praises your work, says thanks, or credits you publicly — log it here. It becomes powerful evidence at appraisal time." : "Give credit where it's due. Logging what you acknowledge in others builds a fairer team culture and shows leadership qualities."}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>Log {tab === "received" ? "Received" : "Given"} Credit</button>
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
          <div style={{ background: T.navy2, border: `1px solid ${T.borderHover}`,
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
function BragDoc({ user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("quarter");
  const [filterTag, setFilterTag] = useState(null);
  const [copied, setCopied] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    Promise.all([probeIsWin(), probeUserIdDiary()]).then(([ok, uidOk]) => {
      setSupported(ok);
      if (!ok) { setLoading(false); return; }
      const opts = { order: "date.desc" };
      if (uidOk && user?.id) opts.match = { user_id: user.id };
      db.from("diary_entries").select("*", opts).then(rows => {
        setEntries((rows || []).filter(e => e.is_win));
        setLoading(false);
      });
    });
  }, [user]);

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
  const [form, setForm] = useState({ direction: "i_owe", person: "", what: "", due_date: "" });
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [tableExists, setTableExists] = useState(true);
  const [dueDateOk, setDueDateOk] = useState(false);

  const load = useCallback(async () => {
    const rows = await db.from("commitments").select("*", { order: "inserted_at.asc" });
    if (rows && rows.code) { setTableExists(false); setLoading(false); return; }
    setItems(rows || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return; }
    load();
    probeCommitmentDueDate().then(setDueDateOk);
  }, [load]);

  const add = async () => {
    if (!form.person.trim() || !form.what.trim()) return;
    const payload = { user_id: user.id, direction: form.direction, person: form.person.trim(), what: form.what.trim() };
    if (dueDateOk && form.due_date) payload.due_date = form.due_date;
    await db.from("commitments").insert(payload);
    setForm(f => ({ ...f, person: "", what: "", due_date: "" }));
    load();
  };

  const resolve = async (id) => { await db.from("commitments").update({ resolved_at: new Date().toISOString() }, id); load(); };
  const reopen  = async (id) => { await db.from("commitments").update({ resolved_at: null }, id); load(); };
  const remove  = async (id) => { await db.from("commitments").delete(id); setItems(prev => prev.filter(i => i.id !== id)); };

  const todayStr = today();
  const daysSince   = (ts) => Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  const daysUntilDue = (item) => {
    if (!item.due_date) return null;
    const d = new Date(item.due_date + "T00:00:00Z");
    const t = new Date(todayStr + "T00:00:00Z");
    return Math.floor((d - t) / 86400000);
  };

  // Sort: overdue/due-today first, then by due_date asc, then by inserted_at
  const urgencyScore = (item) => {
    const dtd = daysUntilDue(item);
    if (dtd !== null) return dtd; // negative = past due
    return daysSince(item.inserted_at); // no due date: treated as neutral
  };

  const open = items.filter(i => !i.resolved_at);
  const resolved = items.filter(i => !!i.resolved_at);
  const iOwe     = open.filter(i => i.direction === "i_owe").sort((a, b) => urgencyScore(a) - urgencyScore(b));
  const waitingOn = open.filter(i => i.direction === "waiting_on").sort((a, b) => urgencyScore(a) - urgencyScore(b));

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
    const dtd = daysUntilDue(item);
    const daysSinceAdded = daysSince(item.inserted_at);
    // Overdue: has due_date and it's past, OR no due_date and i_owe for 7+ days
    const isOverdue = dtd !== null ? dtd < 0 : (item.direction === "i_owe" && daysSinceAdded >= 7);
    const isDueToday = dtd === 0;
    const isDueSoon  = dtd !== null && dtd > 0 && dtd <= 3;
    const dueBadgeColor = isOverdue ? T.coral : isDueToday ? T.amber : isDueSoon ? T.gold : T.text3;
    const leftBorder = isOverdue ? T.coral : item.direction === "i_owe" ? T.accent : T.coral;

    const dueDateLabel = (() => {
      if (dtd === null) return `${daysSinceAdded === 0 ? "today" : `${daysSinceAdded}d ago`}`;
      if (dtd < 0) return `${Math.abs(dtd)}d overdue`;
      if (dtd === 0) return "due today";
      if (dtd === 1) return "due tomorrow";
      return `due in ${dtd}d`;
    })();

    return (
      <div style={{ background: isOverdue ? `${T.coral}08` : isDueToday ? `${T.amber}06` : T.navy2, border: `1px solid ${isOverdue ? T.coral + "40" : isDueToday ? T.amber + "30" : T.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8, borderLeft: `3px solid ${leftBorder}` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: T.text1, fontWeight: 500, lineHeight: 1.4 }}>{item.what}</div>
              {isOverdue && <span style={{ fontSize: 10, background: `${T.coral}22`, color: T.coral, padding: "1px 6px", borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>OVERDUE</span>}
              {isDueToday && !isOverdue && <span style={{ fontSize: 10, background: `${T.amber}22`, color: T.amber, padding: "1px 6px", borderRadius: 4, fontWeight: 700, flexShrink: 0 }}>DUE TODAY</span>}
            </div>
            <div style={{ fontSize: 11, color: T.text3, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              {item.direction === "i_owe" ? "→ " : "← "}<span style={{ color: T.text2, fontWeight: 500 }}>{item.person}</span>
              <span style={{ color: dueBadgeColor, marginLeft: 4 }}>· {dueDateLabel}</span>
              {item.due_date && (
                <span style={{ color: T.text3, fontSize: 10, marginLeft: 4 }}>({new Date(item.due_date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })})</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button onClick={() => resolve(item.id)} title="Mark done" style={{ background: `${T.teal}18`, color: T.teal, border: `1px solid ${T.teal}40`, borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>✓ Done</button>
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
          <input className="form-input" placeholder="Person" value={form.person} style={{ width: 130, flex: "none" }} onChange={e => setForm(f => ({ ...f, person: e.target.value }))} />
          <input className="form-input" placeholder="What exactly…" value={form.what} style={{ flex: 1, minWidth: 160 }} onChange={e => setForm(f => ({ ...f, what: e.target.value }))} onKeyDown={e => e.key === "Enter" && add()} />
          {dueDateOk && (
            <input type="date" className="form-input" title="Due date (optional)" value={form.due_date} style={{ width: 140, flex: "none", color: form.due_date ? T.text1 : T.text3 }} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} min={todayStr} />
          )}
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
        <div className="card" style={{ textAlign: "center", padding: "40px 32px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🐛</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text1, marginBottom: 8 }}>No incidents logged yet</div>
          <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.7, maxWidth: 360, margin: "0 auto 20px" }}>Log every escaped defect and prod issue. Patterns across root causes, modules, and severity emerge after just 3–4 entries — invaluable evidence for retrospectives.</div>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Log First Incident</button>
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
        <div className="card" style={{ textAlign: "center", padding: "40px 32px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text1, marginBottom: 8 }}>{search ? "No matching decisions" : "No decisions logged yet"}</div>
          <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.7, maxWidth: 380, margin: "0 auto 20px" }}>
            Log architectural choices, process calls, and team decisions. Boring now — invaluable when someone asks "why did we do it this way?" in six months.
          </div>
          {!search && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Log First Decision</button>}
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
const RELEASE_KEY = "echo_release_logs"; // legacy key — used only for one-time migration
const RELEASE_LS_KEY = "echo_rl_v2"; // localStorage backup — always written regardless of DB state

const _lsSaveRelease = (date, owners) => {
  try {
    const all = JSON.parse(localStorage.getItem(RELEASE_LS_KEY) || "{}");
    all[date] = { owners, ts: Date.now() }; // store timestamp alongside data
    localStorage.setItem(RELEASE_LS_KEY, JSON.stringify(all));
  } catch {}
};
const _lsLoadRelease = (date) => {
  try {
    const entry = JSON.parse(localStorage.getItem(RELEASE_LS_KEY) || "{}")?.[date];
    if (!entry) return null;
    // handle legacy format (plain array) and new format ({owners, ts})
    if (Array.isArray(entry)) return { owners: entry, ts: 0 };
    return entry;
  } catch { return null; }
};

const getReleaseDay = async (date, userId) => {
  const lsEntry = _lsLoadRelease(date);
  const lsOwners = lsEntry?.owners || null;
  const lsTs = lsEntry?.ts || 0;

  const supported = await probeReleaseTable();
  if (supported) {
    try {
      // order=updated_at.desc ensures we always read the LATEST row (fixes missing-unique-constraint duplication bug)
      const r = await fetch(`${_REST()}/release_logs?user_id=eq.${userId}&release_date=eq.${date}&select=owners,updated_at&order=updated_at.desc&limit=1`, { headers: h() });
      if (r.ok) {
        const rows = await r.json();
        if (rows?.length > 0) {
          const dbOwners = rows[0].owners || [];
          const dbTs = rows[0].updated_at ? new Date(rows[0].updated_at).getTime() : 0;
          // prefer whichever version is newer — handles partial-save scenarios
          if (dbTs >= lsTs) return dbOwners;
          return lsOwners || [];
        }
      }
    } catch {}
  }
  return lsOwners || [];
};

const saveReleaseDay = (date, owners, userId) => {
  _lsSaveRelease(date, owners);
  if (_rlSupported === false) return;
  fetch(`${_REST()}/release_logs`, {
    method: "POST",
    headers: { ...h(), Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId, release_date: date, owners, updated_at: new Date().toISOString() }),
  }).then(r => { if (!r.ok) _rlSupported = false; }).catch(() => { _rlSupported = false; });
};

function ReleaseTracker({ user }) {
  const userId = user?.id;
  const [date, setDate] = useState(today);
  const [owners, setOwners] = useState([]);
  const [rlLoading, setRlLoading] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemForm, setItemForm] = useState({ ticket: "", note: "", status: "today", action: "" });
  const [addingItemFor, setAddingItemFor] = useState(null);
  const [copied, setCopied] = useState(false);
  const [rlTableMissing, setRlTableMissing] = useState(false);
  const [manualOwnerName, setManualOwnerName] = useState("");

  // Load data for a date from Supabase
  const loadDate = useCallback(async (d) => {
    setDate(d);
    setAddingItemFor(null);
    setEditingItem(null);
    if (!userId) return;
    setRlLoading(true);
    const data = await getReleaseDay(d, userId);
    setOwners(data);
    setRlLoading(false);
  }, [userId]);

  // Initial load + table probe + one-time localStorage migration
  useEffect(() => {
    if (!userId) return;
    const todayStr = today();
    probeReleaseTable().then(ok => { if (!ok) setRlTableMissing(true); });
    // Migrate any existing localStorage data to Supabase (runs once)
    const legacy = localStorage.getItem(RELEASE_KEY);
    if (legacy) {
      try {
        const all = JSON.parse(legacy);
        Object.entries(all).forEach(([d, ownerArr]) => {
          if (Array.isArray(ownerArr) && ownerArr.length > 0) {
            saveReleaseDay(d, ownerArr, userId);
          }
        });
      } catch {}
      localStorage.removeItem(RELEASE_KEY);
    }
    loadDate(todayStr);
  }, [userId, loadDate]);

  const persist = (next) => { setOwners(next); saveReleaseDay(date, next, userId); };

  const shiftDate = (days) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    loadDate(d.toISOString().slice(0, 10));
  };

  const removeOwner = (idx) => { if (!window.confirm("Remove this owner?")) return; persist(owners.filter((_, i) => i !== idx)); };

  const startAddItem = (ownerIdx) => { setAddingItemFor(ownerIdx); setEditingItem(null); setItemForm({ ticket: "", note: "", status: "today", action: "" }); };
  const addItem = (ownerIdx) => {
    const t = itemForm.ticket.trim(), n = itemForm.note.trim();
    if (!t && !n) return;
    const next = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: [...o.items, { ticket: t, note: n, status: itemForm.status, action: itemForm.action.trim() }] });
    persist(next); setAddingItemFor(null); setItemForm({ ticket: "", note: "", status: "today", action: "" });
  };
  const startEditItem = (ownerIdx, itemIdx) => {
    setEditingItem({ ownerIdx, itemIdx }); setAddingItemFor(null);
    const item = owners[ownerIdx].items[itemIdx];
    setItemForm({ ticket: item.ticket || "", note: item.note || "", status: item.status || "today", action: item.action || "" });
  };
  const saveEditItem = () => {
    const { ownerIdx, itemIdx } = editingItem;
    const next = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: o.items.map((it, j) => j !== itemIdx ? it : { ticket: itemForm.ticket.trim(), note: itemForm.note.trim(), status: itemForm.status, action: itemForm.action.trim() }) });
    persist(next); setEditingItem(null);
  };
  const removeItem = (ownerIdx, itemIdx) => {
    const next = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: o.items.filter((_, j) => j !== itemIdx) });
    persist(next);
  };
  const cycleStatus = (ownerIdx, itemIdx) => {
    const keys = RELEASE_STATUSES.map(s => s.key);
    const cur = owners[ownerIdx].items[itemIdx].status || "today";
    const nextKey = keys[(keys.indexOf(cur) + 1) % keys.length];
    const updated = owners.map((o, i) => i !== ownerIdx ? o : { ...o, items: o.items.map((it, j) => j !== itemIdx ? it : { ...it, status: nextKey }) });
    persist(updated);
  };

  const allItems = owners.flatMap(o => o.items);
  const stats = RELEASE_STATUSES.map(s => ({ ...s, count: allItems.filter(i => i.status === s.key).length })).filter(s => s.count > 0);

  const displayDate = (() => {
    const t = today();
    const addDay = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    if (date === t) return "Today";
    if (date === addDay(t, 1)) return "Tomorrow";
    if (date === addDay(t, -1)) return "Yesterday";
    return new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  })();

  const copyReport = () => {
    const dateLabel = new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    let lines = [`📊 Release Status — ${dateLabel}`, ""];

    // Attendance section — only shown if any owner has an attendance status set
    const withAtt = owners.filter(o => o.att);
    if (withAtt.length > 0) {
      lines.push("👥 Team Availability");
      owners.forEach(o => {
        const att = OWNER_ATT.find(a => a.key === o.att);
        lines.push(`   ${att ? att.icon + " " + o.name + " — " + att.label : "✅ " + o.name + " — In Office"}`);
      });
      lines.push("");
    }

    if (owners.length === 0) {
      lines.push("No entries.");
    } else {
      owners.forEach(o => {
        lines.push(`👤 ${o.name}`);
        if (o.items.length === 0) { lines.push("   (no items)"); }
        else {
          o.items.forEach(it => {
            const rs = RELEASE_STATUSES.find(s => s.key === it.status);
            const desc = [it.ticket, it.note].filter(Boolean).join(" — ");
            const actionLine = it.action ? `\n     → Needs to: ${it.action}` : "";
            lines.push(`   ${rs?.icon || "•"} ${desc}  [${rs?.label || it.status}]${actionLine}`);
          });
        }
        lines.push("");
      });
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  };

  const teammates = loadTeammates().filter(t => (t.relationship || "direct") === "direct");
  const myName = user?.user_metadata?.display_name || localStorage.getItem("echo_display_name") || "";
  const selfNotAdded = myName && !owners.some(o => o.name.toLowerCase() === myName.toLowerCase());
  const selfChip = selfNotAdded ? [{ name: myName, emoji: "🙋" }] : [];
  const unaddedTeammates = [...selfChip, ...teammates.filter(t => !owners.some(o => o.name.toLowerCase() === t.name.toLowerCase()))];

  const ownerAccent = (items) => {
    if (items.some(i => i.status === "blocked")) return T.coral;
    if (items.some(i => i.status === "eta")) return T.amber;
    if (items.some(i => i.status === "review" || i.status === "today" || i.status === "tomorrow")) return T.accent;
    if (items.every(i => i.status === "released")) return "#4CAF50";
    if (items.length === 0) return T.borderHover;
    return T.text3;
  };

  if (rlLoading) return (
    <div className="echo-content fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, color: T.text3, fontSize: 13 }}>
      Loading release data…
    </div>
  );

  return (
    <div className="echo-content fade-in">

      {rlTableMissing && (
        <div style={{ marginBottom: 16, padding: "12px 16px", background: "rgba(240,117,98,0.1)", border: `1px solid ${T.coral}`, borderRadius: 10, fontSize: 12 }}>
          <div style={{ color: T.coral, fontWeight: 700, marginBottom: 6 }}>⚠️ Release Status table not set up — data is being saved locally only</div>
          <div style={{ color: T.text2, marginBottom: 8 }}>Run this once in your <strong>Supabase SQL editor</strong> to enable cloud saving:</div>
          <pre style={{ background: T.navy1, borderRadius: 7, padding: "8px 12px", fontSize: 11, color: T.teal, overflowX: "auto", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{`create table release_logs (id uuid primary key default gen_random_uuid(), user_id uuid not null, release_date date not null, owners jsonb default '[]', updated_at timestamptz default now(), unique(user_id, release_date));\nalter table release_logs enable row level security;\ncreate policy "own" on release_logs for all using (auth.uid()=user_id);`}</pre>
          <div style={{ color: T.text3, fontSize: 11, marginTop: 6 }}>After running, reload the page. Your locally saved data will sync automatically.</div>
        </div>
      )}

      {/* ── Top bar: date nav + copy button ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {/* Date navigator */}
        <div style={{ display: "flex", alignItems: "center", background: T.navy3, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
          <button onClick={() => shiftDate(-1)}
            style={{ padding: "8px 13px", background: "none", border: "none", borderRight: `1px solid ${T.border}`, color: T.text2, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>‹</button>
          <div style={{ position: "relative" }}>
            <input type="date" value={date} onChange={e => loadDate(e.target.value)}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
            <div style={{ padding: "8px 18px", fontSize: 13, fontWeight: 700, color: T.text1, fontFamily: "'Syne', sans-serif", minWidth: 130, textAlign: "center", userSelect: "none" }}>
              {(displayDate === "Today" || displayDate === "Tomorrow" || displayDate === "Yesterday")
                ? <><span style={{ color: T.accent }}>{displayDate}</span><span style={{ color: T.text3, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{new Date(date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></>
                : displayDate}
            </div>
          </div>
          <button onClick={() => shiftDate(1)}
            style={{ padding: "8px 13px", background: "none", border: "none", borderLeft: `1px solid ${T.border}`, color: T.text2, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>›</button>
        </div>

        {/* Quick date chips */}
        {[["Yesterday", -1], ["Today", 0], ["Tomorrow", 1]].map(([label, offset]) => {
          const d = new Date(today() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + offset);
          const ds = d.toISOString().slice(0, 10);
          const active = date === ds;
          return (
            <button key={label} onClick={() => loadDate(ds)} style={{ padding: "6px 13px", fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: "pointer", transition: "all 0.15s", fontFamily: "'DM Sans', sans-serif", background: active ? T.accent : "transparent", color: active ? "#fff" : T.text3, border: `1px solid ${active ? T.accent : T.border}` }}>
              {label}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* Copy report */}
        <button onClick={copyReport} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", background: copied ? "#4CAF5018" : T.navy3, color: copied ? "#4CAF50" : T.text1, border: `1px solid ${copied ? "#4CAF5050" : T.borderHover}` }}>
          <span style={{ fontSize: 14 }}>{copied ? "✓" : "📋"}</span>
          {copied ? "Copied to clipboard!" : "Copy Report"}
        </button>
      </div>

      {/* ── Summary stats strip ── */}
      {stats.length > 0 && (
        <div style={{ display: "flex", gap: 7, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
          {stats.map(s => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 20, background: `${s.color}14`, border: `1px solid ${s.color}28`, fontSize: 11, color: s.color, fontWeight: 600 }}>
              {s.icon} {s.label} <span style={{ opacity: 0.65 }}>· {s.count}</span>
            </div>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: T.text3 }}>{allItems.length} item{allItems.length !== 1 ? "s" : ""} · {owners.length} owner{owners.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      {/* ── Add owner bar — chips for known teammates + free-text input for anyone ── */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 18, alignItems: "center", padding: "10px 14px", background: T.navy2, borderRadius: 10, border: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 11, color: T.text3, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>Add owner</span>
        {unaddedTeammates.map((t, i) => (
          <button key={i} onClick={() => persist([...owners, { name: t.name, items: [] }])}
            style={{ padding: "4px 11px", fontSize: 12, borderRadius: 16, cursor: "pointer", background: "transparent", color: T.text2, border: `1px solid ${T.border}`, fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
            {t.emoji || "👤"} {t.name}
          </button>
        ))}
        <form onSubmit={e => { e.preventDefault(); const n = manualOwnerName.trim(); if (!n || owners.some(o => o.name.toLowerCase() === n.toLowerCase())) return; persist([...owners, { name: n, items: [] }]); setManualOwnerName(""); }}
          style={{ display: "flex", gap: 5, alignItems: "center", marginLeft: "auto" }}>
          <input value={manualOwnerName} onChange={e => setManualOwnerName(e.target.value)}
            placeholder="Type a name…"
            style={{ padding: "4px 10px", fontSize: 12, borderRadius: 8, background: T.navy3, border: `1px solid ${T.border}`, color: T.text1, outline: "none", width: 130, fontFamily: "'DM Sans', sans-serif" }} />
          <button type="submit" disabled={!manualOwnerName.trim()}
            style={{ padding: "4px 11px", fontSize: 12, borderRadius: 8, cursor: manualOwnerName.trim() ? "pointer" : "default", background: manualOwnerName.trim() ? T.accent : "transparent", color: manualOwnerName.trim() ? "#fff" : T.text3, border: `1px solid ${manualOwnerName.trim() ? T.accent : T.border}`, fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
            + Add
          </button>
        </form>
      </div>

      {/* Empty state */}
      {owners.length === 0 && (
        <div style={{ textAlign: "center", color: T.text3, fontSize: 14, padding: "56px 24px", background: T.navy2, borderRadius: 12, border: `1px dashed ${T.borderHover}` }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
          <div style={{ fontWeight: 600, color: T.text2, marginBottom: 4 }}>No entries for {displayDate}</div>
          <div style={{ fontSize: 12 }}>Add owners above to start logging release status.</div>
        </div>
      )}

      {/* ── Owner cards ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {owners.map((owner, oi) => {
          const accent = ownerAccent(owner.items);
          const tmMeta = teammates.find(t => t.name === owner.name);
          return (
            <div key={oi} style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", borderLeft: `3px solid ${accent}` }}>

              {/* Owner header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: (owner.items.length > 0 || addingItemFor === oi) ? `1px solid ${T.border}` : "none" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: `${accent}1a`, border: `1.5px solid ${accent}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                  {tmMeta?.emoji || "👤"}
                </div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.text1, fontFamily: "'Syne', sans-serif" }}>{owner.name}</span>
                {/* Attendance toggle — cycles WFH / Half Day / Leave / clear */}
                {(() => {
                  const att = OWNER_ATT.find(a => a.key === owner.att);
                  const cycle = ["wfh", "half", "leave", null];
                  const cur = owner.att || null;
                  const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
                  return (
                    <button onClick={() => persist(owners.map((o, i) => i !== oi ? o : { ...o, att: next }))}
                      title={att ? `${att.label} — click to change` : "Set attendance"}
                      style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                        background: att ? `${att.color}18` : "transparent",
                        color: att ? att.color : T.text3,
                        border: `1px solid ${att ? att.color + "40" : T.border}` }}>
                      {att ? `${att.icon} ${att.label}` : "＋ Attendance"}
                    </button>
                  );
                })()}
                {/* Status mini-pills */}
                <div style={{ display: "flex", gap: 4 }}>
                  {RELEASE_STATUSES.filter(s => owner.items.some(i => i.status === s.key)).map(s => (
                    <span key={s.key} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}28`, fontWeight: 700 }}>
                      {s.icon} {owner.items.filter(i => i.status === s.key).length}
                    </span>
                  ))}
                </div>
                <button onClick={() => startAddItem(oi)}
                  style={{ padding: "5px 11px", fontSize: 11, fontWeight: 700, borderRadius: 7, cursor: "pointer", background: T.navy3, color: T.accent, border: `1px solid ${T.border}`, fontFamily: "'DM Sans', sans-serif" }}>
                  + Add
                </button>
                <button onClick={() => removeOwner(oi)}
                  style={{ padding: "5px 8px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: "transparent", color: T.text3, border: "none" }}>✕</button>
              </div>

              {/* Items list */}
              {owner.items.map((item, ii) => {
                const rs = RELEASE_STATUSES.find(s => s.key === item.status);
                const isEditing = editingItem?.ownerIdx === oi && editingItem?.itemIdx === ii;
                if (isEditing) {
                  return (
                    <div key={ii} style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, background: `${T.accent}07` }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input className="form-input" style={{ flex: 1 }} placeholder="Ticket / task name" value={itemForm.ticket}
                          onChange={e => setItemForm(f => ({ ...f, ticket: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && saveEditItem()} />
                        <select className="form-select" style={{ width: 150 }} value={itemForm.status} onChange={e => setItemForm(f => ({ ...f, status: e.target.value }))}>
                          {RELEASE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                        </select>
                      </div>
                      <input className="form-input" style={{ marginBottom: 8 }} placeholder={`What does ${owner.name} need to do? (e.g. "Deploy to prod after QA sign-off")`}
                        value={itemForm.action} onChange={e => setItemForm(f => ({ ...f, action: e.target.value }))} />
                      <textarea className="form-textarea" style={{ minHeight: 50, marginBottom: 8 }} placeholder="Release note / context… (optional)"
                        value={itemForm.note} onChange={e => setItemForm(f => ({ ...f, note: e.target.value }))} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={saveEditItem}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingItem(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={ii}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 16px", borderBottom: `1px solid ${T.border}`, transition: "background 0.12s" }}
                    onMouseEnter={e => e.currentTarget.style.background = `${T.accent}06`}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {/* Clickable status badge to cycle */}
                    <button onClick={() => cycleStatus(oi, ii)} title="Click to change status"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, marginTop: 2, fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s", background: `${rs?.color || T.text3}18`, color: rs?.color || T.text3, border: `1px solid ${rs?.color || T.text3}30` }}>
                      {rs?.icon} {rs?.label || item.status}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {item.ticket && <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{item.ticket}</span>}
                        <span style={{ fontSize: 11, color: T.text3, background: T.navy3, padding: "1px 7px", borderRadius: 8 }}>{owner.name}</span>
                      </div>
                      {item.action && (
                        <div style={{ fontSize: 11, color: T.amber, marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                          <span>→</span>
                          <span style={{ fontWeight: 600 }}>Needs to:</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.action}</span>
                        </div>
                      )}
                      {item.note && <div style={{ fontSize: 11, color: T.text3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.note}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0, marginTop: 2 }}>
                      <button onClick={() => startEditItem(oi, ii)}
                        style={{ padding: "3px 8px", fontSize: 11, borderRadius: 5, cursor: "pointer", background: "transparent", color: T.text3, border: `1px solid ${T.border}` }}>✏</button>
                      <button onClick={() => removeItem(oi, ii)}
                        style={{ padding: "3px 8px", fontSize: 11, borderRadius: 5, cursor: "pointer", background: "transparent", color: T.coral, border: `1px solid ${T.border}` }}>✕</button>
                    </div>
                  </div>
                );
              })}

              {/* Empty card state */}
              {owner.items.length === 0 && addingItemFor !== oi && (
                <div onClick={() => startAddItem(oi)}
                  style={{ padding: "14px 16px", fontSize: 12, color: T.text3, cursor: "pointer", textAlign: "center", fontStyle: "italic", transition: "color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.color = T.accent}
                  onMouseLeave={e => e.currentTarget.style.color = T.text3}>
                  Click to add first item for {owner.name}
                </div>
              )}

              {/* Inline add form */}
              {addingItemFor === oi && (
                <div style={{ padding: "12px 16px", background: `${T.accent}07`, borderTop: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: T.text3, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Adding item for {owner.name}</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input autoFocus className="form-input" style={{ flex: 1 }} placeholder="Ticket / task (e.g. DN-1234)"
                      value={itemForm.ticket} onChange={e => setItemForm(f => ({ ...f, ticket: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && addItem(oi)} />
                    <select className="form-select" style={{ width: 150 }} value={itemForm.status} onChange={e => setItemForm(f => ({ ...f, status: e.target.value }))}>
                      {RELEASE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
                    </select>
                  </div>
                  <input className="form-input" style={{ marginBottom: 8 }} placeholder={`What does ${owner.name} need to do? (action required)`}
                    value={itemForm.action} onChange={e => setItemForm(f => ({ ...f, action: e.target.value }))} />
                  <textarea className="form-textarea" style={{ minHeight: 50, marginBottom: 8 }} placeholder="Release note / context… (optional)"
                    value={itemForm.note} onChange={e => setItemForm(f => ({ ...f, note: e.target.value }))} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => addItem(oi)}>Add Item</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setAddingItemFor(null); setItemForm({ ticket: "", note: "", status: "today", action: "" }); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
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

// ─── Keyboard Shortcuts Modal (Cmd+?) ────────────────────────────────────────
function KeyboardShortcuts({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sections = [
    { heading: "Global", items: [
      { key: "⌘ K", desc: "Open command palette / search everything" },
      { key: "N", desc: "New diary entry (when no input focused)" },
      { key: "⌘ ?", desc: "Show this keyboard shortcuts panel" },
      { key: "Esc", desc: "Close any modal or palette" },
    ]},
    { heading: "Navigation", items: [
      { key: "1", desc: "Go to Dashboard" },
      { key: "2", desc: "Go to Corporate Diary" },
      { key: "3", desc: "Go to Commitments" },
      { key: "4", desc: "Go to Incident Log" },
      { key: "5", desc: "Go to Decision Log" },
      { key: "6", desc: "Go to Release Status" },
      { key: "7", desc: "Go to My Team" },
      { key: "8", desc: "Go to Brag Doc" },
      { key: "9", desc: "Go to Shadow Resume" },
    ]},
    { heading: "Search", items: [
      { key: "⌘ K → type", desc: "Navigate to any section by name" },
      { key: "⌘ K → @name", desc: "Find a team member" },
      { key: "⌘ K → diary text", desc: "Search diary entries" },
    ]},
    { heading: "Diary", items: [
      { key: "Enter", desc: "Add item to list (in input fields)" },
      { key: "Tab", desc: "Switch between diary tabs (My Day / Team / Actions)" },
    ]},
  ];
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()} style={{ zIndex: 10002 }}>
      <div className="modal-box" style={{ maxWidth: 440, width: "90%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text1 }}>Keyboard Shortcuts</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {sections.map(sec => (
          <div key={sec.heading} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{sec.heading}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sec.items.map(s => (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 12px", background: T.navy3, borderRadius: 8 }}>
                  <kbd style={{ background: T.navy4, border: `1px solid ${T.border}`, borderRadius: 6, padding: "2px 9px", fontSize: 12, color: T.accent, fontFamily: "monospace", whiteSpace: "nowrap", minWidth: 60, textAlign: "center" }}>{s.key}</kbd>
                  <span style={{ fontSize: 13, color: T.text2 }}>{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 4, fontSize: 11, color: T.text3, textAlign: "center" }}>Press Esc to close</div>
      </div>
    </div>
  );
}

// ─── Command Palette (Cmd+K / Ctrl+K) ────────────────────────────────────────
function CommandPalette({ onClose, setView, user }) {
  const [q, setQ] = useState("");
  const [diary, setDiary] = useState(null);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    probeUserIdDiary().then(uidOk => {
      const opts = { order: "date.desc" };
      if (uidOk && user?.id) opts.match = { user_id: user.id };
      db.from("diary_entries").select("id,date,content,mood,focus_areas", opts)
        .then(rows => setDiary((rows || []).slice(0, 60)));
    });
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const teammates = loadTeammates();
  const qL = q.toLowerCase();

  const QUICK = [
    { icon: "📓", label: "New diary entry",  desc: "Open diary and start today's log", act: () => { setView("diary"); onClose(); } },
    { icon: "🏠", label: "Dashboard",        desc: "Go to overview & calendar",         act: () => { setView("dashboard"); onClose(); } },
    { icon: "👥", label: "My Team",          desc: "Teammates + 1:1 sessions",          act: () => { setView("team"); onClose(); } },
    { icon: "🚀", label: "Release Status",   desc: "Team ticket and release tracking",  act: () => { setView("releases"); onClose(); } },
    { icon: "🤝", label: "Commitments",      desc: "Things you owe / are waiting on",   act: () => { setView("commitments"); onClose(); } },
    { icon: "🏆", label: "Brag Doc",         desc: "Wins and appraisal evidence",       act: () => { setView("brag"); onClose(); } },
    { icon: "📋", label: "Shadow Resume",    desc: "Auto-built career profile",         act: () => { setView("resume"); onClose(); } },
    { icon: "🧠", label: "Decision Log",     desc: "Architectural and process choices", act: () => { setView("decisions"); onClose(); } },
    { icon: "🐛", label: "Incident Log",     desc: "Escaped defects and prod issues",   act: () => { setView("incidents"); onClose(); } },
    { icon: "⭐", label: "Credit Tracker",   desc: "Given and received recognition",    act: () => { setView("credits"); onClose(); } },
  ];

  const filteredQuick = QUICK.filter(a => !q || a.label.toLowerCase().includes(qL) || a.desc.toLowerCase().includes(qL));
  const filteredTeam = teammates.filter(t => q && t.name.toLowerCase().includes(qL)).slice(0, 4);
  const filteredDiary = !diary ? [] : diary.filter(e =>
    q && (
      (e.content || "").toLowerCase().includes(qL) ||
      (e.date || "").includes(qL) ||
      (Array.isArray(e.focus_areas) ? e.focus_areas : e.focus_areas ? [e.focus_areas] : []).some(f => f.toLowerCase().includes(qL))
    )
  ).slice(0, 5);

  const groups = [
    ...(filteredQuick.length ? [{ type: "header", label: q ? "Navigation" : "Quick actions" }] : []),
    ...filteredQuick.map(a => ({ type: "action", data: a })),
    ...(filteredTeam.length ? [{ type: "header", label: "Team members" }] : []),
    ...filteredTeam.map(t => ({ type: "teammate", data: t })),
    ...(filteredDiary.length ? [{ type: "header", label: "Diary entries" }] : []),
    ...filteredDiary.map(e => ({ type: "diary", data: e })),
  ];
  const clickables = groups.filter(g => g.type !== "header");

  const activate = (item) => {
    if (item.type === "action") item.data.act();
    else if (item.type === "teammate") { setView("team"); onClose(); }
    else if (item.type === "diary") { localStorage.setItem("echo_diary_jump", item.data.date); setView("diary"); onClose(); }
  };

  const handleKey = (e) => {
    if (e.key === "ArrowDown") { setSel(s => Math.min(s + 1, clickables.length - 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setSel(s => Math.max(s - 1, 0)); e.preventDefault(); }
    else if (e.key === "Enter" && clickables[sel]) { activate(clickables[sel]); }
  };

  let clickIdx = -1;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
      zIndex: 99999, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.navy1, border: `1px solid ${T.borderHover}`,
        borderRadius: 16, width: "100%", maxWidth: 620, boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px ${T.border}`,
        overflow: "hidden", maxHeight: "70vh", display: "flex", flexDirection: "column",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 18, color: T.text3, flexShrink: 0 }}>🔍</span>
          <input
            ref={inputRef} value={q}
            onChange={e => { setQ(e.target.value); setSel(0); }}
            onKeyDown={handleKey}
            placeholder="Search diary, teammates, navigate…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 16, color: T.text1, fontFamily: "'DM Sans', sans-serif",
            }}
          />
          <span style={{ fontSize: 11, color: T.text3, background: T.navy3, padding: "2px 7px", borderRadius: 5, flexShrink: 0 }}>Esc</span>
        </div>
        {/* Results */}
        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {diary === null && q === "" && (
            <div style={{ fontSize: 12, color: T.text3, textAlign: "center", padding: "8px 0" }}>Loading diary…</div>
          )}
          {groups.map((item, gi) => {
            if (item.type === "header") {
              return (
                <div key={gi} style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: 1, textTransform: "uppercase", padding: "10px 18px 4px" }}>
                  {item.label}
                </div>
              );
            }
            clickIdx++;
            const ci = clickIdx;
            const isSelected = sel === ci;
            if (item.type === "action") {
              return (
                <div key={gi} onClick={() => activate(item)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "9px 18px", cursor: "pointer",
                    background: isSelected ? `${T.accent}15` : "transparent",
                    borderLeft: isSelected ? `2px solid ${T.accent}` : "2px solid transparent",
                    transition: "background 0.1s",
                  }}>
                  <span style={{ fontSize: 17, flexShrink: 0 }}>{item.data.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: isSelected ? T.text1 : T.text2 }}>{item.data.label}</div>
                    <div style={{ fontSize: 11, color: T.text3 }}>{item.data.desc}</div>
                  </div>
                </div>
              );
            }
            if (item.type === "teammate") {
              return (
                <div key={gi} onClick={() => activate(item)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "9px 18px", cursor: "pointer",
                    background: isSelected ? `${T.teal}12` : "transparent",
                    borderLeft: isSelected ? `2px solid ${T.teal}` : "2px solid transparent",
                  }}>
                  <span style={{ fontSize: 17, flexShrink: 0 }}>{item.data.emoji || "👤"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: T.text2 }}>{item.data.name}</div>
                    {item.data.role && <div style={{ fontSize: 11, color: T.text3 }}>{item.data.role}</div>}
                  </div>
                  <span style={{ fontSize: 10, color: T.text3, background: T.navy3, padding: "2px 6px", borderRadius: 4 }}>Team</span>
                </div>
              );
            }
            if (item.type === "diary") {
              const preview = (item.data.content || "").split("\n").find(l => l.trim())?.trim().slice(0, 80) || "No content";
              return (
                <div key={gi} onClick={() => activate(item)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 18px", cursor: "pointer",
                    background: isSelected ? `${T.gold}10` : "transparent",
                    borderLeft: isSelected ? `2px solid ${T.gold}` : "2px solid transparent",
                  }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 2 }}>📓</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{item.data.date}</div>
                  </div>
                </div>
              );
            }
            return null;
          })}
          {q && filteredQuick.length === 0 && filteredTeam.length === 0 && filteredDiary.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0", color: T.text3, fontSize: 13 }}>No results for "{q}"</div>
          )}
        </div>
        <div style={{ padding: "8px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 16, fontSize: 11, color: T.text3 }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

export default function Echo() {
  useEffect(() => { injectStyles(); }, []);
  const [view, setView]               = useState(() => localStorage.getItem("echo_view") || "dashboard");
  const [diaryCount, setDiaryCount]   = useState(0);
  const [docCount, setDocCount]       = useState(0);
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [padOpen, setPadOpen]                 = useState(false);
  const [showPatternInterrupt, setShowPatternInterrupt] = useState(false);
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [profileOpen, setProfileOpen]         = useState(false);
  const [displayName, setDisplayName]         = useState(() => localStorage.getItem("echo_display_name") || "");
  const [avatarData, setAvatarData]           = useState(() => localStorage.getItem("echo_avatar") || "");
  const [profileDraft, setProfileDraft]       = useState({ name: "", avatar: "" });
  const [paletteOpen, setPaletteOpen]         = useState(false);
  const [shortcutsOpen, setShortcutsOpen]     = useState(false);
  const [overdueCount, setOverdueCount]       = useState(0);
  const [teamDueBadge, setTeamDueBadge]       = useState(false);
  const [todayEntryMissing, setTodayEntryMissing] = useState(false);

  useEffect(() => {
    db.auth.getUser().then(u => {
      if (u?.id) {
        setUser(u);
        // Seed display name from Supabase user_metadata (cross-device safe)
        const metaName = u.user_metadata?.display_name;
        if (metaName) {
          setDisplayName(metaName);
          localStorage.setItem("echo_display_name", metaName);
        }
        const metaAvatar = u.user_metadata?.avatar;
        if (metaAvatar) {
          setAvatarData(metaAvatar);
          localStorage.setItem("echo_avatar", metaAvatar);
        }
      }
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
  }, []);

  useEffect(() => { localStorage.setItem("echo_view", view); }, [view]);

  // Keep browser tab title in sync with current section and alert count
  useEffect(() => {
    const meta = PAGE_META[view];
    const prefix = overdueCount > 0 && view === "commitments" ? `(${overdueCount}) ` : "";
    document.title = meta ? `${prefix}${meta.title} — Echo` : "Echo";
  }, [view, overdueCount]);

  useEffect(() => {
    if (!user) return;
    refreshTeammates();
    refreshScratchNotes(user.id);
  }, [user]);

  useEffect(() => {
    if (!user || !isConfigured()) return;
    probeUserIdDiary().then(uidOk => {
      const dOpts = uidOk && user?.id ? { match: { user_id: user.id } } : {};
      db.from("diary_entries").select("id", dOpts).then(rows => setDiaryCount((rows || []).length));
      const todayStr = today();
      const todayDow = new Date(todayStr + "T00:00:00Z").getUTCDay();
      if (todayDow !== 0 && todayDow !== 6) {
        const uidParam = uidOk && user?.id ? `&user_id=eq.${user.id}` : "";
        fetch(`${_REST()}/diary_entries?date=eq.${todayStr}${uidParam}&select=id&limit=1`, { headers: h() })
          .then(r => r.json()).then(rows => setTodayEntryMissing(!(rows && rows.length > 0))).catch(() => {});
      }
    });
    db.from("documents").select("id").then(rows => setDocCount((rows || []).length));
    // Overdue "I owe" commitments — use due_date if present, else 7-day fallback
    db.from("commitments").select("direction,inserted_at,resolved_at,due_date").then(rows => {
      const todayD = today();
      const overdue = (rows || []).filter(r => {
        if (r.resolved_at || r.direction !== "i_owe") return false;
        if (r.due_date) return r.due_date < todayD;
        return (Date.now() - new Date(r.inserted_at).getTime()) > 7 * 86400000;
      });
      setOverdueCount(overdue.length);
    });
    // Team 1:1 due badge — last week of month + direct reports without session
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (lastDay - now.getDate() < 7) {
      const monthStart = now.toISOString().slice(0, 7) + "-01";
      const members = (loadTeammates() || []).filter(t => (t.relationship || "direct") === "direct");
      if (members.length) {
        fetch(`${_REST()}/one_on_one_sessions?select=teammate_id&session_date=gte.${monthStart}`, { headers: h() })
          .then(r => r.ok ? r.json() : [])
          .then(rows => {
            const done = new Set((rows || []).map(s => s.teammate_id));
            setTeamDueBadge(members.some(m => !done.has(m.id)));
          }).catch(() => {});
      }
    }
  }, [user]);

  // Global keyboard shortcuts: Cmd+K → palette, N → new diary entry, 1-9 → sections, Cmd+? → shortcuts
  useEffect(() => {
    if (!user) return;
    const NAV_KEYS = { "1": "dashboard", "2": "diary", "3": "commitments", "4": "incidents", "5": "decisions", "6": "releases", "7": "team", "8": "brag", "9": "resume" };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen(p => !p); }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") { e.preventDefault(); setShortcutsOpen(p => !p); }
      const isBody = document.activeElement.tagName === "BODY";
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && isBody) { setShortcutsOpen(p => !p); }
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && isBody) {
        setView("diary"); localStorage.setItem("echo_diary_new", "1");
      }
      if (NAV_KEYS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey && isBody) {
        setView(NAV_KEYS[e.key]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [user]);

  useEffect(() => {
    if (!user || !isConfigured()) return;
    const dismissed = localStorage.getItem("echo_pi_dismissed");
    if (dismissed && Date.now() - Number(dismissed) < 86400000) return;
    probeUserIdDiary().then(uidOk => {
      const opts = { order: "date.desc" };
      if (uidOk && user?.id) opts.match = { user_id: user.id };
      db.from("diary_entries").select("date,mood", opts).then(rows => {
      if (!rows || rows.length < 3) return;
      const badMoods = ["frustrated", "challenged"];
      let streak = 0;
      for (const e of rows.slice(0, 5)) {
        if (badMoods.includes(e.mood)) streak++;
        else break;
      }
      if (streak >= 3) setShowPatternInterrupt(true);
      });
    });
  }, [user]);


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
    // Persist to Supabase user_metadata so it survives device/browser changes
    const token = localStorage.getItem("echo_token") || SUPABASE_ANON_KEY;
    fetch(`${_AUTH()}/user`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { display_name: profileDraft.name, avatar: profileDraft.avatar || null } }),
    }).catch(() => {});
    toast("Profile saved");
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
    <div style={{ minHeight: "100vh", background: T.navy0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, fontFamily: "'DM Sans', sans-serif" }}>
      <EchoLogo size={28} withText dark />
      <div className="echo-loading-dots">
        <div className="echo-loading-dot" />
        <div className="echo-loading-dot" />
        <div className="echo-loading-dot" />
      </div>
    </div>
  );

  if (!user) return <AuthPage onLogin={u => { setUser(u); }} />;

  const isOwner = user.email === OWNER_EMAIL;
  const visibleNav = NAV.filter(n => n.id !== "locker" || isOwner);
  const sections   = [...new Set(visibleNav.map(n => n.section))];
  const NAV_SHORTCUT = { dashboard: "1", diary: "2", commitments: "3", incidents: "4", decisions: "5", releases: "6", team: "7", brag: "8", resume: "9" };

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
                  <NavIcon id={n.id} />
                  <span>{n.label}</span>
                  {n.id === "diary" && diaryCount > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, background: "rgba(79,142,247,0.15)", color: T.accent, padding: "1px 7px", borderRadius: 10 }}>{diaryCount}</span>
                  )}
                  {n.id === "locker" && docCount > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, background: "rgba(63,207,180,0.15)", color: T.teal, padding: "1px 7px", borderRadius: 10 }}>{docCount}</span>
                  )}
                  {n.id === "commitments" && overdueCount > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 10, background: `${T.coral}22`, color: T.coral, padding: "1px 7px", borderRadius: 10, fontWeight: 700 }} title="Overdue commitments">{overdueCount} late</span>
                  )}
                  {n.id === "team" && teamDueBadge && (
                    <span style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", background: T.amber, flexShrink: 0 }} title="1:1s due this month" />
                  )}
                  {NAV_SHORTCUT[n.id] && !((n.id === "diary" && diaryCount > 0) || (n.id === "commitments" && overdueCount > 0) || (n.id === "team" && teamDueBadge) || (n.id === "locker" && docCount > 0)) && (
                    <span className="nav-hint">{NAV_SHORTCUT[n.id]}</span>
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
              <div style={{ fontSize: 12, color: T.text1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName || user.email.split("@")[0]}</div>
              <div style={{ fontSize: 10, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            </div>
          </div>
          {isOwner && <div style={{ fontSize: 10, color: T.teal, marginBottom: 4, paddingLeft: 8 }}>Owner</div>}


          <div style={{ display: "flex", gap: 6, marginBottom: 0 }}>
            <button onClick={async () => {
              const uidOk = await probeUserIdDiary();
              const dOpts = { order: "date.desc", ...(uidOk && user?.id ? { match: { user_id: user.id } } : {}) };
              const [diary, commits, decisions, incidents, credits, teammates] = await Promise.all([
                db.from("diary_entries").select("*", dOpts),
                db.from("commitments").select("*", { order: "inserted_at.asc" }),
                db.from("decisions").select("*", { order: "date.desc" }),
                db.from("incidents").select("*", { order: "date.desc" }),
                db.from("user_credits").select("*", { order: "inserted_at.asc" }),
                db.from("teammates").select("*"),
              ]);
              const data = { exported_at: new Date().toISOString(), diary_entries: diary || [], commitments: commits || [], decisions: decisions || [], incidents: incidents || [], credits: credits || [], teammates: teammates || [] };
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `echo-export-${new Date().toISOString().slice(0,10)}.json`;
              a.click(); URL.revokeObjectURL(url);
              toast("Data exported as JSON", "info");
            }} style={{
              flex: 1, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.text3, cursor: "pointer", fontSize: 11, padding: "5px 0",
              fontFamily: "'DM Sans', sans-serif",
            }} title="Download all your data as JSON">⬇ Export</button>
            <button onClick={logout} style={{
              flex: 1, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6,
              color: T.text3, cursor: "pointer", fontSize: 11, padding: "5px 0",
              fontFamily: "'DM Sans', sans-serif",
            }}>Sign out</button>
          </div>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {todayEntryMissing && view !== "diary" && (
              <button onClick={() => { setView("diary"); localStorage.setItem("echo_diary_new", "1"); setTodayEntryMissing(false); }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: `${T.amber}18`, border: `1px solid ${T.amber}40`, color: T.amber, fontFamily: "'DM Sans', sans-serif", transition: "opacity 0.15s" }}
                title="No diary entry for today yet">
                📓 Log today
              </button>
            )}
            <button onClick={() => setPaletteOpen(true)} style={{
              display: "flex", alignItems: "center", gap: 7,
              background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.text3, cursor: "pointer", fontSize: 12, padding: "6px 12px",
              fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderHover; e.currentTarget.style.color = T.text2; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.text3; }}
              title="Search everything (Cmd+K)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="7" r="4"/><path d="M10.5 10.5 14 14"/></svg>
              <span style={{ fontSize: 10, background: T.navy3, padding: "1px 6px", borderRadius: 4 }}>⌘K</span>
            </button>
            <button onClick={() => setShortcutsOpen(true)} style={{
              background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.text3, cursor: "pointer", fontSize: 13, padding: "5px 10px",
              fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s", lineHeight: 1,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.borderHover; e.currentTarget.style.color = T.text2; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.text3; }}
              title="Keyboard shortcuts (?)">?</button>
            <div className="topbar-divider" />
            <div style={{ fontSize: 13, color: T.text3 }}>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
          </div>
        </div>

        {view === "dashboard"   && <Dashboard setView={setView} diaryCount={diaryCount} docCount={docCount} user={user} displayName={displayName} />}
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
        {view === "releases"    && <ReleaseTracker user={user} />}
        {view === "team"        && <MyTeam user={user} />}
        {view === "brag"        && <BragDoc user={user} />}
        {view === "resume"      && <ShadowResume user={user} />}
        {view === "workmap"     && <WorkMap user={user} />}
        {view === "credits"     && <CreditTracker user={user} />}
        {view === "resolve"     && <Resolve user={user} />}
      </main>

      {/* ── Command Palette ── */}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} setView={setView} user={user} />}

      {/* ── Keyboard Shortcuts ── */}
      {shortcutsOpen && <KeyboardShortcuts onClose={() => setShortcutsOpen(false)} />}

      {/* ── Pattern Interrupt overlay ── */}
      {showPatternInterrupt && (
        <PatternInterrupt onDismiss={() => {
          setShowPatternInterrupt(false);
          localStorage.setItem("echo_pi_dismissed", String(Date.now()));
        }} user={user} />
      )}

      {/* ── Floating Scratch Pad ── */}
      {padOpen && <ScratchPad onClose={() => setPadOpen(false)} user={user} />}

      {/* ── Toast notifications ── */}
      <ToastContainer />

      {/* ── Profile Modal ── */}
      {profileOpen && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setProfileOpen(false)}
          style={{ zIndex: 10001 }}>
          <div className="modal-box" style={{ maxWidth: 380, width: "90%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text1 }}>Edit Profile</div>
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
        {padOpen ? "✕" : (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 3.5 16 5l-9.5 9.5H5v-1.5L14.5 3.5Z"/>
            <path d="M13 5l2 2"/>
          </svg>
        )}
      </button>
    </div>
  );
}
