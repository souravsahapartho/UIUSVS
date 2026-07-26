async function appendApprovedMember(member) {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!scriptUrl) {
    throw new Error("GOOGLE_SCRIPT_URL is not set");
  }

  const res = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "append", ...member }),
  });

  const result = await res.json().catch(() => null);
  if (!result || result.status !== "success") {
    throw new Error(
      "Apps Script sync failed: " + (result?.message || "Unknown error"),
    );
  }
  return result;
}

async function removeMemberFromSheet(studentId) {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!scriptUrl) {
    throw new Error("GOOGLE_SCRIPT_URL is not set");
  }
  if (!studentId) {
    throw new Error("studentId is required to remove from sheet");
  }

  const res = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", studentId }),
  });

  const result = await res.json().catch(() => null);
  if (!result || result.status !== "success") {
    throw new Error(
      "Apps Script delete failed: " + (result?.message || "Unknown error"),
    );
  }
  return result;
}

async function appendDonationRecord({
  transactionId,
  donorName,
  donorEmail,
  department,
  campaignTitle,
  amount,
  runningTotal,
  transactionName,
  addedByAdminEmail,
  date,
}) {
  // Reuses the same Apps Script webhook pattern as appendApprovedMember,
  // just posting to a different "sheet" / "type" so the Apps Script can
  // route it to the Donations tab + trigger the receipt email.
  const payload = {
    type: "donation",
    transactionId,
    donorName,
    donorEmail,
    department,
    campaignTitle,
    amount,
    runningTotal,
    transactionName,
    addedByAdminEmail,
    date,
    sendEmail: true,
    emailSubject: `আপনার ${campaignTitle} অনুদানের জন্য ধন্যবাদ | UIU SVS`,
    emailReason: transactionName,
  };

  const response = await fetch(process.env.GOOGLE_SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Google Sheets webhook failed");
  return response.json();
}

module.exports = {
  appendApprovedMember, // keep your existing export
  appendDonationRecord,
};

module.exports = { appendApprovedMember, removeMemberFromSheet };
