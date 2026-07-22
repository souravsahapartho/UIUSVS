const express = require("express");
const { verifySession } = require("../middleware/auth");
const { checkAndBumpLimit } = require("../services/rateLimitService");

module.exports = (pool) => {
  const router = express.Router();

  router.get("/", verifySession, async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, student_id, email, contact, gender, type,
              department, batch, designation, address, blood_group, avatar_url,
              graduation_date, pending_graduation_date,
              needs_admin_review, id_card_url
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

    const {
      name,
      department,
      batch,
      designation,
      address,
      bloodGroup,
      contact,
    } = req.body;

    // Validate required fields before consuming the monthly change limit
    if (
      !name?.trim() ||
      !department?.trim() ||
      !batch?.trim() ||
      !contact?.trim()
    ) {
      return res.status(400).json({
        error: "Please fill in all required fields before saving.",
      });
    }

    // Skip the request entirely if nothing has actually changed
    const noChanges =
      name.trim() === (user.name || "") &&
      department.trim() === (user.department || "") &&
      batch.trim() === (user.batch || "") &&
      (designation || "").trim() === (user.designation || "") &&
      (address || "").trim() === (user.address || "") &&
      (bloodGroup || "").trim() === (user.blood_group || "") &&
      contact.trim() === (user.contact || "");

    if (noChanges) {
      return res.status(200).json({ message: "No changes detected." });
    }

    const check = checkAndBumpLimit(user, "profile", { month: 3, year: 3 });
    if (!check.allowed) return res.status(429).json({ error: check.reason });

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

  // --- Update avatar (immediate, no admin approval needed) ---
  router.put("/avatar", verifySession, async (req, res) => {
    try {
      const { avatarUrl } = req.body;
      if (!avatarUrl) {
        return res.status(400).json({ error: "avatarUrl is required" });
      }

      await pool.query("UPDATE users SET avatar_url=? WHERE id=?", [
        avatarUrl,
        req.user.id,
      ]);

      res.json({
        message: "Avatar updated successfully",
        avatar_url: avatarUrl,
      });
    } catch (error) {
      console.error("❌ Avatar update failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Download own Digital ID Card (force download, not open) ---
  router.get("/download-id", verifySession, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT id_card_url, student_id FROM users WHERE id=?",
        [req.user.id],
      );
      if (!rows.length || !rows[0].id_card_url) {
        return res.status(404).json({ error: "ID card not found" });
      }

      const fileRes = await fetch(rows[0].id_card_url);
      if (!fileRes.ok) {
        return res
          .status(502)
          .json({ error: "Failed to fetch ID card from storage" });
      }

      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const filename = `UIU_SVS_ID_${rows[0].student_id || req.user.id}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(buffer);
    } catch (error) {
      console.error("❌ ID card download failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
