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
      resource_type: "auto", // 👈 change: fixed value diye Cloudinary nijei detect korbe
      allowed_formats: [
        "jpg",
        "png",
        "jpeg",
        "webp",
        "gif",
        "mp4",
        "mov",
        "webm",
      ],
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
// FESTIVALS (Actual Timeline)
// ============================================
app.get("/api/festivals", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, bn_name AS bnName, event_date AS date, type,
              image_url AS image, is_featured AS isFeatured
       FROM festivals ORDER BY event_date ASC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get(
  "/api/festivals/admin",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM festivals ORDER BY event_date ASC",
      );
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  "/api/festivals",
  verifySession,
  verifyAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        name,
        bn_name,
        event_date,
        type,
        is_featured,
        template_image_url,
      } = req.body;
      const imageUrl = req.file ? req.file.path : template_image_url || null;
      const cloudinaryId = req.file ? req.file.filename : null;

      const [result] = await pool.query(
        `INSERT INTO festivals (name, bn_name, event_date, type, image_url, cloudinary_id, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          bn_name || "",
          event_date,
          type || "major",
          imageUrl,
          cloudinaryId,
          is_featured === "true" || is_featured === true,
        ],
      );
      res.status(200).json({ message: "Event added!", id: result.insertId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.put(
  "/api/festivals/:id/feature",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const { is_featured } = req.body;
      await pool.query("UPDATE festivals SET is_featured=? WHERE id=?", [
        is_featured === true || is_featured === "true",
        req.params.id,
      ]);
      res.json({ message: "Updated!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.delete(
  "/api/festivals/:id",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT cloudinary_id FROM festivals WHERE id=?",
        [req.params.id],
      );
      if (rows.length && rows[0].cloudinary_id) {
        await cloudinary.uploader.destroy(rows[0].cloudinary_id);
      }
      await pool.query("DELETE FROM festivals WHERE id=?", [req.params.id]);
      res.json({ message: "Deleted!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ============================================
// FESTIVAL TEMPLATES (Admin's Suggestion Library)
// ============================================
app.get(
  "/api/festival-templates",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM festival_templates ORDER BY name ASC",
      );
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.post(
  "/api/festival-templates",
  verifySession,
  verifyAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const { name, bn_name, type } = req.body;
      const imageUrl = req.file ? req.file.path : null;
      const cloudinaryId = req.file ? req.file.filename : null;
      const [result] = await pool.query(
        `INSERT INTO festival_templates (name, bn_name, type, image_url, cloudinary_id) VALUES (?, ?, ?, ?, ?)`,
        [name, bn_name || "", type || "major", imageUrl, cloudinaryId],
      );
      res.status(200).json({ message: "Template saved!", id: result.insertId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.delete(
  "/api/festival-templates/:id",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT cloudinary_id FROM festival_templates WHERE id=?",
        [req.params.id],
      );
      if (rows.length && rows[0].cloudinary_id) {
        await cloudinary.uploader.destroy(rows[0].cloudinary_id);
      }
      await pool.query("DELETE FROM festival_templates WHERE id=?", [
        req.params.id,
      ]);
      res.json({ message: "Deleted!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ============================================
// ADVISORS (Dynamic Tree-Style Panel)
// ============================================
app.get("/api/advisors", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, designation, image_url AS pic
       FROM advisors ORDER BY rank_order ASC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/advisors/admin", verifySession, verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM advisors ORDER BY rank_order ASC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post(
  "/api/advisors",
  verifySession,
  verifyAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const { name, designation } = req.body;
      if (!name || !designation) {
        return res.status(400).json({ error: "Name and designation required" });
      }
      const imageUrl = req.file ? req.file.path : null;
      const cloudinaryId = req.file ? req.file.filename : null;

      const [[{ maxRank }]] = await pool.query(
        "SELECT COALESCE(MAX(rank_order), -1) AS maxRank FROM advisors",
      );

      const [result] = await pool.query(
        `INSERT INTO advisors (name, designation, image_url, cloudinary_id, rank_order)
         VALUES (?, ?, ?, ?, ?)`,
        [name, designation, imageUrl, cloudinaryId, maxRank + 1],
      );
      res.status(200).json({ message: "Advisor added!", id: result.insertId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.put(
  "/api/advisors/:id",
  verifySession,
  verifyAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const { name, designation } = req.body;

      if (req.file) {
        const [rows] = await pool.query(
          "SELECT cloudinary_id FROM advisors WHERE id=?",
          [req.params.id],
        );
        if (rows.length && rows[0].cloudinary_id) {
          await cloudinary.uploader.destroy(rows[0].cloudinary_id);
        }
        await pool.query(
          `UPDATE advisors SET name=?, designation=?, image_url=?, cloudinary_id=? WHERE id=?`,
          [name, designation, req.file.path, req.file.filename, req.params.id],
        );
      } else {
        await pool.query(
          `UPDATE advisors SET name=?, designation=? WHERE id=?`,
          [name, designation, req.params.id],
        );
      }
      res.json({ message: "Advisor updated!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

app.delete(
  "/api/advisors/:id",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT cloudinary_id FROM advisors WHERE id=?",
        [req.params.id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });

      if (rows[0].cloudinary_id) {
        await cloudinary.uploader.destroy(rows[0].cloudinary_id);
      }
      await pool.query("DELETE FROM advisors WHERE id=?", [req.params.id]);
      res.json({ message: "Advisor removed!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// 🎯 Move advisor up/down in the tree (swap rank_order with neighbor)
app.put(
  "/api/advisors/:id/reorder",
  verifySession,
  verifyAdmin,
  async (req, res) => {
    try {
      const { direction } = req.body; // "up" or "down"
      const [[current]] = await pool.query(
        "SELECT id, rank_order FROM advisors WHERE id=?",
        [req.params.id],
      );
      if (!current) return res.status(404).json({ error: "Not found" });

      const [[neighbor]] = await pool.query(
        direction === "up"
          ? "SELECT id, rank_order FROM advisors WHERE rank_order < ? ORDER BY rank_order DESC LIMIT 1"
          : "SELECT id, rank_order FROM advisors WHERE rank_order > ? ORDER BY rank_order ASC LIMIT 1",
        [current.rank_order],
      );

      if (!neighbor) {
        return res.json({ message: "Already at the edge, no move made." });
      }

      await pool.query("UPDATE advisors SET rank_order=? WHERE id=?", [
        neighbor.rank_order,
        current.id,
      ]);
      await pool.query("UPDATE advisors SET rank_order=? WHERE id=?", [
        current.rank_order,
        neighbor.id,
      ]);

      res.json({ message: "Order updated!" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

const BLOG_CATEGORIES = ["Announcement", "Puja-Parbon", "Spiritual Insights"];
const MAX_PINNED_BLOGS = 3;

function slugify(str) {
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function generateUniqueBlogSlug(title, excludeId = null) {
  const base = slugify(title) || "post";
  let slug = base;
  let counter = 2;
  // keep trying until we find a slug nobody else is using
  while (true) {
    const [rows] = await pool.query(
      excludeId
        ? "SELECT id FROM blogs WHERE slug=? AND id!=?"
        : "SELECT id FROM blogs WHERE slug=?",
      excludeId ? [slug, excludeId] : [slug],
    );
    if (rows.length === 0) return slug;
    slug = `${base}-${counter++}`;
  }
}

// ---- PUBLIC: full list for blog.html ----
app.get("/api/blogs/public", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, slug, excerpt, category, thumbnail_url AS img,
       author_name AS author, post_date, created_at
FROM blogs ORDER BY post_date DESC`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/blogs/pinned", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, slug, excerpt, category, thumbnail_url AS img,
              author_name AS author, post_date, created_at
       FROM blogs WHERE is_pinned = TRUE
       ORDER BY post_date DESC LIMIT ${MAX_PINNED_BLOGS}`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ---- PUBLIC: single blog by slug, for blog-detail.html ----
app.get("/api/blogs/slug/:slug", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM blogs WHERE slug=?", [
      req.params.slug,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- ADMIN: full list with all fields ----
app.get("/api/blogs/admin", verifySession, verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM blogs ORDER BY created_at DESC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- ADMIN: create ----
app.post(
  "/api/blogs",
  verifySession,
  verifyAdmin,
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const {
        title,
        excerpt,
        content,
        category,
        meta_description,
        author_name,
        is_pinned,
      } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: "Title and content required" });
      }
      if (!BLOG_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }

      const wantsPin = is_pinned === "true" || is_pinned === true;
      if (wantsPin) {
        const [[{ cnt }]] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM blogs WHERE is_pinned=TRUE",
        );
        if (cnt >= MAX_PINNED_BLOGS) {
          return res.status(400).json({
            error: `Only ${MAX_PINNED_BLOGS} blogs can be pinned at once. Unpin one first.`,
          });
        }
      }

      const slug = await generateUniqueBlogSlug(title);
      const thumbnailUrl = req.file ? req.file.path : null;
      const thumbnailId = req.file ? req.file.filename : null;

      const [result] = await pool.query(
        `INSERT INTO blogs
         (title, slug, excerpt, content, category, thumbnail_url, thumbnail_cloudinary_id,
          meta_description, author_name, is_pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          slug,
          excerpt || "",
          content,
          category,
          thumbnailUrl,
          thumbnailId,
          meta_description || "",
          author_name || "",
          wantsPin,
        ],
      );

      res
        .status(200)
        .json({ message: "Blog published!", id: result.insertId, slug });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ---- ADMIN: update ----
