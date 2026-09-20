import { lookupCode } from "./_sheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code } = req.body || {};
  if (!code || !code.trim()) {
    return res.status(400).json({ error: "Enter a code" });
  }

  try {
    const result = await lookupCode(code);
    if (!result.valid) {
      return res.status(403).json({ error: result.reason || "Code is not valid" });
    }
    // Don't leak the raw sheet ID to the client -- keep it server-side only.
    return res.status(200).json({
      valid: true,
      code: result.code,
      whatsappMessage: result.whatsappMessage,
      emailMessage: result.emailMessage,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not check code" });
  }
}
