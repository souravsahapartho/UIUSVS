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

// প্রথম অক্ষর না মিললে সেই token/name pair বাদ — typo সাধারণত প্রথম অক্ষর ঠিক রাখে
function firstLetterMatches(a, b) {
  return a[0] && b[0] && a[0] === b[0];
}

const COMMON_NAME_TOKENS = new Set([
  // Very common single-word surnames
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

  // Karmakar / Kormokar variations
  "karmakar",
  "kormokar",
  "karmokar",
  "kormakar",

  // Mondol / Mondal variations
  "mondol",
  "mondal",
  "mandal",
  "mandol",
  "manda",

  // Kumar / Devi type generic middle-names
  "kumar",
  "kumari",
  "kumer",
  "puja",
  "devi",
  "debi",
  "chandra",

  // Sarkar
  "sarkar",
  "sarker",
  "shorkar",
  "shorker",

  // Dutta / Dutt
  "dutta",
  "dutt",
  "dutto",
  "dotto",

  // Ghosh
  "ghosh",
  "ghose",
  "gosh",

  // Nath
  "nath",
  "naath",

  // Halder / Haldar
  "halder",
  "haldar",
  "haldar",
  "holdar",
  "holder",

  // Biswas
  "biswas",
  "bishwas",
  "biswash",

  // Bhattacharjee / Bhattacharya variations
  "bhattacharjee",
  "bhattacharya",
  "bhattacharyya",
  "bhattacharje",
  "chakraborty",
  "chakravarty",
  "chakrabarty",
  "chakrabarti",

  // Saha
  "saha",
  "sana",

  // Banik
  "banik",
  "banick",
  "vanik",

  // Malakar / Malokar
  "malakar",
  "malokar",
  "mallik",
  "malik",

  // Pramanik
  "pramanik",
  "promanik",
  "pramanick",

  // Adhikari
  "adhikari",
  "odhikari",

  // Mazumder / Majumder
  "mazumder",
  "majumder",
  "mozumder",
  "majumdar",
  "mazumdar",

  // Chowdhury variations
  "chowdhury",
  "chaudhury",
  "chaudhuri",
  "choudhury",
  "chowdhuri",

  // Chakma / Barua (ethnic minority surnames, common in CHT)
  "chakma",
  "barua",
  "baruah",

  // Acharya / Acharjee
  "acharya",
  "acharjee",
  "achariya",
  "ashariya",

  // Goswami
  "goswami",
  "gosami",
  "goshami",

  // Gupta
  "gupta",
  "guptas",

  // Singha / Singh
  "singha",
  "singh",
  "singho",

  // Sharma / Verma / Varma (North Indian but seen in mixed communities)
  "sharma",
  "sarma",
  "verma",
  "varma",

  // Talukder
  "talukder",
  "talukdar",

  // Poddar / Podder
  "poddar",
  "podder",
  "poder",

  // Sardar / Sarder
  "sardar",
  "sarder",

  // Bhowmik / Bhoumik
  "bhowmik",
  "bhoumik",
  "bhowmick",
  "bhaumik",

  // Chanda / Chandra
  "chanda",
  "chandra",

  // Debnath
  "debnath",
  "devnath",

  // Modak
  "modak",
  "modok",

  // Kar / Kor
  "kar",
  "kor",
  "kor",

  // Sutradhar
  "sutradhar",
  "sutrodhar",

  // Rani / Rany (common suffix, esp. female names)
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
    if (ta.length < 3 || COMMON_NAME_TOKENS.has(ta)) continue; // 🆕 common surname/title বাদ
    for (const tb of tokensB) {
      if (tb.length < 3 || COMMON_NAME_TOKENS.has(tb)) continue; // 🆕 common surname/title বাদ
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
          // পুরো নামের প্রথম অক্ষর মিললে তবেই full-string similarity check করবো
          const fullSimilarity = firstLetterMatches(candName, exName)
            ? nameSimilarity(candName, exName)
            : 0;
          // token-level এ প্রথম অক্ষর match আগে থেকেই বসানো আছে bestTokenSimilarity এর ভেতরে
          const tokenSimilarity = bestTokenSimilarity(candName, exName);
          const bestMatch = Math.max(fullSimilarity, tokenSimilarity);

          // 0.75+ মানে প্রথম অক্ষর মিলে যাওয়া কোনো word/পুরো নাম ৭৫% এর বেশি মিলছে —
          // spelling variation (Rahul/Rahol) ধরার জন্য যথেষ্ট কড়া
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
