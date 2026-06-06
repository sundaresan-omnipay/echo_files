import { useState, useEffect, useCallback, useRef } from "react";

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
    },
    getUser: async () => {
      const token = localStorage.getItem("echo_token");
      if (!token) return null;
      const r = await fetch(`${_AUTH()}/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { localStorage.removeItem("echo_token"); return null; }
      return r.json();
    },
  },
  from: (table) => ({
    select: async (cols = "*", opts = {}) => {
      let url = `${_REST()}/${table}?select=${cols}`;
      if (opts.eq) url += `&${opts.eq[0]}=eq.${opts.eq[1]}`;
      if (opts.order) url += `&order=${opts.order}`;
      const r = await fetch(url, { headers: h() });
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
      min-height: 100vh;
      background: ${T.navy1};
      border-right: 1px solid ${T.border};
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 10;
      flex-shrink: 0;
    }

    .echo-logo {
      padding: 28px 24px 20px;
      border-bottom: 1px solid ${T.border};
    }

    .echo-logo-text {
      font-family: 'Syne', sans-serif;
      font-size: 20px;
      font-weight: 800;
      background: linear-gradient(135deg, ${T.accent} 0%, ${T.teal} 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: 4px;
      text-transform: uppercase;
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
      font-family: 'Syne', sans-serif;
      font-size: 52px;
      font-weight: 800;
      letter-spacing: 10px;
      text-transform: uppercase;
      background: linear-gradient(135deg, ${T.accent} 0%, ${T.teal} 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1;
      margin-bottom: 10px;
      animation: authLogoShimmer 4s ease-in-out infinite;
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
  "Sprint Planning", "Debugging", "CI/CD", "Meetings", "Documentation", "Release"
];

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

const statusColor   = (s) => TEAM_STATUSES.find(x => x.key === s)?.color   || T.text3;
const feedbackColor = (t) => FEEDBACK_TYPES.find(x => x.key === t)?.color  || T.text3;
const priorityColor = (p) => PRIORITIES.find(x => x.key === p)?.color      || T.text3;

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
  ${entry.focus_area ? `<span>📌 ${esc(entry.focus_area)}</span>` : ""}
  ${(entry.collaborators||[]).length ? `<span>👥 ${entry.collaborators.map(esc).join(", ")}</span>` : ""}
</div>
${jiraChips ? `<div class="section-title">JIRAs</div><div>${jiraChips}</div>` : ""}
${section("What I Did", entry.content ? esc(entry.content) : "")}
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
function Dashboard({ setView, diaryCount, docCount }) {
  const [recentEntries, setRecentEntries] = useState([]);
  const [heatEntries, setHeatEntries]     = useState([]);
  const [recentDocs, setRecentDocs]       = useState([]);
  const [onThisDay, setOnThisDay]         = useState({ week: null, month: null });

  useEffect(() => {
    if (!isConfigured()) return;
    db.from("diary_entries").select("*", { order: "date.desc" }).then(d => {
      setRecentEntries((d || []).slice(0, 3));
      setHeatEntries(d || []);
    });
    db.from("documents").select("*", { order: "created_at.desc" }).then(d => setRecentDocs((d || []).slice(0, 4)));

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

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: T.text1 }}>{greeting}</div>
        <div style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>{new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
      </div>

      <div className="grid-4 mb-16">
        {[
          { label: "Diary Entries", value: diaryCount, color: T.accent, icon: "📓" },
          { label: "Documents", value: docCount, color: T.teal, icon: "🗂️" },
          { label: "This Month", value: recentEntries.filter(e => e.date?.startsWith(new Date().toISOString().slice(0,7))).length, color: T.gold, icon: "📅" },
          { label: "Today's Date", value: new Date().getDate(), color: T.coral, icon: "📌" },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

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
                  <div key={dateStr} title={`${wd} ${day}${entry ? ` — ${mood?.label || "No mood"} · ${entry.focus_area || ""}` : " — no entry"}`}
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
                    {e.focus_area && <span className="focus-badge" style={{ fontSize: 10, padding: "2px 7px" }}>{e.focus_area}</span>}
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
                    {entry.focus_area && <span className="focus-badge" style={{ fontSize: 10 }}>{entry.focus_area}</span>}
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
        heatEntries.forEach(e => { if (e.focus_area) counts[e.focus_area] = (counts[e.focus_area] || 0) + 1; });
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
function ScratchPad({ onClose }) {
  const [notes, setNotes] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("echo_pad") || "null");
      return s && s.length > 0 ? s : [{ id: 1, title: "Note 1", text: "" }];
    } catch { return [{ id: 1, title: "Note 1", text: "" }]; }
  });
  const [activeIdx, setActiveIdx] = useState(0);

  const persist = (updated) => {
    setNotes(updated);
    localStorage.setItem("echo_pad", JSON.stringify(updated));
  };

  const addNote = () => {
    const n = { id: Date.now(), title: `Note ${notes.length + 1}`, text: "" };
    const updated = [...notes, n];
    persist(updated);
    setActiveIdx(updated.length - 1);
  };

  const deleteNote = (idx, e) => {
    e.stopPropagation();
    if (notes.length === 1) {
      persist([{ id: Date.now(), title: "Note 1", text: "" }]);
      setActiveIdx(0);
      return;
    }
    const updated = notes.filter((_, i) => i !== idx);
    persist(updated);
    setActiveIdx(Math.min(activeIdx, updated.length - 1));
  };

  const active = notes[Math.min(activeIdx, notes.length - 1)] || notes[0];

  const updateActive = (key, val) => {
    const updated = notes.map((n, i) => i === activeIdx ? { ...n, [key]: val } : n);
    persist(updated);
  };

  return (
    <div style={{
      position: "fixed", bottom: 84, right: 24, width: 360, height: 440,
      background: T.navy1, border: `1px solid ${T.borderHover}`,
      borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      display: "flex", flexDirection: "column", zIndex: 9998, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: T.navy2, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>📝 Scratch Pad</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>

      {/* Note tabs */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${T.border}`, overflowX: "auto", background: T.navy2, flexShrink: 0 }}>
        {notes.map((n, idx) => (
          <div key={n.id} onClick={() => setActiveIdx(idx)} style={{
            display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
            cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
            borderBottom: `2px solid ${activeIdx === idx ? T.accent : "transparent"}`,
            color: activeIdx === idx ? T.text1 : T.text3, fontSize: 12,
          }}>
            <span style={{ maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis" }}>
              {n.title || `Note ${idx + 1}`}
            </span>
            <span onClick={(e) => deleteNote(idx, e)} style={{ fontSize: 11, color: T.text3, marginLeft: 1, opacity: 0.7 }}>×</span>
          </div>
        ))}
        <button onClick={addNote} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", padding: "6px 10px", fontSize: 18, flexShrink: 0, lineHeight: 1 }} title="New note">+</button>
      </div>

      {/* Note title */}
      <input
        type="text"
        value={active?.title || ""}
        onChange={e => updateActive("title", e.target.value)}
        placeholder="Note title…"
        style={{
          background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`,
          color: T.text1, fontSize: 13, fontWeight: 600, padding: "8px 14px",
          outline: "none", fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
        }}
      />

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
        <span>{notes.length} note{notes.length !== 1 ? "s" : ""} · auto-saved</span>
      </div>
    </div>
  );
}

// ─── Teammates helpers ───────────────────────────────────────────────────────
function loadTeammates() {
  try { return JSON.parse(localStorage.getItem("echo_teammates") || "[]"); } catch { return []; }
}
function saveTeammates(arr) {
  localStorage.setItem("echo_teammates", JSON.stringify(arr));
}
function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function TeammatesModal({ onClose }) {
  const [teammates, setTeammates] = useState(() => loadTeammates());
  const [form, setForm] = useState({ name: "", role: "", emoji: "" });
  const [editId, setEditId] = useState(null);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addOrUpdate = () => {
    if (!form.name.trim()) return;
    let updated;
    if (editId !== null) {
      updated = teammates.map((t, i) => i === editId ? { ...form, name: form.name.trim() } : t);
      setEditId(null);
    } else {
      updated = [...teammates, { ...form, name: form.name.trim() }];
    }
    setTeammates(updated);
    saveTeammates(updated);
    setForm({ name: "", role: "", emoji: "" });
  };

  const startEdit = (idx) => {
    setForm({ ...teammates[idx], emoji: teammates[idx].emoji || "" });
    setEditId(idx);
  };

  const remove = (idx) => {
    const updated = teammates.filter((_, i) => i !== idx);
    setTeammates(updated);
    saveTeammates(updated);
  };

  const cancel = () => { setForm({ name: "", role: "", emoji: "" }); setEditId(null); };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">👥 My Team</div>
            <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>Saved teammates for quick collaborator selection</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Add / edit form */}
          <div style={{ background: "rgba(79,142,247,0.05)", border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 12, letterSpacing: 0.5 }}>
              {editId !== null ? "Edit Teammate" : "Add Teammate"}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                type="text" className="form-input" placeholder="Name *"
                value={form.name} onChange={e => setF("name", e.target.value)}
                onKeyDown={e => e.key === "Enter" && addOrUpdate()}
                style={{ flex: 2 }}
              />
              <input
                type="text" className="form-input" placeholder="Role (e.g. QA Lead)"
                value={form.role} onChange={e => setF("role", e.target.value)}
                style={{ flex: 2 }}
              />
              <input
                type="text" className="form-input" placeholder="😊"
                value={form.emoji} onChange={e => setF("emoji", e.target.value)}
                style={{ flex: 0, width: 52, textAlign: "center" }}
                maxLength={2}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={addOrUpdate}>
                {editId !== null ? "Update" : "+ Add"}
              </button>
              {editId !== null && (
                <button className="btn btn-ghost btn-sm" onClick={cancel}>Cancel</button>
              )}
            </div>
          </div>

          {/* Teammates list */}
          {teammates.length === 0
            ? <div style={{ color: T.text3, fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                No teammates saved yet. Add your first one above.
              </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {teammates.map((t, idx) => (
                  <div key={idx} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", background: T.navy3,
                    border: `1px solid ${T.border}`, borderRadius: 8,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${T.accent}30, ${T.teal}30)`,
                      border: `1px solid ${T.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: t.emoji ? 18 : 13, fontWeight: 700, color: T.accent,
                      flexShrink: 0,
                    }}>
                      {t.emoji || initials(t.name)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>{t.name}</div>
                      {t.role && <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{t.role}</div>}
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => startEdit(idx)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "3px 10px", color: T.coral, borderColor: `${T.coral}40` }} onClick={() => remove(idx)}>✕</button>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── MyTeam page (full-page view accessible from nav) ────────────────────────
function MyTeam() {
  const [teammates, setTeammates] = useState(() => loadTeammates());
  const [form, setForm] = useState({ name: "", role: "", emoji: "" });
  const [editId, setEditId] = useState(null);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addOrUpdate = () => {
    if (!form.name.trim()) return;
    let updated;
    if (editId !== null) {
      updated = teammates.map((t, i) => i === editId ? { ...form, name: form.name.trim() } : t);
      setEditId(null);
    } else {
      updated = [...teammates, { ...form, name: form.name.trim() }];
    }
    setTeammates(updated);
    saveTeammates(updated);
    setForm({ name: "", role: "", emoji: "" });
  };

  const startEdit = (idx) => {
    setForm({ ...teammates[idx], emoji: teammates[idx].emoji || "" });
    setEditId(idx);
  };

  const remove = (idx) => {
    const updated = teammates.filter((_, i) => i !== idx);
    setTeammates(updated);
    saveTeammates(updated);
    if (editId === idx) { setEditId(null); setForm({ name: "", role: "", emoji: "" }); }
  };

  const cancel = () => { setForm({ name: "", role: "", emoji: "" }); setEditId(null); };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {/* Add / edit form */}
      <div style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text2, marginBottom: 14, letterSpacing: 0.5 }}>
          {editId !== null ? "✏️  Edit Teammate" : "➕  Add Teammate"}
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            type="text" className="form-input" placeholder="Full name *"
            value={form.name} onChange={e => setF("name", e.target.value)}
            onKeyDown={e => e.key === "Enter" && addOrUpdate()}
            style={{ flex: 2 }}
          />
          <input
            type="text" className="form-input" placeholder="Role / team (optional)"
            value={form.role} onChange={e => setF("role", e.target.value)}
            style={{ flex: 2 }}
          />
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

      {/* Teammates grid */}
      {teammates.length === 0
        ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: T.text3 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>👥</div>
            <div style={{ fontSize: 15, marginBottom: 6 }}>No teammates saved yet</div>
            <div style={{ fontSize: 13 }}>Add your teammates above — they'll appear as quick-pick chips when logging collaborators in your diary.</div>
          </div>
        )
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {teammates.map((t, idx) => (
              <div key={idx} style={{
                background: T.navy2, border: `1px solid ${T.border}`,
                borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 14,
                transition: "border-color 0.15s",
              }}>
                <div style={{
                  width: 46, height: 46, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${T.accent}25, ${T.teal}25)`,
                  border: `2px solid ${T.accent}40`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: t.emoji ? 22 : 15, fontWeight: 700, color: T.accent,
                  flexShrink: 0,
                }}>
                  {t.emoji || initials(t.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  {t.role && <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>{t.role}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => startEdit(idx)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "2px 8px", color: T.coral, borderColor: `${T.coral}40` }} onClick={() => remove(idx)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}

function DiaryEntryModal({ entry, previousEntry, onClose, onSave }) {
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
    focus_area:     entry.focus_area     || "",
    blockers:       entry.blockers       || "",
    mood:           entry.mood           || "",
    content:        entry.content        || "",
  } : {
    date: today(), focus_area: "", mood: "", content: "", blockers: "",
    jira_links: [], collaborators: [], tags: [], team_updates: [], feedback_given: [],
    carry_forward: initCF,
    reminders: initReminders,
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
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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
    await onSave({ ...form, title: fmtDate(form.date) });
    setSaving(false);
    onClose();
  };

  const pendingCF = form.carry_forward.filter(i => !i.done).length;
  const pendingR  = form.reminders.filter(i => !i.checked).length;

  const TABS = [
    { key: "day",     label: "My Day" },
    { key: "team",    label: `Team${form.team_updates.length > 0 ? ` (${form.team_updates.length})` : ""}` },
    { key: "actions", label: `Actions${pendingCF + pendingR > 0 ? ` · ${pendingCF + pendingR} open` : ""}` },
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
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input type="date" className="form-input" value={form.date} onChange={e => set("date", e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Focus Area</label>
                <select className="form-select" value={form.focus_area} onChange={e => set("focus_area", e.target.value)}>
                  <option value="">— Select —</option>
                  {FOCUS_AREAS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Energy / Mood</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MOODS.map(m => (
                  <button key={m.key} className={`mood-btn${form.mood === m.key ? " selected" : ""}`} title={m.label}
                    onClick={() => set("mood", form.mood === m.key ? "" : m.key)}>
                    {m.emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">What I Did Today</label>
              <textarea className="form-textarea" style={{ minHeight: 110 }}
                placeholder="Key tasks, PRs reviewed, tests written, pipeline changes, decisions made..."
                value={form.content || ""} onChange={e => set("content", e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Blockers</label>
              <textarea className="form-textarea" style={{ minHeight: 60 }}
                placeholder="Dependencies, missing access, unclear requirements, anything slowing progress..."
                value={form.blockers || ""} onChange={e => set("blockers", e.target.value)} />
            </div>

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
              {/* Quick-pick from saved teammates */}
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
                          fontSize: 12, color: T.accent, fontFamily: "'DM Sans', sans-serif",
                          transition: "all 0.15s",
                        }}
                        title={t.role || t.name}
                      >
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
                      👤 {c} ✕
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

  const focusCounts = {};
  week.forEach(e => { if (e.focus_area) focusCounts[e.focus_area] = (focusCounts[e.focus_area] || 0) + 1; });
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
    entry.focus_area ? `Focus area: ${entry.focus_area}` : "",
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
            {entry.focus_area && <span style={{ color: T.accent }}>{entry.focus_area}</span>}
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

function Diary({ onCountChange }) {
  const [entries, setEntries]     = useState([]);
  const [prevEntry, setPrevEntry] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [modal, setModal]         = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [standup, setStandup]     = useState(null);
  const [weeklyReport, setWeeklyReport]   = useState(false);
  const [filterMood, setFilterMood]       = useState("");
  const [filterFocus, setFilterFocus]     = useState("");
  const [filterStarred, setFilterStarred] = useState(false);
  const [starredIds, setStarredIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("echo_starred") || "[]")); }
    catch { return new Set(); }
  });

  const toggleStar = (id) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("echo_starred", JSON.stringify([...next]));
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    if (!isConfigured()) { setLoading(false); return; }
    const d = await db.from("diary_entries").select("*", { order: "date.desc" });
    setEntries(d || []);
    setPrevEntry(d?.[0] || null);
    onCountChange?.(d?.length || 0);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    if (form.id) {
      const { id, ...rest } = form;
      await db.from("diary_entries").update(rest, id);
    } else {
      await db.from("diary_entries").insert(form);
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
      e.focus_area?.toLowerCase().includes(q) ||
      e.blockers?.toLowerCase().includes(q) ||
      e.tags?.some(t => t.toLowerCase().includes(q)) ||
      e.jira_links?.some(l => l.toLowerCase().includes(q)) ||
      e.collaborators?.some(c => c.toLowerCase().includes(q)) ||
      e.team_updates?.some(u => u.name?.toLowerCase().includes(q) || u.update?.toLowerCase().includes(q)) ||
      e.feedback_given?.some(f => f.to?.toLowerCase().includes(q) || f.note?.toLowerCase().includes(q)) ||
      e.carry_forward?.some(i => i.text?.toLowerCase().includes(q)) ||
      e.reminders?.some(i => i.text?.toLowerCase().includes(q));
    const matchMood    = !filterMood    || e.mood       === filterMood;
    const matchFocus   = !filterFocus   || e.focus_area === filterFocus;
    const matchStarred = !filterStarred || starredIds.has(e.id);
    return matchSearch && matchMood && matchFocus && matchStarred;
  });

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

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
                    {e.focus_area && <span className="focus-badge">{e.focus_area}</span>}
                    {mood && <span title={mood.label} style={{ fontSize: 15 }}>{mood.emoji}</span>}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
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
                      {e.jira_links.map(l => <span key={l} className="ticket-chip">{l}</span>)}
                    </div>
                  )}
                  {e.collaborators?.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
                      {e.collaborators.slice(0, 4).map(c => <span key={c} className="tag tag-blue">👤 {c}</span>)}
                      {e.collaborators.length > 4 && <span className="tag tag-blue">+{e.collaborators.length - 4}</span>}
                    </div>
                  )}
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
                  {viewEntry.focus_area && <span className="focus-badge">{viewEntry.focus_area}</span>}
                  {viewEntry.mood && (
                    <span style={{ fontSize: 13, color: T.text3 }}>
                      {MOODS.find(m => m.key === viewEntry.mood)?.emoji} {MOODS.find(m => m.key === viewEntry.mood)?.label}
                    </span>
                  )}
                  {(viewEntry.jira_links?.length > 0 || viewEntry.collaborators?.length > 0 || viewEntry.tags?.length > 0) && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {viewEntry.jira_links?.map(l => (
                        <a key={l} href={l.startsWith("http") ? l : `#`} target="_blank" rel="noreferrer"
                          className="ticket-chip" style={{ textDecoration: "none" }}>{l}</a>
                      ))}
                      {viewEntry.collaborators?.map(c => <span key={c} className="tag tag-blue">👤 {c}</span>)}
                      {viewEntry.tags?.map(t => <span key={t} className="tag tag-teal">{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewEntry(null)}>✕</button>
            </div>

            {/* What I Did */}
            {viewEntry.content && (
              <div style={{ marginBottom: 18 }}>
                <div className="diary-section-heading">What I Did</div>
                <div style={{ fontSize: 14, color: T.text2, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{viewEntry.content}</div>
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
          <div className="auth-brand-logo">echo</div>
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
          <div style={{ display: "none", textAlign: "center", marginBottom: 28 }} className="auth-mobile-logo">
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, letterSpacing: 6, textTransform: "uppercase", background: `linear-gradient(135deg, ${T.accent} 0%, ${T.teal} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>echo</div>
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

// ─── App Shell ────────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "🏠", section: "Overview" },
  { id: "diary", label: "Corporate Diary", icon: "📓", dot: T.accent, section: "Modules" },
  { id: "locker", label: "DigiLocker", icon: "🗂️", dot: T.teal, section: "Modules" },
  { id: "team", label: "My Team", icon: "👥", section: "Settings" },
];

const PAGE_META = {
  dashboard: { title: "Dashboard", sub: "Your personal command centre" },
  diary: { title: "Corporate Diary", sub: "Daily work log — tickets, feedback, notes" },
  locker: { title: "DigiLocker", sub: "Secure document storage & retrieval" },
  team: { title: "My Team", sub: "Saved teammates for quick collaborator selection" },
};

export default function Echo() {
  useEffect(() => { injectStyles(); }, []);
  const [view, setView]               = useState("dashboard");
  const [diaryCount, setDiaryCount]   = useState(0);
  const [docCount, setDocCount]       = useState(0);
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [reminderEnabled, setReminderEnabled] = useState(() => localStorage.getItem("echo_reminder_on") === "true");
  const [reminderTime, setReminderTime]       = useState(() => localStorage.getItem("echo_reminder_time") || "17:30");
  const [padOpen, setPadOpen]                 = useState(false);

  useEffect(() => {
    db.auth.getUser().then(u => {
      if (u?.id) setUser(u);
      setAuthLoading(false);
    }).catch(() => setAuthLoading(false));
  }, []);

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

  const logout = async () => {
    await db.auth.signOut();
    setUser(null);
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
      <aside className="echo-sidebar">
        <div className="echo-logo">
          <div className="echo-logo-text">echo</div>
          <div className="echo-logo-sub">Personal workspace</div>
        </div>

        <nav className="echo-nav">
          {sections.map(sec => (
            <div key={sec}>
              <div className="echo-nav-section">{sec}</div>
              {visibleNav.filter(n => n.section === sec).map(n => (
                <div key={n.id} className={`echo-nav-item ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)}>
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
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
          {isOwner && <div style={{ fontSize: 10, color: T.teal, marginBottom: 6 }}>Owner</div>}

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
          <div>
            <div className="echo-page-title">{PAGE_META[view]?.title}</div>
            <div className="echo-page-sub">{PAGE_META[view]?.sub}</div>
          </div>
          <div style={{ fontSize: 13, color: T.text3 }}>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>

        {view === "dashboard" && <Dashboard setView={setView} diaryCount={diaryCount} docCount={docCount} />}
        {view === "diary"     && <Diary onCountChange={setDiaryCount} />}
        {view === "locker"    && isOwner && <DigiLocker onCountChange={setDocCount} />}
        {view === "locker"    && !isOwner && (
          <div style={{ padding: 40, textAlign: "center", color: T.text3 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16 }}>DigiLocker is private.</div>
          </div>
        )}
        {view === "team" && <MyTeam />}
      </main>

      {/* ── Floating Scratch Pad ── */}
      {padOpen && <ScratchPad onClose={() => setPadOpen(false)} />}
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
