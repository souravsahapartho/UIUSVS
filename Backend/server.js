const cron = require("node-cron");
const { appendApprovedMember } = require("./services/googleSheetsService");
const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cors = require("cors");
const cookieParser = require("cookie-parser"); // NEW
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL, // NEW: must be exact origin (not "*") so cookies work
    credentials: true, // NEW: allow cookies cross-origin
  }),
);
app.use(express.json());
app.use(cookieParser()); // NEW: read/write httpOnly cookies

const pool = mysql.createPool({
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
  connectionLimit: 10,
  queueLimit: 0,
});

// ---- Cloudinary Config ----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith("video/");
    return {
      folder: "uiusvs_uploads",
      allowed_formats: ["jpg", "png", "jpeg", "webp", "gif", "mp4"],
      resource_type: isVideo ? "video" : "image",
      format: isVideo ? undefined : "webp",
      transformation: isVideo
        ? undefined
        : [{ quality: "auto", fetch_format: "webp" }],
    };
  },
});
const upload = multer({ storage: storage });

const authRoutes = require("./routes/auth")(pool);
const adminUsersRoutes = require("./routes/adminUsers")(pool);
const profileRoutes = require("./routes/profile")(pool);
const membersRoutes = require("./routes/members")(pool); // 🆕
const { verifySession, verifyAdmin } = require("./middleware/auth");

app.use("/api/auth", authRoutes);
app.use("/api/admin-users", adminUsersRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/members", membersRoutes); // 🆕

// ============================================
// AVATAR UPLOAD — signup form থেকে profile picture Cloudinary তে পাঠাতে
// (login লাগে না, কারণ signup এর সময় user এখনো account-ই নেই)
// ============================================
app.post("/api/upload-avatar", upload.single("media"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    res.status(200).json({ url: req.file.path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/gallery",
  verifySession,
  verifyAdmin,
  upload.single("media"),
  async (req, res) => {
    try {
      const { title, caption, category, event_date, is_pinned } = req.body;
      const imageUrl = req.file.path;
      const cloudinaryId = req.file.filename;

      const [result] = await pool.query(
        `INSERT INTO gallery (title, caption, category, image_url, cloudinary_id, event_date, is_pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          caption || "",
          category,
          imageUrl,
          cloudinaryId,
          event_date || null,
          is_pinned === "true",
        ],
      );

      res.status(200).json({
        message: "Uploaded successfully!",
        id: result.insertId,
        url: imageUrl,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ============================================
// 2. READ — Admin panel এর টেবিলের জন্য (সব ছবি)
// ============================================
app.get("/api/gallery", verifySession, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM gallery ORDER BY is_pinned DESC, created_at DESC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/gallery/bulk",
  verifySession,
  verifyAdmin,
  upload.array("media", 20),
  async (req, res) => {
    try {
      const { title, caption, category, event_date, is_pinned } = req.body;
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }
      const pinnedValue = is_pinned === "true";
      const values = req.files.map((f) => [
        title,
        caption || title,
        category,
        f.path,
        f.filename,
        event_date || null,
        pinnedValue,
      ]);
      await pool.query(
        `INSERT INTO gallery (title, caption, category, image_url, cloudinary_id, event_date, is_pinned) VALUES ?`,
        [values],
      );
      res.status(200).json({
        message: `${req.files.length} images uploaded successfully!`,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ============================================
// 3. READ — gallery.html পাবলিক পেজের জন্য (open, no login)
// ============================================
app.get("/api/gallery/public", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, caption, category, image_url AS url, event_date, is_pinned
       FROM gallery ORDER BY is_pinned DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 4. READ — index.html হোমপেজের জন্য (open, no login)
// ============================================
app.get("/api/gallery/featured", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, caption, category, image_url AS url
       FROM gallery ORDER BY is_pinned DESC, created_at DESC LIMIT 12`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put(
  "/api/gallery/:id",
  verifySession,
  verifyAdmin,
  upload.single("media"),
  async (req, res) => {
    try {
      const { title, caption, category, event_date, is_pinned } = req.body;
      const pinnedValue = is_pinned === "true" || is_pinned === true;

      if (req.file) {
        // Notun image ashse, tai purono cloudinary image delete kore dao
        const [rows] = await pool.query(
          "SELECT cloudinary_id FROM gallery WHERE id=?",
          [req.params.id],
        );
        if (rows.length > 0 && rows[0].cloudinary_id) {
          await cloudinary.uploader.destroy(rows[0].cloudinary_id);
        }

        await pool.query(
          `UPDATE gallery SET title=?, caption=?, category=?, event_date=?, is_pinned=?, image_url=?, cloudinary_id=? WHERE id=?`,
          [
            title,
            caption,
            category,
            event_date || null,
            pinnedValue,
            req.file.path,
            req.file.filename,
            req.params.id,
          ],
        );
      } else {
        await pool.query(
          `UPDATE gallery SET title=?, caption=?, category=?, event_date=?, is_pinned=? WHERE id=?`,
          [
            title,
            caption,
            category,
            event_date || null,
            pinnedValue,
            req.params.id,
          ],
        );
      }

      res.json({ message: "Updated successfully!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.delete("/api/gallery/:id", verifySession, verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT cloudinary_id FROM gallery WHERE id=?",
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    if (rows[0].cloudinary_id) {
      await cloudinary.uploader.destroy(rows[0].cloudinary_id);
    }
    await pool.query("DELETE FROM gallery WHERE id=?", [req.params.id]);
    res.json({ message: "Deleted successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 + 1 AS result");
    res.json({ status: "ok", db: "connected", test: rows[0].result });
  } catch (error) {
    console.error("❌ Health check failed:", error);
    res
      .status(500)
      .json({ status: "error", message: error.message, code: error.code });
  }
});

// ============================================
// AUTO-CONVERT: Graduation date পার হলে current → ex, Sheet sync
// প্রতিদিন রাত ১২:০৫ এ চলবে
// ============================================
cron.schedule("5 0 * * *", async () => {
  console.log("🎓 Running graduation auto-convert job...");
  try {
    const [dueUsers] = await pool.query(
      `SELECT * FROM users
       WHERE type = 'current'
         AND graduation_date IS NOT NULL
         AND graduation_date <= CURDATE()`,
    );

    for (const u of dueUsers) {
      await pool.query("UPDATE users SET type='ex' WHERE id=?", [u.id]);

      try {
        await appendApprovedMember({
          id: u.id,
          name: u.name,
          studentId: u.student_id,
          email: u.email,
          contact: u.contact,
          gender: u.gender,
          type: "ex",
          department: u.department,
          batch: u.batch,
          designation: u.designation,
          bloodGroup: u.blood_group,
          graduationDate: u.graduation_date,
          sendEmail: false,
        });
        console.log(`✅ Auto-converted to Alumni: ${u.name} (${u.student_id})`);
      } catch (sheetErr) {
        console.error(`⚠️ Sheet sync failed for ${u.student_id}:`, sheetErr);
      }
    }
  } catch (err) {
    console.error("❌ Graduation auto-convert job failed:", err);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
