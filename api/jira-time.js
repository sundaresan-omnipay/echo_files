// Vercel serverless proxy — fetches JIRA issue changelogs for time-in-status calculation.
// Credentials are passed per-request and never stored server-side.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { baseUrl, email, token, issueKeys } = req.body || {};
  if (!baseUrl || !email || !token || !Array.isArray(issueKeys) || !issueKeys.length) {
    return res.status(400).json({ error: "Missing required fields: baseUrl, email, token, issueKeys[]" });
  }

  const creds = Buffer.from(`${email}:${token}`).toString("base64");
  const base = baseUrl.replace(/\/$/, "");

  try {
    const results = await Promise.all(
      issueKeys.map(async (key) => {
        try {
          const url = `${base}/rest/api/3/issue/${key}?fields=created,summary,assignee,status&expand=changelog`;
          const r = await fetch(url, {
            headers: { Authorization: `Basic ${creds}`, Accept: "application/json" },
          });
          if (!r.ok) return { key, error: `HTTP ${r.status}`, statusChanges: [] };
          const data = await r.json();
          const histories = data.changelog?.histories || [];
          const statusChanges = histories
            .flatMap((h) =>
              h.items
                .filter((i) => i.field === "status")
                .map((i) => ({ created: h.created, from: i.fromString, to: i.toString }))
            )
            .sort((a, b) => new Date(a.created) - new Date(b.created));
          // Also extract assignee changes so client can compute "assigned since" per person
          const assigneeChanges = histories
            .flatMap((h) =>
              h.items
                .filter((i) => i.field === "assignee")
                .map((i) => ({ created: h.created, fromName: i.fromString, toName: i.toString, fromEmail: i.from, toEmail: i.to }))
            )
            .sort((a, b) => new Date(a.created) - new Date(b.created));
          return { key, created: data.fields?.created, statusChanges, assigneeChanges };
        } catch (err) {
          return { key, error: err.message, statusChanges: [] };
        }
      })
    );

    const byKey = {};
    results.forEach((r) => { byKey[r.key] = r; });
    res.json(byKey);
  } catch (err) {
    res.status(500).json({ error: err.message || "Proxy error" });
  }
};