app.put(
  "/api/blogs/:id",
  verifySession,
  verifyAdmin,
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const {
        title,
        excerpt,
        content,
        category,
        meta_description,
        author_name,
        is_pinned,
      } = req.body;

      if (!BLOG_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }

      const wantsPin = is_pinned === "true" || is_pinned === true;
      if (wantsPin) {
        const [[{ cnt }]] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM blogs WHERE is_pinned=TRUE AND id!=?",
          [req.params.id],
        );
        if (cnt >= MAX_PINNED_BLOGS) {
          return res.status(400).json({
            error: `Only ${MAX_PINNED_BLOGS} blogs can be pinned at once. Unpin one first.`,
          });
        }
      }

      const slug = await generateUniqueBlogSlug(title, req.params.id);

      if (req.file) {
        const [rows] = await pool.query(
          "SELECT thumbnail_cloudinary_id FROM blogs WHERE id=?",
          [req.params.id],
        );
        if (rows.length && rows[0].thumbnail_cloudinary_id) {
          await cloudinary.uploader.destroy(rows[0].thumbnail_cloudinary_id);
        }
        await pool.query(
          `UPDATE blogs SET title=?, slug=?, excerpt=?, content=?, category=?,
           thumbnail_url=?, thumbnail_cloudinary_id=?, meta_description=?,
           author_name=?, is_pinned=? WHERE id=?`,
          [
            title,
            slug,
            excerpt || "",
            content,
            category,
            req.file.path,
            req.file.filename,
            meta_description || "",
            author_name || "",
            wantsPin,
            req.params.id,
          ],
        );
      } else {
        await pool.query(
          `UPDATE blogs SET title=?, slug=?, excerpt=?, content=?, category=?,
           meta_description=?, author_name=?, is_pinned=? WHERE id=?`,
          [
            title,
            slug,
            excerpt || "",
            content,
            category,
            meta_description || "",
            author_name || "",
            wantsPin,
            req.params.id,
          ],
        );
      }

      res.json({ message: "Blog updated!", slug });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
);

