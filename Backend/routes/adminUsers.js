const express = require("express");
const { appendApprovedMember } = require("../services/googleSheetsService");
const { verifySession, verifyAdmin } = require("../middleware/auth");

module.exports = (pool) => {
  const router = express.Router();

  // --- Pending approvals list (admin.html "Manage Members" tab) ---
  router.get("/pending", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, student_id, email, contact, gender, type,
                department, batch, designation
         FROM users WHERE is_approved=0 OR needs_admin_review=1
         ORDER BY id DESC`,
      );
      res.json(rows);
    } catch (error) {
      console.error("❌ Pending users fetch failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/:id/approve", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE id=?", [
        req.params.id,
      ]);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const u = rows[0];

      await pool.query(
        `UPDATE users SET is_approved=1,
       name=COALESCE(pending_name, name),
       department=COALESCE(pending_department, department),
       batch=COALESCE(pending_batch, batch),
       designation=COALESCE(pending_designation, designation),
       needs_admin_review=0, pending_name=NULL, pending_department=NULL, pending_batch=NULL, pending_designation=NULL
       WHERE id=?`,
        [u.id],
      );

      let sheetSynced = true;
      try {
        await appendApprovedMember({
          id: u.id,
          name: u.name,
          studentId: u.student_id,
          email: u.email,
          contact: u.contact,
          gender: u.gender,
          type: u.type,
          department: u.department,
          batch: u.batch,
          designation: u.designation,
          bloodGroup: u.blood_group,
        });
      } catch (sheetErr) {
        console.error("⚠️ Sheet sync failed (user still approved):", sheetErr);
        sheetSynced = false;
      }

      res.json({
        message: sheetSynced
          ? "Approved, synced to sheet, and ID email sent"
          : "Approved (sheet/email sync failed — check server logs)",
      });
    } catch (error) {
      console.error("❌ Approve user failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  // --- Reject a pending member (delete their account) ---
  router.delete("/:id/reject", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT id FROM users WHERE id=?", [
        req.params.id,
      ]);
      if (!rows.length) return res.status(404).json({ error: "Not found" });

      await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);
      res.json({ message: "Member rejected and removed" });
    } catch (error) {
      console.error("❌ Reject user failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  return router;
};
