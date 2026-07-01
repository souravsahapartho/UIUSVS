const { google } = require("googleapis");

async function appendApprovedMember(row) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"],
  );
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Members!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

module.exports = { appendApprovedMember };
