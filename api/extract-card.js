import { lookupCode, appendContactRow } from "./_sheets.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { front, back, code } = req.body || {};
  if (!code || !code.trim()) {
    return res.status(401).json({ error: "Missing access code" });
  }
  if (!front) {
    return res.status(400).json({ error: "Front image is required" });
  }

  // Always re-check the code server-side on every scan -- never trust a
  // code the client says was valid earlier. Expiry could have passed
  // since the page loaded.
  let codeInfo;
  try {
    codeInfo = await lookupCode(code);
  } catch (err) {
    return res.status(500).json({ error: "Could not verify access code" });
  }
  if (!codeInfo.valid) {
    return res.status(403).json({ error: codeInfo.reason || "Access code is no longer valid" });
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
        "name, company, title, phone, email, address_1, address_2, website. " +
        "If a field is not present, use an empty string for it. " +
        "Combine information from both images if two are given. " +
        "IMPORTANT for phone: if the card lists multiple phone numbers " +
        "(e.g. office and mobile), return ONLY the first one listed, as a " +
        "single clean number. Never combine multiple numbers into one string. " +
        "IMPORTANT for address: if the card shows two separate addresses " +
        "(e.g. a factory address and a registered office address), put the " +
        "primary or first-listed address in address_1 and the second one in " +
        "address_2. If there is only one address, put it in address_1 and " +
        "leave address_2 as an empty string. " +
        "Respond with ONLY the JSON object, no markdown fences, no commentary.",
    },
    { type: "image", source: { type: "base64", media_type: frontParsed.mediaType, data: frontParsed.data } },
  ];
  if (backParsed) {
    content.push({ type: "image", source: { type: "base64", media_type: backParsed.mediaType, data: backParsed.data } });
  }

  let result;
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

    const fields = ["name", "company", "title", "phone", "email", "address_1", "address_2", "website"];
    result = {};
    fields.forEach((key) => {
      result[key] = typeof parsed[key] === "string" ? parsed[key] : "";
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected error reading the card" });
  }

  // Write live to the person's own sheet. If this fails, we still return
  // the extracted data so they don't lose the scan -- but we flag it so
  // the frontend can warn them it wasn't saved to the sheet.
  try {
    const rowNumber = await appendContactRow(codeInfo.sheetId, result);
    result._savedToSheet = true;
    result._rowNumber = rowNumber;
    result._sheetId = codeInfo.sheetId;
  } catch (err) {
    result._savedToSheet = false;
    result._saveError = err.message || "Could not save to sheet";
  }

  return res.status(200).json(result);
}
