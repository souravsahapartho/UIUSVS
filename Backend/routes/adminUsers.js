const express = require("express");
const { appendApprovedMember } = require("../services/googleSheetsService");
const { verifySession, verifyAdmin } = require("../middleware/auth");
const { logAdminAction } = require("../services/auditLog");

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

  // --- Approve a pending member (new signup OR profile-edit re-approval) ---
  router.put("/:id/approve", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE id=?", [
        req.params.id,
      ]);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const u = rows[0];

      // ইতিমধ্যে approved এবং কোনো pending review নেই — মানে আগের click ই কাজ করে ফেলেছে
      if (u.is_approved === 1 && u.needs_admin_review === 0) {
        return res.status(409).json({ error: "Already approved" });
      }

      const isFirstTimeApproval = u.is_approved === 0;

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
          graduationDate: u.graduation_date,
          sendEmail: isFirstTimeApproval,
        });
      } catch (sheetErr) {
        console.error("⚠️ Sheet sync failed (user still approved):", sheetErr);
        sheetSynced = false;
      }

      await logAdminAction(pool, {
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: isFirstTimeApproval
          ? "APPROVE_NEW_MEMBER"
          : "APPROVE_PROFILE_EDIT",
        targetUserId: u.id,
        targetUserName: u.name,
        details: `Approved ${u.name} (${u.student_id})`,
      });

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
      const [rows] = await pool.query(
        "SELECT id, name, student_id FROM users WHERE id=?",
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const rejectedUser = rows[0];

      await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);

      await logAdminAction(pool, {
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: "REJECT_MEMBER",
        targetUserId: rejectedUser.id,
        targetUserName: rejectedUser.name,
        details: `Rejected ${rejectedUser.name} (${rejectedUser.student_id})`,
      });

      res.json({ message: "Member rejected and removed" });
    } catch (error) {
      console.error("❌ Reject user failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Audit log (Superadmin only) ---
  router.get("/logs", verifySession, verifyAdmin, async (req, res) => {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Superadmin access only" });
    }
    try {
      const [rows] = await pool.query(
        `SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 200`,
      );
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Superadmin: promote existing verified user to Admin ---
  router.put(
    "/:id/make-admin",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Superadmin access only" });
      }
      try {
        const [rows] = await pool.query(
          "SELECT id, name, email, role FROM users WHERE id=?",
          [req.params.id],
        );
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        const target = rows[0];

        if (target.role === "admin" || target.role === "superadmin") {
          return res.status(400).json({ error: "User is already an admin" });
        }

        await pool.query("UPDATE users SET role='admin' WHERE id=?", [
          target.id,
        ]);

        await logAdminAction(pool, {
          adminId: req.user.id,
          adminEmail: req.user.email,
          action: "PROMOTE_TO_ADMIN",
          targetUserId: target.id,
          targetUserName: target.name,
          details: `Promoted ${target.name} (${target.email}) to Admin`,
        });

        res.json({ message: `${target.name} is now an Admin` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // --- Superadmin: demote admin back to regular member ---
  router.put(
    "/:id/remove-admin",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Superadmin access only" });
      }
      try {
        const [rows] = await pool.query(
          "SELECT id, name, email, role FROM users WHERE id=?",
          [req.params.id],
        );
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        const target = rows[0];

        if (target.role === "superadmin") {
          return res.status(400).json({ error: "Cannot demote a superadmin" });
        }

        await pool.query("UPDATE users SET role='user' WHERE id=?", [
          target.id,
        ]);

        await logAdminAction(pool, {
          adminId: req.user.id,
          adminEmail: req.user.email,
          action: "DEMOTE_ADMIN",
          targetUserId: target.id,
          targetUserName: target.name,
          details: `Demoted ${target.name} (${target.email}) from Admin`,
        });

        res.json({ message: `${target.name} is no longer an Admin` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // --- Superadmin: list all approved members (to search & promote) ---
  router.get("/all-approved", verifySession, verifyAdmin, async (req, res) => {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Superadmin access only" });
    }
    try {
      const [rows] = await pool.query(
        `SELECT id, name, student_id, email, role FROM users WHERE is_approved=1 ORDER BY name ASC`,
      );
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- All members (approved + pending) for admin browsing/search ---
  router.get("/all-members", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, student_id, email, contact, gender, type,
                department, batch, designation, is_approved, needs_admin_review, avatar_url
         FROM users
         ORDER BY is_approved ASC, id DESC`,
      );
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
