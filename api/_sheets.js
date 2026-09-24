import { google } from "googleapis";

const REGISTRY_SHEET_ID = process.env.REGISTRY_SHEET_ID;
const REGISTRY_TAB = "Sheet1"; // change if your registry tab has a different name

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

// Different people's sheets may use different tab names (e.g. "Arvind - Scan"),
// so we look up the first tab in the spreadsheet rather than assuming "Sheet1".
// Exported so update-comment.js can reuse the exact same logic.
export async function getSheetTabName(sheets, targetSheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: targetSheetId });
  const firstTabName = meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties.title;
  return firstTabName || "Sheet1";
}

// Registry row shape (row 1 = headers):
// code | sheet_id | expires_on | active | whatsapp_message | email_message
export async function lookupCode(code) {
  if (!REGISTRY_SHEET_ID) {
    throw new Error("Server is missing REGISTRY_SHEET_ID");
  }
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: REGISTRY_SHEET_ID,
    range: `${REGISTRY_TAB}!A2:F1000`,
  });
  const rows = res.data.values || [];
  const match = rows.find((row) => (row[0] || "").trim().toLowerCase() === (code || "").trim().toLowerCase());
  if (!match) return { valid: false, reason: "Code not found" };

  const [rowCode, sheetId, expiresOn, active, whatsappMessage, emailMessage] = match;

  const isActive = (active || "").trim().toLowerCase() === "yes" || (active || "").trim().toLowerCase() === "true";
  if (!isActive) return { valid: false, reason: "Code is not active" };

  if (expiresOn) {
    const expiryDate = new Date(expiresOn);
    const now = new Date();
    if (!isNaN(expiryDate.getTime()) && now > expiryDate) {
      return { valid: false, reason: "Code has expired" };
    }
  }

  if (!sheetId) return { valid: false, reason: "Code has no linked sheet" };

  return {
    valid: true,
    code: rowCode,
    sheetId: sheetId.trim(),
    whatsappMessage: whatsappMessage || "",
    emailMessage: emailMessage || "",
  };
}

export async function appendContactRow(targetSheetId, contact) {
  const sheets = await getSheetsClient();
  const timestamp = new Date().toISOString();
  // Prefixing with an apostrophe forces Sheets to treat the value as plain
  // text instead of trying to parse it as a formula/number -- this matters
  // for phone numbers starting with "+" or containing long digit strings.
  const asText = (val) => (val ? `'${val}` : "");

  // Column order must match your sheet's header row exactly:
  // Timestamp | Name | Company | Title | Phone | Email | Address 1 | Address 2 | Website | Comments
  const row = [
    timestamp,
    contact.name || "",
    contact.company || "",
    contact.title || "",
    asText(contact.phone),
    contact.email || "",
    contact.address_1 || "",
    contact.address_2 || "",
    contact.website || "",
    "", // Comments -- blank when the row is first created
  ];

  const targetTab = await getSheetTabName(sheets, targetSheetId);

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId: targetSheetId,
    range: `${targetTab}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  // Extract the row number from something like "Arvind - Scan!A5:J5"
  // so the frontend can later save a comment to this exact row.
  const updatedRange = appendResponse.data.updates && appendResponse.data.updates.updatedRange;
  let rowNumber = null;
  if (updatedRange) {
    const match = updatedRange.match(/(\d+)(?::[A-Z]+\d+)?$/);
    if (match) rowNumber = parseInt(match[1], 10);
  }

  return rowNumber;
}
