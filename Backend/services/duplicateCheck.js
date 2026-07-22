function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

function normalizeName(name) {
  return (name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeEmail(email) {
  return (email || "").toLowerCase().trim();
}

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
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

function firstLetterMatches(a, b) {
  return a[0] && b[0] && a[0] === b[0];
}

const COMMON_NAME_TOKENS = new Set([
  "das",
  "roy",
  "dey",
  "de",
  "sen",
  "pal",
  "paul",
  "sil",
  "shil",
  "nag",
  "raha",
  "mitra",
  "bose",
  "basu",
  "guha",
  "kar",
  "dam",
  "dhar",
  "shil",
  "ray",
  "rai",
  "law",
  "seal",
  "shil",

  "karmakar",
  "kormokar",
  "karmokar",
  "kormakar",

  "mondol",
  "mondal",
  "mandal",
  "mandol",
  "manda",

  "kumar",
  "kumari",
  "kumer",
  "puja",
  "devi",
  "debi",
  "chandra",

  "sarkar",
  "sarker",
  "shorkar",
  "shorker",

  "dutta",
  "dutt",
  "dutto",
  "dotto",

  "ghosh",
  "ghose",
  "gosh",

  "nath",
  "naath",

  "halder",
  "haldar",
  "haldar",
  "holdar",
  "holder",

  "biswas",
  "bishwas",
  "biswash",

  "bhattacharjee",
  "bhattacharya",
  "bhattacharyya",
  "bhattacharje",
  "chakraborty",
  "chakravarty",
  "chakrabarty",
  "chakrabarti",

  "saha",
  "sana",

  "banik",
  "banick",
  "vanik",

  "malakar",
  "malokar",
  "mallik",
  "malik",

  "pramanik",
  "promanik",
  "pramanick",

  "adhikari",
  "odhikari",

  "mazumder",
  "majumder",
  "mozumder",
  "majumdar",
  "mazumdar",

  "chowdhury",
  "chaudhury",
  "chaudhuri",
  "choudhury",
  "chowdhuri",

  "chakma",
  "barua",
  "baruah",

  "acharya",
  "acharjee",
  "achariya",
  "ashariya",

  "goswami",
  "gosami",
  "goshami",

  "gupta",
  "guptas",

  "singha",
  "singh",
  "singho",

  "sharma",
  "sarma",
  "verma",
  "varma",

  "talukder",
  "talukdar",

  "poddar",
  "podder",
  "poder",

  "sardar",
  "sarder",

  "bhowmik",
  "bhoumik",
  "bhowmick",
  "bhaumik",

  "chanda",
  "chandra",

  "debnath",
  "devnath",

  "modak",
  "modok",
  "kar",
  "kor",
  "kor",

  "sutradhar",
  "sutrodhar",

  "rani",
  "rany",
  "rannee",
]);

function bestTokenSimilarity(nameA, nameB) {
  const tokensA = nameA.split(" ").filter(Boolean);
  const tokensB = nameB.split(" ").filter(Boolean);
  if (!tokensA.length || !tokensB.length) return 0;

  let best = 0;
  for (const ta of tokensA) {
    if (ta.length < 3 || COMMON_NAME_TOKENS.has(ta)) continue;
    for (const tb of tokensB) {
      if (tb.length < 3 || COMMON_NAME_TOKENS.has(tb)) continue;
      if (!firstLetterMatches(ta, tb)) continue;
      const sim = nameSimilarity(ta, tb);
      if (sim > best) best = sim;
    }
  }
  return best;
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
          const fullSimilarity = firstLetterMatches(candName, exName)
            ? nameSimilarity(candName, exName)
            : 0;
          const tokenSimilarity = bestTokenSimilarity(candName, exName);
          const bestMatch = Math.max(fullSimilarity, tokenSimilarity);
          if (bestMatch >= 0.75) {
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
