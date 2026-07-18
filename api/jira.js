// Vercel serverless proxy — forwards requests to JIRA Cloud REST API.
// Credentials are passed per-request and never stored server-side.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { baseUrl, email, token, jql, fields } = req.body || {};
  if (!baseUrl || !email || !token || !jql) {
    return res.status(400).json({ error: "Missing required fields: baseUrl, email, token, jql" });
  }

  try {
    const creds = Buffer.from(`${email}:${token}`).toString("base64");
    const fieldList = fields ? fields.split(",") : ["summary","assignee","status","priority","issuetype","customfield_10016","customfield_10020"];
    const url = `${baseUrl.replace(/\/$/, "")}/rest/api/3/search/jql`;

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ jql, fields: fieldList, maxResults: 100 }),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || "Proxy error" });
  }
};
