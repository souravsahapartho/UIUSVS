// services/duplicateCheck.js
function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "").slice(-10); // last 10 digit compare
}

function normalizeName(name) {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeEmail(email) {
  return (email || "").toLowerCase().trim();
}

// Levenshtein edit distance — কয়টা অক্ষর বদলালে একটা স্ট্রিং আরেকটাতে রূপান্তরিত হবে
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return dp[m][n];
}

// 0 থেকে 1 — 1 মানে একদম identical, spelling variation ধরার জন্য ব্যবহার হবে
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

function findDuplicateMatches(candidate, existingList) {
  const candPhone = normalizePhone(candidate.contact);
  const candName = normalizeName(candidate.name);
  const candId = (candidate.student_id || "").toLowerCase();
  const candEmail = normalizeEmail(candidate.email);

  return existingList
    .filter((ex) => ex.id !== candidate.id)
    .map((ex) => {
      const reasons = [];
      const exPhone = normalizePhone(ex.contact);
      const exName = normalizeName(ex.name);
      const exId = (ex.student_id || "").toLowerCase();
      const exEmail = normalizeEmail(ex.email);

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
        } else {
          const similarity = nameSimilarity(candName, exName);
          // 0.72+ মানে ৭২% এর বেশি অক্ষর মিলছে — spelling variation (Rahul/Rahol) ধরার জন্য যথেষ্ট কড়া,
          // কিন্তু আলাদা আলাদা নাম (যেমন শুধু পদবী মিললে) ধরবে না
          if (similarity >= 0.72) {
            reasons.push("Name looks like a spelling variation");
          }
        }
      }
      if (candEmail && exEmail && candEmail === exEmail) {
        reasons.push("Email exactly matches");
      }

      return reasons.length
        ? {
            id: ex.id,
            name: ex.name,
            student_id: ex.student_id,
            contact: ex.contact,
            email: ex.email,
            reasons,
          }
        : null;
    })
    .filter(Boolean);
}

module.exports = {
  findDuplicateMatches,
  normalizePhone,
  normalizeName,
  nameSimilarity,
};
