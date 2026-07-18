// Sends yesterday's diary work log + today's team attendance to Cliq.
// Runs at 06:00 UTC (11:30 AM IST) on weekdays via Vercel Cron.
// Flow: 11:00 AM — Zoho attendance synced (zoho-attendance-sync-cron.js)
//       11:30 AM — this cron sends the combined message
// Manual trigger: GET /api/diary-cliq-cron?secret=<CRON_SECRET>

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://ewbyjtclhtcnvbrqfwyz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YnlqdGNsaHRjbnZicnFmd3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwMDYsImV4cCI6MjA5NTQ3NDAwNn0.NxpxEPHmLRSKAtyE7me7BGao-o3VpJqIPaumxu60-yw";
const CRON_SECRET  = process.env.CRON_SECRET || "echo-cron-2026";
const CLIQ_WEBHOOK = process.env.DIARY_CLIQ_WEBHOOK || process.env.CLIQ_WEBHOOK_URL || "https://cliq.zoho.in/api/v2/channelsbyname/self/message?zapikey=1001.816bb09a5ef96c744dc24dcccb7401b6.eb24b484596c5acd4c826fdfeb715c71";

const SUPA_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const DIV = "─────────────────────────";

function workdayYesterday() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return null;
  ist.setUTCDate(ist.getUTCDate() - 1);
  if (ist.getUTCDay() === 0) ist.setUTCDate(ist.getUTCDate() - 2);
  if (ist.getUTCDay() === 6) ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}

function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function friendlyDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function moodEmoji(m) { return { productive: "🟢", resolved: "✅", collaborative: "🤝", challenged: "⚡", frustrated: "😤" }[m] || "📓"; }
function moodLabel(m) { return m ? m.charAt(0).toUpperCase() + m.slice(1) : ""; }
function priEmoji(p)  { return { high: "🔴", medium: "🟡", low: "🟢" }[p] || "🟡"; }
function attIcon(s)   { return { office: "🏢", wfh: "🏠", leave: "🏖️", half: "🕐" }[s] || "📍"; }
function attLabel(s)  { return { office: "In Office", wfh: "WFH", leave: "Leave", half: "Half Day" }[s] || s; }
function statusIcon(s){ return { excellent: "⭐", on_track: "✅", needs_help: "⚠️", blocked: "🔴" }[s] || "•"; }
function statusLabel(s){ return { excellent: "Excellent", on_track: "On Track", needs_help: "Needs Help", blocked: "Blocked" }[s] || s; }
function fbEmoji(t)   { return { praise: "👍", constructive: "💡", critical: "⚠️" }[t] || "💬"; }

const CAT_CONFIG = [
  { key: "execution",  icon: "💼", label: "Execution"  },
  { key: "meeting",    icon: "🤝", label: "Meetings"   },
  { key: "validation", icon: "🔬", label: "Validation" },
  { key: "other",      icon: "📌", label: "Other"      },
];

