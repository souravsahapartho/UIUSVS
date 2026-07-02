const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
require("dotenv").config();

const COOKIE_NAME = "uiusvs_session";

// 🆕 শুধু block-status চেক করার জন্য হালকা pool (main pool এর সাথে conflict করবে না)
const authPool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: process.env.TIDB_PORT,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  ssl: {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// Login সফল হলে এটা কল করে cookie বসানো হবে
function createSession(res, user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role || "member" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
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
async function verifySession(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🆕 DB-তে গিয়ে block/approval status চেক — cookie বৈধ থাকলেও block হলে আটকাবে
    const [rows] = await authPool.query(
      "SELECT id, name, email, role, is_blocked, is_approved FROM users WHERE id=?",
      [decoded.id],
    );

    if (!rows.length) {
      clearSession(res);
      return res
        .status(401)
        .json({ error: "User not found, please login again" });
    }

    const dbUser = rows[0];

    if (dbUser.is_blocked) {
      clearSession(res);
      return res.status(403).json({
        error:
          "আপনার একাউন্ট ব্লক করা হয়েছে। বিস্তারিত জানতে UIUSVS-এর সাথে যোগাযোগ করুন।",
      });
    }

    // req.user এ latest DB data থাকবে (শুধু JWT payload না)
    req.user = {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Session expired, please login again" });
  }
}

// Admin-only route gulo te: router.get('/x', verifySession, verifyAdmin, handler)
function verifyAdmin(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
}

module.exports = { verifySession, verifyAdmin, createSession, clearSession };
