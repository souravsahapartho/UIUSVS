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

module.exports = { appendApprovedMember, removeMemberFromSheet };
