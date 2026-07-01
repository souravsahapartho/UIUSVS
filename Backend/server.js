const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cors = require("cors");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

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
      format: isVideo ? undefined : "webp", // শুধু ছবি হলে webp এ convert
      transformation: isVideo
        ? undefined
        : [{ quality: "auto", fetch_format: "webp" }],
    };
  },
});
const upload = multer({ storage: storage });

// ============================================
// 1. CREATE — Admin panel থেকে ছবি upload
// ============================================
app.post("/api/gallery", upload.single("media"), async (req, res) => {
  try {
    const { title, caption, category, event_date, is_pinned } = req.body;
    const imageUrl = req.file.path;
    const cloudinaryId = req.file.filename; // public_id

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
});

// ============================================
// 2. READ — Admin panel এর টেবিলের জন্য (সব ছবি)
// ============================================
app.get("/api/gallery", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM gallery ORDER BY is_pinned DESC, created_at DESC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 3. READ — gallery.html পাবলিক পেজের জন্য
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
// 4. READ — index.html হোমপেজের জন্য (pinned + recent, limited)
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

// ============================================
// 5. UPDATE — Edit caption/category/date/pin (নতুন ছবি ছাড়া)
// ============================================
app.put("/api/gallery/:id", async (req, res) => {
  try {
    const { title, caption, category, event_date, is_pinned } = req.body;
    await pool.query(
      `UPDATE gallery SET title=?, caption=?, category=?, event_date=?, is_pinned=? WHERE id=?`,
      [title, caption, category, event_date || null, is_pinned, req.params.id],
    );
    res.json({ message: "Updated successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 6. DELETE — DB + Cloudinary দুই জায়গা থেকেই মুছবে
// ============================================
app.delete("/api/gallery/:id", async (req, res) => {
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

// 🎯 Health check route — DB connection test korar jonno
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
