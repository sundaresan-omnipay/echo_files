// Resends today's sprint digest (saved when user clicks "Sprint Digest" on Dashboard)
// to Cliq #qaautomationteam at 8:00 PM IST (14:30 UTC) on weekdays.
// Manual trigger: GET /api/sprint-digest-cron?secret=<CRON_SECRET>

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://ewbyjtclhtcnvbrqfwyz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YnlqdGNsaHRjbnZicnFmd3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwMDYsImV4cCI6MjA5NTQ3NDAwNn0.NxpxEPHmLRSKAtyE7me7BGao-o3VpJqIPaumxu60-yw";
const CRON_SECRET  = process.env.CRON_SECRET || "echo-cron-2026";

const CLIQ_WEBHOOK = process.env.CLIQ_WEBHOOK_URL || "https://cliq.zoho.in/api/v2/channelsbyname/self/message?zapikey=1001.816bb09a5ef96c744dc24dcccb7401b6.eb24b484596c5acd4c826fdfeb715c71";

function todayIST() {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = istNow.getUTCDay();
  if (day === 0 || day === 6) return null;
  return istNow.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const authHeader  = req.headers["authorization"] || "";
  const querySecret = req.query?.secret || "";
  const isCron   = authHeader  === `Bearer ${process.env.CRON_SECRET || CRON_SECRET}`;
  const isManual = querySecret === (process.env.CRON_SECRET || CRON_SECRET);
  if (!isCron && !isManual) return res.status(401).json({ error: "Unauthorized" });

  try {
    const date = todayIST();
    if (!date) return res.status(200).json({ ok: true, skipped: "weekend" });

    const userId     = process.env.DIARY_USER_ID;
    const userFilter = userId ? `&user_id=eq.${userId}` : "";
    const url        = `${SUPABASE_URL}/rest/v1/sprint_digest_cache?sprint_date=eq.${date}${userFilter}&select=message,sprint_name&order=saved_at.desc&limit=1`;

    const supa = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!supa.ok) throw new Error(`Supabase ${supa.status}`);
    const rows = await supa.json();

    if (!rows || !rows.length) {
      return res.status(200).json({ ok: true, date, skipped: "no sprint digest saved for today — click Sprint Digest on Dashboard first" });
    }

    const message = rows[0].message;
    const cliq = await fetch(CLIQ_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!cliq.ok) throw new Error(`Cliq ${cliq.status}`);

    res.status(200).json({ ok: true, date, sprint: rows[0].sprint_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
