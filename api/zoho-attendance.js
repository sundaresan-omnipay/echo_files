// Vercel serverless proxy — fetches team attendance from Zoho People.
// Cookies are passed per-request from the client and never stored server-side.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cookies, csrf, baseUrl } = req.body || {};
  if (!cookies || !csrf) {
    return res.status(400).json({ error: "Missing required fields: cookies, csrf" });
  }

  // Default Zoho People India domain; user can override with their own
  const zohoBase = (baseUrl || "https://people.zoho.in/datmanhr").replace(/\/$/, "");
  const url = `${zohoBase}/myspaceTabAction/reportingCircle`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "*/*",
        "Accept-Language": "en-GB,en-IN;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Cookie": cookies,
        "Origin": new URL(zohoBase).origin,
        "Referer": `${zohoBase}/zp`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
      body: `conreqcsr=${encodeURIComponent(csrf)}`,
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: `Zoho returned HTTP ${r.status}` });
    }

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // If not JSON (e.g. session expired), return the raw text for debugging
      return res.status(200).json({ raw: text.slice(0, 2000), error: "Response was not JSON — session may have expired" });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || "Proxy error" });
  }
};
