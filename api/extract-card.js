export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { front, back } = req.body || {};
  if (!front) {
    return res.status(400).json({ error: "Front image is required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing its API key. Add ANTHROPIC_API_KEY in Vercel settings." });
  }

  function parseDataUrl(dataUrl) {
    const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || "");
    if (!match) return null;
    return { mediaType: match[1], data: match[2] };
  }

  const frontParsed = parseDataUrl(front);
  const backParsed = back ? parseDataUrl(back) : null;
  if (!frontParsed) {
    return res.status(400).json({ error: "Front image was not in a readable format" });
  }

  const content = [
    {
      type: "text",
      text:
        "You are reading a business card photo (front, and possibly back). " +
        "Extract these fields as strict JSON with exactly these keys: " +
        "name, company, title, phone, email, address, website. " +
        "If a field is not present, use an empty string for it. " +
        "Combine information from both images if two are given. " +
        "Respond with ONLY the JSON object, no markdown fences, no commentary.",
    },
    { type: "image", source: { type: "base64", media_type: frontParsed.mediaType, data: frontParsed.data } },
  ];
  if (backParsed) {
    content.push({ type: "image", source: { type: "base64", media_type: backParsed.mediaType, data: backParsed.data } });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Card reading service failed: ${errText.slice(0, 200)}` });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((block) => block.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "No readable response from card reading service" });
    }

    let parsed;
    try {
      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(502).json({ error: "Could not parse extracted fields from the card" });
    }

    const fields = ["name", "company", "title", "phone", "email", "address", "website"];
    const result = {};
    fields.forEach((key) => {
      result[key] = typeof parsed[key] === "string" ? parsed[key] : "";
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected error reading the card" });
  }
}
