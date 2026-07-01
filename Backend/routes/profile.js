const express = require("express");
const { verifySession } = require("../middleware/auth");
const { checkAndBumpLimit } = require("../services/rateLimitService");

module.exports = (pool) => {
  const router = express.Router();

  router.get("/", verifySession, async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, student_id, email, contact, gender, type,
              department, batch, designation, address, blood_group, avatar_url,
              needs_admin_review
       FROM users WHERE id=?`,
      [req.user.id],
    );
    res.json(rows[0]);
  });

  router.put("/", verifySession, async (req, res) => {
    const [rows] = await pool.query("SELECT * FROM users WHERE id=?", [
      req.user.id,
    ]);
    const user = rows[0];

    const check = checkAndBumpLimit(user, "profile", { month: 1, year: 3 });
    if (!check.allowed) return res.status(429).json({ error: check.reason });

    const {
      name,
      department,
      batch,
      designation,
      address,
      bloodGroup,
      contact,
    } = req.body;

    await pool.query(
      `UPDATE users SET
       pending_name=?, pending_department=?, pending_batch=?, pending_designation=?,
       address=?, blood_group=?, contact=?, needs_admin_review=1,
       profile_change_month_ref=?, profile_change_count_month=?,
       profile_change_year_ref=?, profile_change_count_year=?
       WHERE id=?`,
      [
        name,
        department,
        batch,
        designation,
        address,
        bloodGroup,
        contact,
        check.updates.profile_change_month_ref,
        check.updates.profile_change_count_month,
        check.updates.profile_change_year_ref,
        check.updates.profile_change_count_year,
        user.id,
      ],
    );

    res.json({ message: "Submitted for admin approval" });
  });

  return router;
};
