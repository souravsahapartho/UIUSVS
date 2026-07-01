const express = require("express");
const { sendEmail, generateOtp } = require("../services/brevoService");
const { checkAndBumpLimit } = require("../services/rateLimitService");
const {
  createSession,
  clearSession,
  verifySession,
} = require("../middleware/auth");
const bcrypt = require("bcrypt");

module.exports = (pool) => {
  const router = express.Router();

  // --- STEP 1: Signup request → send OTP ---
  router.post("/signup", async (req, res) => {
    try {
      const {
        name,
        studentId,
        email,
        contact,
        gender,
        type,
        designation,
        password,
        profilePicUrl,
      } = req.body;

      const [existing] = await pool.query(
        "SELECT id FROM users WHERE email=?",
        [email],
      );
      if (existing.length)
        return res.status(400).json({ error: "Email already registered" });

      const hashed = await bcrypt.hash(password, 10);
      const otp = generateOtp();
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      const avatarUrl =
        profilePicUrl ||
        (gender === "Female"
          ? `https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(name)}&backgroundColor=ffd5dc`
          : `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(name)}&backgroundColor=b6e3f4`);

      const payload = {
        name,
        studentId,
        email,
        contact,
        gender,
        type,
        designation,
        hashed,
        avatarUrl,
      };

      await pool.query(
        `INSERT INTO pending_signups (email, payload, otp_code, otp_expires_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE payload=VALUES(payload), otp_code=VALUES(otp_code), otp_expires_at=VALUES(otp_expires_at)`,
        [email, JSON.stringify(payload), otp, expires],
      );

      await sendEmail({
        to: email,
        subject: "UIUSVS - Your Verification Code",
        htmlContent: `<p>Apnar verification code: <b>${otp}</b> (valid 10 minutes)</p>`,
      });

      res.json({ message: "OTP sent to email" });
    } catch (error) {
      console.error("❌ Signup failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- STEP 2: Verify OTP → actually create user (pending admin approval) ---
  router.post("/verify-otp", async (req, res) => {
    try {
      const { email, otp } = req.body;
      const [rows] = await pool.query(
        "SELECT * FROM pending_signups WHERE email=?",
        [email],
      );
      if (!rows.length)
        return res.status(400).json({ error: "No pending signup found" });

      const pending = rows[0];
      if (
        pending.otp_code !== otp ||
        new Date(pending.otp_expires_at) < new Date()
      ) {
        return res.status(400).json({ error: "Invalid or expired OTP" });
      }

      const d = JSON.parse(pending.payload);
      await pool.query(
        `INSERT INTO users (name, student_id, email, contact, gender, type, designation, password, avatar_url, email_verified, is_approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        [
          d.name,
          d.studentId,
          d.email,
          d.contact,
          d.gender,
          d.type,
          d.designation,
          d.hashed,
          d.avatarUrl,
        ],
      );
      await pool.query("DELETE FROM pending_signups WHERE email=?", [email]);

      res.json({ message: "Verified! Waiting for admin approval." });
    } catch (error) {
      console.error("❌ Verify OTP failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [
      email,
    ]);
    if (!rows.length)
      return res.status(400).json({ error: "Invalid credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });
    if (!user.is_approved)
      return res.status(403).json({ error: "Account pending admin approval" });

    createSession(res, user); // 👈 EITA JOG KORLAM — cookie e session boshbe

    res.json({
      message: "Login successful",
      user: { id: user.id, name: user.name, role: user.role, type: user.type },
    });
  });

  // --- FORGOT PASSWORD: request OTP (same limits as change-password) ---
  router.post("/forgot-password", async (req, res) => {
    const { email, contact } = req.body;
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email=? AND contact=?",
      [email, contact],
    );
    if (!rows.length)
      return res.status(400).json({ error: "Email/contact mismatch" });

    const user = rows[0];
    const check = checkAndBumpLimit(user, "pwd", { month: 2, year: 10 });
    if (!check.allowed) return res.status(429).json({ error: check.reason });

    const otp = generateOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      "UPDATE users SET otp_code=?, otp_expires_at=?, otp_purpose='reset_password' WHERE id=?",
      [otp, expires, user.id],
    );

    await sendEmail({
      to: email,
      subject: "UIUSVS Password Reset Code",
      htmlContent: `<p>Code: <b>${otp}</b></p>`,
    });
    res.json({ message: "Reset OTP sent" });
  });

  router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [
      email,
    ]);
    if (!rows.length) return res.status(400).json({ error: "User not found" });
    const user = rows[0];

    if (
      user.otp_code !== otp ||
      user.otp_purpose !== "reset_password" ||
      new Date(user.otp_expires_at) < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const check = checkAndBumpLimit(user, "pwd", { month: 2, year: 10 });
    if (!check.allowed) return res.status(429).json({ error: check.reason });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password=?, otp_code=NULL, otp_purpose=NULL,
     pwd_change_month_ref=?, pwd_change_count_month=?,
     pwd_change_year_ref=?, pwd_change_count_year=?
     WHERE id=?`,
      [
        hashed,
        check.updates.pwd_change_month_ref,
        check.updates.pwd_change_count_month,
        check.updates.pwd_change_year_ref,
        check.updates.pwd_change_count_year,
        user.id,
      ],
    );
    res.json({ message: "Password reset successful" });
  });
  // --- CHANGE PASSWORD (logged in, no admin verification needed) ---
  router.put("/change-password", verifySession, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE id=?", [
      req.user.id,
    ]);
    const user = rows[0];

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ error: "Current password wrong" });

    const check = checkAndBumpLimit(user, "pwd", { month: 2, year: 10 });
    if (!check.allowed) return res.status(429).json({ error: check.reason });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password=?,
     pwd_change_month_ref=?, pwd_change_count_month=?,
     pwd_change_year_ref=?, pwd_change_count_year=?
     WHERE id=?`,
      [
        hashed,
        check.updates.pwd_change_month_ref,
        check.updates.pwd_change_count_month,
        check.updates.pwd_change_year_ref,
        check.updates.pwd_change_count_year,
        user.id,
      ],
    );

    res.json({ message: "Password changed" });
  });

  router.post("/logout", (req, res) => {
    clearSession(res);
    res.json({ message: "Logged out" });
  });

  router.get("/me", verifySession, (req, res) => {
    res.json({ user: req.user });
  });
  return router;
};
