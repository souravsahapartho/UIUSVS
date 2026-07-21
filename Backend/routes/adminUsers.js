const express = require("express");
const {
  appendApprovedMember,
  removeMemberFromSheet,
} = require("../services/googleSheetsService");
const { verifySession, verifyAdmin } = require("../middleware/auth");
const { logAdminAction } = require("../services/auditLog");

module.exports = (pool) => {
  const router = express.Router();

  router.get("/pending", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, student_id, email, contact, gender, type,
                department, batch, designation, graduation_date, pending_graduation_date, created_at
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

      if (u.is_approved === 1 && u.needs_admin_review === 0) {
        return res.status(409).json({ error: "Already approved" });
      }

      const isFirstTimeApproval = u.is_approved === 0;

      const finalName = u.pending_name || u.name;
      const finalDepartment = u.pending_department || u.department;
      const finalBatch = u.pending_batch || u.batch;
      const finalDesignation = u.pending_designation || u.designation;
      const finalGraduationDate =
        u.pending_graduation_date || u.graduation_date;

      const infoChanged = !!(
        u.pending_name ||
        u.pending_department ||
        u.pending_batch ||
        u.pending_designation ||
        u.pending_graduation_date
      );

      // 🆕 প্রথমবার approve, অথবা আগের ID card নেই, অথবা info বদলেছে — সব ক্ষেত্রেই নতুন ID card বানাতে হবে
      const needsIdCard = isFirstTimeApproval || !u.id_card_url || infoChanged;

      await pool.query(
        `UPDATE users SET is_approved=1,
       name=?, department=?, batch=?, designation=?, graduation_date=?,
       needs_admin_review=0, pending_name=NULL, pending_department=NULL, pending_batch=NULL, pending_designation=NULL, pending_graduation_date=NULL
       WHERE id=?`,
        [
          finalName,
          finalDepartment,
          finalBatch,
          finalDesignation,
          finalGraduationDate,
          u.id,
        ],
      );

      res.json({ message: `${finalName} approved successfully` });

      (async () => {
        let sheetSynced = true;
        try {
          const sheetResult = await appendApprovedMember({
            id: u.id,
            name: finalName,
            studentId: u.student_id,
            email: u.email,
            contact: u.contact,
            gender: u.gender,
            type: u.type,
            department: finalDepartment,
            batch: finalBatch,
            designation: finalDesignation,
            bloodGroup: u.blood_group,
            graduationDate: finalGraduationDate,
            sendEmail: isFirstTimeApproval,
            generateIdCard: needsIdCard,
          });

          if (sheetResult && sheetResult.idCardUrl) {
            await pool.query("UPDATE users SET id_card_url=? WHERE id=?", [
              sheetResult.idCardUrl,
              u.id,
            ]);
          }
        } catch (sheetErr) {
          console.error(
            "⚠️ Sheet sync failed (user still approved):",
            sheetErr,
          );
          sheetSynced = false;
        }

        await logAdminAction(pool, {
          adminId: req.user.id,
          adminEmail: req.user.email,
          action: isFirstTimeApproval
            ? "APPROVE_NEW_MEMBER"
            : "APPROVE_PROFILE_EDIT",
          targetUserId: u.id,
          targetUserName: finalName,
          details: sheetSynced
            ? `Approved ${finalName} (${u.student_id})`
            : `Approved ${finalName} (${u.student_id}) — sheet sync failed`,
        });
      })();
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

      removeMemberFromSheet(rejectedUser.student_id).catch((err) => {
        console.error("⚠️ Sheet delete on reject failed:", err.message);
      });

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

  router.get("/all-members", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, student_id, email, contact, gender, type,
              department, batch, designation, blood_group, graduation_date,
              pending_graduation_date, created_at,
              is_approved, needs_admin_review, is_blocked, avatar_url
       FROM users
       ORDER BY is_approved ASC, id DESC`,
      );
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put("/:id/block", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT id, name, role FROM users WHERE id=?",
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const target = rows[0];

      if (target.role === "superadmin")
        return res.status(400).json({ error: "Cannot block a superadmin" });
      if (target.role === "admin" && req.user.role !== "superadmin")
        return res
          .status(403)
          .json({ error: "Only superadmin can block an admin" });

      await pool.query("UPDATE users SET is_blocked=1 WHERE id=?", [target.id]);

      await logAdminAction(pool, {
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: "BLOCK_MEMBER",
        targetUserId: target.id,
        targetUserName: target.name,
        details: `Blocked ${target.name}`,
      });

      res.json({ message: `${target.name} has been blocked` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Unblock a member ---
  router.put("/:id/unblock", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT id, name FROM users WHERE id=?", [
        req.params.id,
      ]);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const target = rows[0];

      await pool.query("UPDATE users SET is_blocked=0 WHERE id=?", [target.id]);

      await logAdminAction(pool, {
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: "UNBLOCK_MEMBER",
        targetUserId: target.id,
        targetUserName: target.name,
        details: `Unblocked ${target.name}`,
      });

      res.json({ message: `${target.name} has been unblocked` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/:id/delete", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT id, name, student_id, role FROM users WHERE id=?",
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const target = rows[0];

      if (target.role === "superadmin")
        return res.status(400).json({ error: "Cannot delete a superadmin" });
      if (target.role === "admin" && req.user.role !== "superadmin")
        return res
          .status(403)
          .json({ error: "Only superadmin can delete an admin" });

      // 🆕 Sheet থেকেও remove করার চেষ্টা
      console.log(
        `🗑️ Attempting sheet delete for studentId: "${target.student_id}"`,
      );
      try {
        const sheetDeleteResult = await removeMemberFromSheet(
          target.student_id,
        );
        console.log("✅ Sheet delete result:", sheetDeleteResult);
      } catch (sheetErr) {
        console.error(
          "⚠️ Sheet delete failed (user still deleted from DB):",
          sheetErr.message,
        );
      }

      await pool.query("DELETE FROM users WHERE id=?", [target.id]);

      await logAdminAction(pool, {
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: "DELETE_MEMBER",
        targetUserId: target.id,
        targetUserName: target.name,
        details: `Deleted ${target.name} (${target.student_id})`,
      });

      res.json({ message: `${target.name} deleted permanently (DB + Sheet)` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
