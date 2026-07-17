// Syncs Zoho People team attendance → daily_attendance table.
// Runs at 05:30 UTC (11:00 AM IST) on weekdays via Vercel Cron.
// Auth: reads Zoho session cookies from Supabase user_settings (saved by Echo app on manual sync).
// Manual trigger: GET /api/zoho-attendance-sync-cron?secret=<CRON_SECRET>

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://ewbyjtclhtcnvbrqfwyz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YnlqdGNsaHRjbnZicnFmd3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwMDYsImV4cCI6MjA5NTQ3NDAwNn0.NxpxEPHmLRSKAtyE7me7BGao-o3VpJqIPaumxu60-yw";
const CRON_SECRET  = process.env.CRON_SECRET || "echo-cron-2026";
const ZOHO_BASE    = process.env.ZOHO_BASE_URL || "https://people.zoho.in/datmanhr";

const SUPA = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return null;
  return ist.toISOString().slice(0, 10);
}

async function getStoredSession(userId) {
  const [cookiesRes, csrfRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&setting_key=eq.zoho_cookies&select=setting_value`, { headers: SUPA }),
    fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&setting_key=eq.zoho_csrf&select=setting_value`, { headers: SUPA }),
  ]);
  const cookiesRows = cookiesRes.ok ? await cookiesRes.json() : [];
  const csrfRows    = csrfRes.ok   ? await csrfRes.json()   : [];

  const cookies = cookiesRows[0]?.setting_value || "";
  let csrf = csrfRows[0]?.setting_value || "";

  // Fallback: extract CSRF from the cookie string if not stored separately
  if (!csrf && cookies) {
    const m = cookies.match(/(?:^|;\s*)(?:CT_)?CSRF_TOKEN=([^;]+)/);
    if (m) csrf = m[1].trim();
  }

  return { cookies, csrf };
}

async function fetchReportingCircle(cookies, csrf) {
  const url = `${ZOHO_BASE}/myspaceTabAction/reportingCircle`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Cookie": cookies,
      "Origin": new URL(ZOHO_BASE).origin,
      "Referer": `${ZOHO_BASE}/zp`,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    },
    body: `conreqcsr=${encodeURIComponent(csrf)}`,
  });

  const text = await r.text();
  if (!text || text.trim() === "") {
    throw new Error("Zoho returned empty response — session may have expired. Open Echo app and sync Zoho attendance again to refresh cookies.");
  }
  if (!r.ok) {
    throw new Error(`Zoho reportingCircle HTTP ${r.status}: ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Zoho response was not JSON: ${text.slice(0, 200)}`);
  }

  // Check for Z223 re-auth required
  if (data?.code === "Z223" || data?.actionId === "defaultReauth-all") {
    throw new Error("Zoho session expired (Z223). Open Echo app and sync Zoho attendance to refresh cookies.");
  }

  return data;
}

function mapStatus(v) {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (s === "in" || s === "present" || s.includes("in office") || s.includes("check-in")) return "office";
  if (s === "wfh" || s.includes("work from home") || s.includes("remote") || s.includes("home")) return "wfh";
  if (s === "leave" || s.includes("leave") || s === "absent") return "leave";
  if (s.includes("half")) return "half";
  if (s.includes("yet to")) return "office";
  return null;
}

export default async function handler(req, res) {
  const authHeader  = req.headers["authorization"] || "";
  const querySecret = req.query?.secret || "";
  const isCron   = authHeader  === `Bearer ${process.env.CRON_SECRET || CRON_SECRET}`;
  const isManual = querySecret === (process.env.CRON_SECRET || CRON_SECRET);
  if (!isCron && !isManual) return res.status(401).json({ error: "Unauthorized" });

  const debug = req.query?.debug === "1";

  try {
    const date = todayIST();
    if (!date) return res.status(200).json({ ok: true, skipped: "weekend" });

    const userId = process.env.DIARY_USER_ID;
    if (!userId) return res.status(500).json({ error: "DIARY_USER_ID env var not set" });

    // 1. Load stored Zoho session from Supabase
    const { cookies, csrf } = await getStoredSession(userId);
    if (!cookies) {
      return res.status(200).json({
        ok: false,
        error: "No Zoho cookies stored. Open Echo app → My Team → paste Zoho cookies and sync attendance once.",
      });
    }
    if (!csrf) {
      return res.status(200).json({
        ok: false,
        error: "CSRF not found in stored cookies. Open Echo app and sync Zoho attendance again.",
      });
    }

    // 2. Call Zoho reportingCircle
    const zohoData = await fetchReportingCircle(cookies, csrf);

    if (debug) {
      return res.status(200).json({ date, zohoData });
    }

    // 3. Extract empList from reporteeCircleData
    const circleData = zohoData?.reporteeCircleData || [];
    const reportees  = circleData.find(g => g.mode === "REPORTEES") || circleData[0];
    const empList    = reportees?.empList || [];

    if (!empList.length) {
      return res.status(200).json({ ok: false, error: "Empty empList from Zoho. Session may be stale.", zohoData });
    }

    // 4. Load direct teammates from Supabase
    const tmRes     = await fetch(`${SUPABASE_URL}/rest/v1/teammates?user_id=eq.${userId}&select=name,relationship`, { headers: SUPA });
    const allTm     = tmRes.ok ? await tmRes.json() : [];
    const directTeam = allTm.filter(t => !t.relationship || t.relationship === "direct");

    // 5. Match Zoho employees to teammates
    const upserts = [];
    empList.forEach(emp => {
      const zohoName = (emp.EMPLOYEENAME || "").trim();
      if (!zohoName) return;
      const status = mapStatus(emp.leaveAttStatUnEncoded || emp.leaveAttStat);
      if (!status) return;

      const zohoWords = zohoName.toLowerCase().split(/\s+/);
      const tm = directTeam.find(t => {
        const tn = t.name.toLowerCase().trim();
        return tn === zohoName.toLowerCase()
          || zohoWords.includes(tn)
          || zohoWords.some(w => tn.startsWith(w) && w.length >= 3);
      });
      if (tm) upserts.push({ date, user_id: userId, team_member: tm.name, status });
    });

    // 6. Upsert to daily_attendance
    if (upserts.length) {
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/daily_attendance`, {
        method: "POST",
        headers: { ...SUPA, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(upserts),
      });
      if (!upsertRes.ok) throw new Error(`Attendance upsert failed: ${upsertRes.status}`);
    }

    res.status(200).json({
      ok: true,
      date,
      zohoEmployees: empList.length,
      matched: upserts.length,
      records: upserts.map(u => `${u.team_member}: ${u.status}`),
      hint: upserts.length === 0
        ? `No name matches. Zoho names: ${empList.slice(0, 5).map(e => e.EMPLOYEENAME).join(", ")}`
        : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
