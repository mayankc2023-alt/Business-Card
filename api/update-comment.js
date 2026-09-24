import { google } from "googleapis";
import { getSheetTabName } from "./_sheets.js";

function getAuth() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error("Server is missing GOOGLE_SERVICE_ACCOUNT_KEY");
  }
  const credentials = JSON.parse(rawKey);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sheetId, rowNumber, comment } = req.body || {};

  if (!sheetId || !rowNumber) {
    return res.status(400).json({ error: "Missing sheetId or rowNumber" });
  }
  if (typeof comment !== "string") {
    return res.status(400).json({ error: "Comment must be text" });
  }
  if (comment.length > 400) {
    return res.status(400).json({ error: "Comment exceeds 400 characters" });
  }

  try {
    const sheets = await getSheetsClient();
    const targetTab = await getSheetTabName(sheets, sheetId);

    // Comments is column J -- update this letter if your sheet's column
    // order differs from: Timestamp, Name, Company, Title, Phone, Email,
    // Address 1, Address 2, Website, Comments
    const range = `${targetTab}!J${rowNumber}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[comment]] },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not save comment" });
  }
}