// ---- ADMIN: quick pin/unpin toggle (used by the pin icon in the table) ----
app.put("/api/blogs/:id/pin", verifySession, verifyAdmin, async (req, res) => {
  try {
    const { is_pinned } = req.body;
    const wantsPin = is_pinned === true || is_pinned === "true";

    if (wantsPin) {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM blogs WHERE is_pinned=TRUE AND id!=?",
        [req.params.id],
      );
      if (cnt >= MAX_PINNED_BLOGS) {
        return res.status(400).json({
          error: `Only ${MAX_PINNED_BLOGS} blogs can be pinned at once. Unpin one first.`,
        });
      }
    }

    await pool.query("UPDATE blogs SET is_pinned=? WHERE id=?", [
      wantsPin,
      req.params.id,
    ]);
    res.json({ message: wantsPin ? "Pinned to homepage!" : "Unpinned!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- ADMIN: delete ----
app.delete("/api/blogs/:id", verifySession, verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT thumbnail_cloudinary_id FROM blogs WHERE id=?",
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (rows[0].thumbnail_cloudinary_id) {
      await cloudinary.uploader.destroy(rows[0].thumbnail_cloudinary_id);
    }
    await pool.query("DELETE FROM blogs WHERE id=?", [req.params.id]);
    res.json({ message: "Blog deleted!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.get("/api/gallery/featured", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, caption, category, image_url AS url, event_date
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
