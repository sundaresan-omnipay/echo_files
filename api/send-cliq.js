export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { webhookUrl, message } = req.body || {};
  if (!webhookUrl || !message) return res.status(400).json({ error: "webhookUrl and message are required" });

  try {
    const cliqRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(typeof message === "string" ? { text: message } : message),
    });

    if (!cliqRes.ok) {
      const txt = await cliqRes.text().catch(() => "");
      return res.status(cliqRes.status).json({ error: `Cliq returned ${cliqRes.status}`, detail: txt });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
