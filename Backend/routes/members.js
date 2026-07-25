const express = require("express");

module.exports = (pool) => {
  const router = express.Router();

  router.get("/public", async (req, res) => {
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    try {
      const [rows] = await pool.query(
        `SELECT id, name, designation, gender, type, batch, department,
              blood_group, graduation_date, address, avatar_url
       FROM users
       WHERE is_approved = 1 AND is_blocked = 0
       ORDER BY RAND()`,
      );
      res.json(rows);
    } catch (error) {
      console.error("❌ Public members fetch failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
