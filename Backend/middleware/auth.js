const jwt = require("jsonwebtoken");

const COOKIE_NAME = "uiusvs_session";

// Login সফল হলে এটা কল করে cookie বসানো হবে
function createSession(res, user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role || "member" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true, // production e https lagbe (Render e https thakei)
    sameSite: "none", // cross-origin frontend-backend er jonno
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 din
  });
}

// Logout e cookie clear korte
function clearSession(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
}

// Protected route gulo te use hobe: router.get('/x', verifySession, handler)
function verifySession(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Session expired, please login again" });
  }
}

// Admin-only route gulo te: router.get('/x', verifySession, verifyAdmin, handler)
function verifyAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
}

module.exports = { verifySession, verifyAdmin, createSession, clearSession };
