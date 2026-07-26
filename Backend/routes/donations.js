const express = require("express");
const { verifySession, verifyAdmin } = require("../middleware/auth");
const { appendDonationRecord } = require("../services/googleSheetsService");
const {
  generateDonationReceiptPDF,
} = require("../services/donationReceiptService");

function verifySuperadmin(req, res, next) {
  if (!req.user || req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Superadmin access only" });
  }
  next();
}

module.exports = (pool) => {
  const router = express.Router();

  // ---------- CAMPAIGNS ----------

  // Public/admin: list campaigns
  router.get("/campaigns", async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT * FROM donation_campaigns ORDER BY created_at DESC",
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Superadmin only: create campaign (e.g. "Saraswati Puja 2027 Anudan")
  router.post(
    "/campaigns",
    verifySession,
    verifyAdmin,
    verifySuperadmin,
    async (req, res) => {
      try {
        const { title, description, min_amount } = req.body;
        if (!title || !min_amount) {
          return res
            .status(400)
            .json({ error: "Title and minimum amount required" });
        }
        const [result] = await pool.query(
          `INSERT INTO donation_campaigns (title, description, min_amount, created_by)
           VALUES (?, ?, ?, ?)`,
          [title, description || "", min_amount, req.user.id],
        );
        res.json({ message: "Campaign created!", id: result.insertId });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  router.put(
    "/campaigns/:id",
    verifySession,
    verifyAdmin,
    verifySuperadmin,
    async (req, res) => {
      try {
        const { title, description, min_amount, is_active } = req.body;
        await pool.query(
          `UPDATE donation_campaigns SET title=?, description=?, min_amount=?, is_active=? WHERE id=?`,
          [title, description || "", min_amount, !!is_active, req.params.id],
        );
        res.json({ message: "Campaign updated!" });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // ---------- ADD / ADJUST A DONATION (admin or superadmin) ----------
  router.post("/", verifySession, verifyAdmin, async (req, res) => {
    try {
      const {
        campaign_id,
        user_id, // if existing member
        donor_name, // if NOT a member
        donor_email,
        donor_department,
        amount,
        transaction_name,
        note,
      } = req.body;

      if (!campaign_id || !amount || !transaction_name) {
        return res.status(400).json({
          error: "Campaign, amount, and transaction name are required",
        });
      }
      if (!user_id && !donor_name) {
        return res
          .status(400)
          .json({ error: "Select a member or enter a donor name" });
      }

      const [result] = await pool.query(
        `INSERT INTO donations
         (campaign_id, user_id, donor_name, donor_email, donor_department,
          amount, transaction_name, note, added_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          campaign_id,
          user_id || null,
          donor_name || null,
          donor_email || null,
          donor_department || null,
          amount,
          transaction_name,
          note || "",
          req.user.id,
        ],
      );

      // Fetch context for the email + sheet log
      const [[campaign]] = await pool.query(
        "SELECT * FROM donation_campaigns WHERE id=?",
        [campaign_id],
      );

      let recipientName = donor_name;
      let recipientEmail = donor_email;
      if (user_id) {
        const [[u]] = await pool.query(
          "SELECT name, email FROM users WHERE id=?",
          [user_id],
        );
        if (u) {
          recipientName = u.name;
          recipientEmail = u.email;
        }
      }

      // running total for this donor on this campaign
      const [[{ total }]] = await pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total FROM donations
         WHERE campaign_id=? AND (
           (user_id IS NOT NULL AND user_id=?) OR
           (user_id IS NULL AND donor_email=? AND ? IS NOT NULL)
         )`,
        [campaign_id, user_id || 0, donor_email || null, donor_email || null],
      );

      // Log to Google Sheet -> triggers the professional email (Apps Script side)
      if (recipientEmail) {
        try {
          await appendDonationRecord({
            transactionId: result.insertId,
            donorName: recipientName,
            donorEmail: recipientEmail,
            department: donor_department || "",
            campaignTitle: campaign.title,
            amount,
            runningTotal: total,
            transactionName: transaction_name,
            addedByAdminEmail: req.user.email,
            date: new Date().toISOString(),
          });
        } catch (sheetErr) {
          console.error("⚠️ Donation sheet/email log failed:", sheetErr);
        }
      }

      res.json({
        message: "Transaction recorded!",
        id: result.insertId,
        runningTotal: total,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- LIST DONORS FOR A CAMPAIGN (admin view, with status colors) ----------
  router.get(
    "/campaign/:id/donors",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        const [[campaign]] = await pool.query(
          "SELECT * FROM donation_campaigns WHERE id=?",
          [req.params.id],
        );
        if (!campaign) return res.status(404).json({ error: "Not found" });

        const [rows] = await pool.query(
          `SELECT
             COALESCE(u.id, NULL) AS user_id,
             COALESCE(u.name, d.donor_name) AS name,
             COALESCE(u.email, d.donor_email) AS email,
             COALESCE(u.department, d.donor_department) AS department,
             SUM(d.amount) AS total
           FROM donations d
           LEFT JOIN users u ON u.id = d.user_id
           WHERE d.campaign_id=?
           GROUP BY COALESCE(u.id, d.donor_email, d.donor_name)
           ORDER BY total DESC`,
          [req.params.id],
        );

        const withStatus = rows.map((r) => ({
          ...r,
          status:
            r.total >= campaign.min_amount
              ? "green"
              : r.total > 0
                ? "yellow"
                : "red",
        }));

        res.json({ campaign, donors: withStatus });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // ---------- A SPECIFIC USER'S TRANSACTIONS (admin viewing member profile) ----------
  router.get("/user/:userId", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT d.*, c.title AS campaign_title, c.min_amount, admin.email AS admin_email
           FROM donations d
           JOIN donation_campaigns c ON c.id = d.campaign_id
           JOIN users admin ON admin.id = d.added_by_admin_id
           WHERE d.user_id=?
           ORDER BY d.created_at DESC`,
        [req.params.userId],
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- MEMBER'S OWN DONATIONS (self, from profile.html) ----------
  router.get("/mine", verifySession, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT d.id, d.amount, d.transaction_name, d.note, d.created_at,
                c.id AS campaign_id, c.title AS campaign_title, c.min_amount
         FROM donations d
         JOIN donation_campaigns c ON c.id = d.campaign_id
         WHERE d.user_id=?
         ORDER BY d.created_at DESC`,
        [req.user.id],
      );

      const byCampaign = {};
      rows.forEach((r) => {
        if (!byCampaign[r.campaign_id]) {
          byCampaign[r.campaign_id] = {
            campaign_id: r.campaign_id,
            title: r.campaign_title,
            min_amount: r.min_amount,
            total: 0,
            transactions: [],
          };
        }
        byCampaign[r.campaign_id].total += Number(r.amount);
        byCampaign[r.campaign_id].transactions.push(r);
      });

      const result = Object.values(byCampaign).map((c) => ({
        ...c,
        status:
          c.total >= c.min_amount ? "green" : c.total > 0 ? "yellow" : "red",
      }));

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- SUPERADMIN LOG: who added how much ----------
  router.get(
    "/admin-summary",
    verifySession,
    verifyAdmin,
    verifySuperadmin,
    async (req, res) => {
      try {
        const [rows] = await pool.query(
          `SELECT admin.name AS admin_name, admin.email AS admin_email,
                  c.title AS campaign_title,
                  SUM(d.amount) AS total_added,
                  COUNT(*) AS transaction_count
           FROM donations d
           JOIN users admin ON admin.id = d.added_by_admin_id
           JOIN donation_campaigns c ON c.id = d.campaign_id
           GROUP BY d.added_by_admin_id, d.campaign_id
           ORDER BY c.created_at DESC, total_added DESC`,
        );
        res.json(rows);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // ---------- PDF RECEIPT ----------
  router.get("/:id/receipt", verifySession, async (req, res) => {
    try {
      const [[txn]] = await pool.query(
        `SELECT d.*, c.title AS campaign_title, u.name AS member_name
         FROM donations d
         JOIN donation_campaigns c ON c.id = d.campaign_id
         LEFT JOIN users u ON u.id = d.user_id
         WHERE d.id=?`,
        [req.params.id],
      );
      if (!txn) return res.status(404).json({ error: "Not found" });

      // Only the donor themself or an admin can download
      const isOwner = txn.user_id === req.user.id;
      const isAdmin =
        req.user.role === "admin" || req.user.role === "superadmin";
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const pdfBuffer = await generateDonationReceiptPDF(txn);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="UIUSVS_Receipt_${txn.id}.pdf"`,
      );
      res.send(pdfBuffer);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
