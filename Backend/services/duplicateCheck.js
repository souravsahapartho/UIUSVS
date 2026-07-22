// services/duplicateCheck.js
function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "").slice(-10); // last 10 digit compare
}

function normalizeName(name) {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function findDuplicateMatches(candidate, existingList) {
  const candPhone = normalizePhone(candidate.contact);
  const candName = normalizeName(candidate.name);
  const candId = (candidate.student_id || "").toLowerCase();

  return existingList
    .filter((ex) => ex.id !== candidate.id)
    .map((ex) => {
      const reasons = [];
      const exPhone = normalizePhone(ex.contact);
      const exName = normalizeName(ex.name);
      const exId = (ex.student_id || "").toLowerCase();

      if (candPhone && exPhone && candPhone === exPhone) {
        reasons.push("Phone number matches");
      }
      if (
        candId &&
        exId &&
        (candId === exId || candId.includes(exId) || exId.includes(candId))
      ) {
        reasons.push("Student/Member ID matches");
      }
      if (candName && exName) {
        if (candName === exName) {
          reasons.push("Name exactly matches");
        } else if (candName.includes(exName) || exName.includes(candName)) {
          reasons.push("Name partially matches");
        } else {
          const candParts = candName.split(" ").filter((p) => p.length > 2);
          const exParts = exName.split(" ").filter((p) => p.length > 2);
          const overlap = candParts.filter((p) => exParts.includes(p));
          if (overlap.length >= 2) reasons.push("Name partially matches");
        }
      }

      return reasons.length
        ? {
            id: ex.id,
            name: ex.name,
            student_id: ex.student_id,
            contact: ex.contact,
            reasons,
          }
        : null;
    })
    .filter(Boolean);
}

module.exports = { findDuplicateMatches, normalizePhone, normalizeName };
