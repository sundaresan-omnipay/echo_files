import { useState, useEffect, useCallback, useRef } from "react";

// ─── Supabase client (lightweight, no npm) ───────────────────────────────────
const SUPABASE_URL = "https://ewbyjtclhtcnvbrqfwyz.supabase.co";      // ← paste your Supabase project URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YnlqdGNsaHRjbnZicnFmd3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwMDYsImV4cCI6MjA5NTQ3NDAwNn0.NxpxEPHmLRSKAtyE7me7BGao-o3VpJqIPaumxu60-yw"; // ← paste your Supabase anon key
const BUCKET = "echo_documents";

function supabase() {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  const base = `${SUPABASE_URL}/rest/v1`;
  const storage = `${SUPABASE_URL}/storage/v1`;

  return {
    from: (table) => ({
      select: async (cols = "*", opts = {}) => {
        let url = `${base}/${table}?select=${cols}`;
        if (opts.eq) url += `&${opts.eq[0]}=eq.${opts.eq[1]}`;
        if (opts.order) url += `&order=${opts.order}`;
        const r = await fetch(url, { headers });
        return r.json();
      },
      insert: async (data) => {
        const r = await fetch(`${base}/${table}`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(data),
        });
        return r.json();
      },
      update: async (data, id) => {
        const r = await fetch(`${base}/${table}?id=eq.${id}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(data),
        });
        return r.json();
      },
      delete: async (id) => {
        await fetch(`${base}/${table}?id=eq.${id}`, {
          method: "DELETE",
          headers,
        });
      },
    }),
    storage: {
      upload: async (path, file) => {
        const r = await fetch(`${storage}/object/${BUCKET}/${path}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": file.type,
            "x-upsert": "true",
          },
          body: file,
        });
        return r.json();
      },
      getPublicUrl: (path) => `${storage}/object/public/${BUCKET}/${path}`,
      remove: async (paths) => {
        const r = await fetch(`${storage}/object/${BUCKET}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ prefixes: paths }),
        });
        return r.json();
      },
    },
  };
}

const db = supabase();

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
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Playfair+Display:wght@600&display=swap');

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
      font-family: 'Playfair Display', serif;
      font-size: 26px;
      font-weight: 600;
      color: ${T.text1};
      letter-spacing: -0.5px;
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

    .config-banner {
      background: rgba(232,198,106,0.08);
      border: 1px solid rgba(232,198,106,0.25);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 13px;
      color: ${T.gold};
      margin-bottom: 20px;
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

// ─── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ setView, diaryCount, docCount }) {
  const [recentEntries, setRecentEntries] = useState([]);
  const [recentDocs, setRecentDocs] = useState([]);

  useEffect(() => {
    if (!isConfigured()) return;
    db.from("diary_entries").select("*", { order: "date.desc" }).then(d => setRecentEntries((d || []).slice(0, 3)));
    db.from("documents").select("*", { order: "created_at.desc" }).then(d => setRecentDocs((d || []).slice(0, 4)));
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
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.text1, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</div>
                  {e.ticket_number && <span className="ticket-chip">#{e.ticket_number}</span>}
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
    </div>
  );
}

// ─── Diary ───────────────────────────────────────────────────────────────────
function DiaryEntryModal({ entry, onClose, onSave }) {
  const [form, setForm] = useState(entry || {
    date: today(), title: "", ticket_number: "", mood: "", feedback: "", content: "", tags: [],
  });
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags?.includes(t)) {
      set("tags", [...(form.tags || []), t]);
      setTagInput("");
    }
  };

  const save = async () => {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>{entry ? "Edit Entry" : "New Diary Entry"}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input type="date" className="form-input" value={form.date} onChange={e => set("date", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Ticket Number</label>
            <input type="text" className="form-input" placeholder="PROJ-123" value={form.ticket_number || ""} onChange={e => set("ticket_number", e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Title *</label>
          <input type="text" className="form-input" placeholder="What happened today?" value={form.title} onChange={e => set("title", e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Mood / Status</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MOODS.map(m => (
              <button key={m.key} className={`mood-btn ${form.mood === m.key ? "selected" : ""}`} title={m.label} onClick={() => set("mood", form.mood === m.key ? "" : m.key)}>
                {m.emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Feedback Received</label>
          <textarea className="form-textarea" style={{ minHeight: 70 }} placeholder="Any feedback from team, stakeholders, or clients..." value={form.feedback || ""} onChange={e => set("feedback", e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Notes & Details</label>
          <textarea className="form-textarea" placeholder="What did you work on, decide, learn, or observe?" value={form.content || ""} onChange={e => set("content", e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Tags</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" className="form-input" placeholder="Add tag, press Enter" value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())} />
            <button className="btn btn-ghost btn-sm" onClick={addTag}>Add</button>
          </div>
          {form.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {form.tags.map(t => (
                <span key={t} className="tag tag-blue" style={{ cursor: "pointer" }} onClick={() => set("tags", form.tags.filter(x => x !== t))}>
                  {t} ✕
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? "Saving…" : entry ? "Update Entry" : "Save Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Diary({ onCountChange }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | "new" | entry
  const [viewEntry, setViewEntry] = useState(null);
  const [filterMood, setFilterMood] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    if (!isConfigured()) { setLoading(false); return; }
    const d = await db.from("diary_entries").select("*", { order: "date.desc" });
    setEntries(d || []);
    onCountChange?.(d?.length || 0);
    setLoading(false);
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
    if (!confirm("Delete this entry?")) return;
    await db.from("diary_entries").delete(id);
    setViewEntry(null);
    load();
  };

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q || e.title?.toLowerCase().includes(q) || e.ticket_number?.toLowerCase().includes(q) || e.content?.toLowerCase().includes(q) || e.tags?.some(t => t.includes(q));
    const matchMood = !filterMood || e.mood === filterMood;
    return matchSearch && matchMood;
  });

  return (
    <div className="echo-content fade-in">
      <ConfigBanner />

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 220 }}>
          <span style={{ color: T.text3, fontSize: 16 }}>🔍</span>
          <input placeholder="Search entries, tickets, tags…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{ width: 160 }} value={filterMood} onChange={e => setFilterMood(e.target.value)}>
          <option value="">All moods</option>
          {MOODS.map(m => <option key={m.key} value={m.key}>{m.emoji} {m.label}</option>)}
        </select>
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
          return (
            <div key={e.id} className="diary-entry" onClick={() => setViewEntry(e)}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div className="date-badge">
                  <div className="date-badge-day">{e.date?.split("-")[2]}</div>
                  <div className="date-badge-mon">{MONTHS[parseInt(e.date?.split("-")[1]) - 1]}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 500, color: T.text1 }}>{e.title}</span>
                    {mood && <span title={mood.label}>{mood.emoji}</span>}
                    {e.ticket_number && <span className="ticket-chip">#{e.ticket_number}</span>}
                  </div>
                  {e.feedback && (
                    <div style={{ fontSize: 12, color: T.text3, marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      💬 {e.feedback}
                    </div>
                  )}
                  {e.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {e.tags.map(t => <span key={t} className="tag tag-teal">{t}</span>)}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: T.text3, whiteSpace: "nowrap" }}>{fmtDate(e.date)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {(modal === "new" || modal?.id) && (
        <DiaryEntryModal entry={modal !== "new" ? modal : null} onClose={() => setModal(null)} onSave={save} />
      )}

      {viewEntry && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setViewEntry(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-title">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{viewEntry.title}</div>
                <div style={{ fontSize: 13, color: T.text3, fontWeight: 400, marginTop: 3 }}>{fmtDate(viewEntry.date)}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewEntry(null)}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {viewEntry.ticket_number && <span className="ticket-chip">#{viewEntry.ticket_number}</span>}
              {viewEntry.mood && <span>{MOODS.find(m => m.key === viewEntry.mood)?.emoji} {MOODS.find(m => m.key === viewEntry.mood)?.label}</span>}
              {viewEntry.tags?.map(t => <span key={t} className="tag tag-teal">{t}</span>)}
            </div>

            {viewEntry.feedback && (
              <div style={{ background: "rgba(79,142,247,0.06)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Feedback Received</div>
                <div style={{ fontSize: 14, color: T.text2 }}>{viewEntry.feedback}</div>
              </div>
            )}

            {viewEntry.content && (
              <div style={{ fontSize: 14, color: T.text2, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{viewEntry.content}</div>
            )}

            <hr className="divider" style={{ margin: "20px 0" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-danger btn-sm" onClick={() => del(viewEntry.id)}>Delete</button>
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
    const url = db.storage.getPublicUrl(path);
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
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (doc) => {
    if (!confirm(`Delete "${doc.name}"?`)) return;
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

// ─── App Shell ────────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "🏠", section: "Overview" },
  { id: "diary", label: "Corporate Diary", icon: "📓", dot: T.accent, section: "Modules" },
  { id: "locker", label: "DigiLocker", icon: "🗂️", dot: T.teal, section: "Modules" },
];

const PAGE_META = {
  dashboard: { title: "Dashboard", sub: "Your personal command centre" },
  diary: { title: "Corporate Diary", sub: "Daily work log — tickets, feedback, notes" },
  locker: { title: "DigiLocker", sub: "Secure document storage & retrieval" },
};

export default function Echo() {
  useEffect(() => { injectStyles(); }, []);
  const [view, setView] = useState("dashboard");
  const [diaryCount, setDiaryCount] = useState(0);
  const [docCount, setDocCount] = useState(0);

  const sections = [...new Set(NAV.map(n => n.section))];

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
              {NAV.filter(n => n.section === sec).map(n => (
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
          <div style={{ fontWeight: 500, color: T.text2, marginBottom: 2 }}>echo v1.0</div>
          <div>Your digital work memory</div>
        </div>
      </aside>

      <main className="echo-main">
        <div className="echo-topbar">
          <div>
            <div className="echo-page-title">{PAGE_META[view].title}</div>
            <div className="echo-page-sub">{PAGE_META[view].sub}</div>
          </div>
          <div style={{ fontSize: 13, color: T.text3 }}>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>

        {view === "dashboard" && <Dashboard setView={setView} diaryCount={diaryCount} docCount={docCount} />}
        {view === "diary" && <Diary onCountChange={setDiaryCount} />}
        {view === "locker" && <DigiLocker onCountChange={setDocCount} />}
      </main>
    </div>
  );
}
