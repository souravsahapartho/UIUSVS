const express = require("express");

module.exports = (pool) => {
  const router = express.Router();

  // Public member directory — শুধু approved এবং block-না-করা মেম্বাররা দেখাবে
  // ORDER BY RAND() দিয়ে প্রতিবার random order আসবে
  router.get("/public", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, designation, gender, type, batch, department, avatar_url
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