function buildMessage(entries, attendance, diaryDate, attendanceDate) {
  if (!entries.length) return null;

  const moods     = [...new Set(entries.map(e => e.mood).filter(Boolean))];
  const totalWins = entries.filter(e => e.is_win).length;
  const moodStr   = moods.map(m => `${moodEmoji(m)} ${moodLabel(m)}`).join(", ");

  const lines = [
    `🌅 *Yesterday's Work Log — ${friendlyDate(diaryDate)}*`,
    `_${entries.length} ${entries.length === 1 ? "entry" : "entries"}${moodStr ? "  ·  " + moodStr : ""}${totalWins ? "  ·  🏆 " + totalWins + " WIN" : ""}_`,
  ];

  // ── Work log — categorised ────────────────────────
  entries.forEach((e, idx) => {
    if (entries.length > 1) lines.push(`\n${DIV}\n_Entry ${idx + 1}_`);

    const cats    = e.categories || {};
    const hasCats = CAT_CONFIG.some(c => Array.isArray(cats[c.key]) && cats[c.key].length);

    lines.push("\n*📋 WORK LOG*");
    if (hasCats) {
      CAT_CONFIG.forEach(({ key, icon, label }) => {
        const items = cats[key];
        if (!Array.isArray(items) || !items.length) return;
        lines.push(`\n*${icon} ${label}*`);
        items.forEach(item => lines.push(`  • ${item}`));
      });
    } else if (e.content) {
      lines.push(e.content);
    }

    if (e.blockers) lines.push(`\n⛔ *Blocker:* ${e.blockers}`);
    const tickets = [e.ticket_number, ...(Array.isArray(e.jira_links) ? e.jira_links : [])].filter(Boolean);
    if (tickets.length) lines.push(`🎫 *Tickets:* ${tickets.join(" · ")}`);
  });

  const allFocus = [...new Set(
    entries.flatMap(e => Array.isArray(e.focus_areas) ? e.focus_areas : e.focus_area ? [e.focus_area] : [])
  )];
  if (allFocus.length) lines.push(`\n📌 *Focus Areas:* ${allFocus.join(" · ")}`);

  // ── Team updates ────────────────────────
  const allUpdates = entries.flatMap(e => Array.isArray(e.team_updates) ? e.team_updates : []);
  if (allUpdates.length) {
    lines.push(`\n${DIV}\n*👥 TEAM UPDATES*`);
    allUpdates.forEach(u => {
      lines.push(`  ${statusIcon(u.status)} *${u.name}* — ${statusLabel(u.status)}`);
      if (u.update) lines.push(`    ${u.update}`);
    });
  }

  // ── Team attendance (TODAY — synced from Zoho at 11:00 AM) ────────────────────────
  if (attendance && attendance.length) {
    lines.push(`\n${DIV}\n*👤 TEAM ATTENDANCE — Today (${friendlyDate(attendanceDate)})*`);
    attendance.forEach(a => lines.push(`  ${attIcon(a.status)} *${a.team_member}* — ${attLabel(a.status)}`));
  }

  // ── Carry forward (pending only) ────────────────────────
  const pendingCF = entries.flatMap(e => (Array.isArray(e.carry_forward) ? e.carry_forward : []).filter(i => !i.done));
  if (pendingCF.length) {
    lines.push(`\n${DIV}\n*⬆ CARRY FORWARD (${pendingCF.length} pending)*`);
    pendingCF.forEach(i => lines.push(`  ${priEmoji(i.priority || "medium")} ${i.text}`));
  }

  // ── Reminders (unchecked only) ────────────────────────
  const pendingR = entries.flatMap(e => (Array.isArray(e.reminders) ? e.reminders : []).filter(i => !i.checked));
  if (pendingR.length) {
    lines.push(`\n${DIV}\n*🔔 REMINDERS & CHECKS*`);
    pendingR.forEach(i => lines.push(`  • ${i.text}`));
  }

  // ── Wins ────────────────────────
  const wins = entries.filter(e => e.is_win);
  if (wins.length) {
    lines.push(`\n${DIV}`);
    wins.forEach(e => {
      lines.push(`🏆 *WIN LOGGED!*`);
      if (e.title) lines.push(`_${e.title}_`);
    });
  }

  // ── Feedback given ────────────────────────
  const allFeedback = entries.flatMap(e => Array.isArray(e.feedback_given) ? e.feedback_given : []);
  if (allFeedback.length) {
    lines.push(`\n*💬 FEEDBACK GIVEN*`);
    allFeedback.forEach(f => lines.push(`  ${fbEmoji(f.type)} *To ${f.to}:* ${f.note}`));
  }

  lines.push(`\n${DIV}`);
  lines.push(`_Sent automatically from Echo Workspace at 11:30 AM IST_`);

  return lines.join("\n");
}

export default async function handler(req, res) {
  const authHeader  = req.headers["authorization"] || "";
  const querySecret = req.query?.secret || "";
  const isCron   = authHeader  === `Bearer ${process.env.CRON_SECRET || CRON_SECRET}`;
  const isManual = querySecret === (process.env.CRON_SECRET || CRON_SECRET);
  if (!isCron && !isManual) return res.status(401).json({ error: "Unauthorized" });

  try {
    const diaryDate      = workdayYesterday();
    const attendanceDate = todayIST();
    if (!diaryDate) return res.status(200).json({ ok: true, skipped: "weekend" });

    const userId     = process.env.DIARY_USER_ID;
    const userFilter = userId ? `&user_id=eq.${userId}` : "";

    const [entriesRes, attendanceRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/diary_entries?date=eq.${diaryDate}${userFilter}&order=created_at.asc`, { headers: SUPA_HEADERS }),
      fetch(`${SUPABASE_URL}/rest/v1/daily_attendance?date=eq.${attendanceDate}${userFilter}&order=team_member.asc`, { headers: SUPA_HEADERS }),
    ]);

    if (!entriesRes.ok) throw new Error(`Supabase diary ${entriesRes.status}`);
    const entries    = await entriesRes.json();
    const attendance = attendanceRes.ok ? await attendanceRes.json() : [];

    if (!entries.length) {
      return res.status(200).json({ ok: true, diaryDate, count: 0, skipped: "no diary entries" });
    }

    const message = buildMessage(entries, attendance, diaryDate, attendanceDate);

    const cliq = await fetch(CLIQ_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!cliq.ok) throw new Error(`Cliq ${cliq.status}: ${await cliq.text()}`);

    res.status(200).json({
      ok: true,
      diaryDate,
      attendanceDate,
      count: entries.length,
      attendanceCount: (attendance || []).length,
      usingServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
      userFiltered: !!userId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
