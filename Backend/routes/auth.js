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

  router.post("/signup", async (req, res) => {
    try {
      const {
        name,
        studentId,
        email,
        contact,
        gender,
        type,
        department,
        batch,
        bloodGroup,
        designation,
        password,
        profilePicUrl,
        graduationDate,
      } = req.body;

      const [existing] = await pool.query(
        "SELECT id FROM users WHERE email=?",
        [email],
      );
      if (existing.length)
        return res
          .status(409)
          .json({ error: "An account with this email already exists." });

      const hashed = await bcrypt.hash(password, 10);
      const otp = generateOtp();
      const expires = new Date(Date.now() + 10 * 60 * 1000);

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
        department,
        batch,
        bloodGroup,
        designation,
        hashed,
        avatarUrl,
        graduationDate: graduationDate || null,
      };

      await pool.query(
        `INSERT INTO pending_signups (email, payload, otp_code, otp_expires_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE payload=VALUES(payload), otp_code=VALUES(otp_code), otp_expires_at=VALUES(otp_expires_at)`,
        [email, JSON.stringify(payload), otp, expires],
      );
      res.json({ message: "OTP sent to email" });
      sendEmail({
        to: email,
        subject: "🔐 Your UIUSVS Verification Code",
        htmlContent: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;background:#fffaf0;padding:30px;">
          <div style="max-width:480px;margin:auto;background:#ffffff;
                      border-radius:16px;box-shadow:0 10px 25px rgba(185,28,28,0.08);
                      overflow:hidden;border:1px solid #ffedd5;">

            <div style="background:linear-gradient(135deg,#b91c1c 0%,#ea580c 100%);
                        padding:24px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:22px;">🕉️</p>
              <p style="margin:6px 0 0;color:#ffffff;font-weight:700;font-size:16px;letter-spacing:0.5px;">
                UIU Sanatani Vidyarthi Samsad
              </p>
            </div>

            <div style="padding:32px 30px;text-align:center;">
              <h2 style="color:#5B1E1E;margin:0 0 10px;font-size:20px;">
                Verify Your Email
              </h2>
              <p style="font-size:14px;color:#555;margin:0 0 24px;line-height:1.6;">
                Thanks for joining UIUSVS! Please use the verification code below to complete your registration.
              </p>

              <div style="background:#FFF8E7;border:1px dashed #E3A008;border-radius:12px;
                          padding:18px;margin:0 0 24px;">
                <p style="margin:0;font-size:32px;font-weight:800;letter-spacing:8px;color:#b91c1c;">
                  ${otp}
                </p>
              </div>

              <p style="font-size:12px;color:#999;margin:0;">
                ⏱️ This code will expire in <strong>10 minutes</strong>.
              </p>
              <p style="font-size:12px;color:#999;margin:8px 0 0;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </div>

            <div style="background:#fffaf0;padding:16px;text-align:center;border-top:1px solid #ffedd5;">
              <p style="margin:0;font-size:11px;color:#b91c1c;font-weight:700;">
                ✨ Together we connect · Together we grow · Together we celebrate ✨
              </p>
            </div>
          </div>
        </div>`,
      });

      res.json({ message: "OTP sent to email" });
    } catch (error) {
      console.error("Signup failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/verify-otp", async (req, res) => {
    try {
      const { email, otp } = req.body;
      const [rows] = await pool.query(
        "SELECT * FROM pending_signups WHERE email=?",
        [email],
      );
      if (!rows.length)
        return res.status(404).json({
          error:
            "We couldn't find a pending signup for this email. Please register again.",
        });

      const pending = rows[0];
      if (
        pending.otp_code !== otp ||
        new Date(pending.otp_expires_at) < new Date()
      ) {
        return res
          .status(400)
          .json({ error: "This verification code is invalid or has expired." });
      }

      const d =
        typeof pending.payload === "string"
          ? JSON.parse(pending.payload)
          : pending.payload;
      await pool.query(
        `INSERT INTO users (name, student_id, email, contact, gender, type, department, batch, blood_group, designation, password, avatar_url, graduation_date, is_verified, is_approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        [
          d.name,
          d.studentId,
          d.email,
          d.contact,
          d.gender,
          d.type,
          d.department,
          d.batch,
          d.bloodGroup,
          d.designation,
          d.hashed,
          d.avatarUrl,
          d.graduationDate,
        ],
      );
      await pool.query("DELETE FROM pending_signups WHERE email=?", [email]);

      res.json({ message: "Verified! Waiting for admin approval." });
    } catch (error) {
      console.error("Verify OTP failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [
      email,
    ]);
    if (!rows.length)
      return res
        .status(401)
        .json({ error: "Incorrect email or password. Please try again." });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res
        .status(401)
        .json({ error: "Incorrect email or password. Please try again." });
    if (!user.is_approved)
      return res.status(403).json({
        error:
          "Your account is currently under review. You'll be notified once an admin approves it.",
      });

    if (user.is_blocked) {
      return res.status(403).json({
        error:
          "Your account has been suspended. Please contact the UIUSVS admin team for assistance.",
      });
    }

    createSession(res, user);

    pool
      .query("UPDATE users SET last_login=NOW() WHERE id=?", [user.id])
      .catch((err) => console.error("last_login update failed:", err));

    res.json({
      message: "Login successful",
      user: { id: user.id, name: user.name, role: user.role, type: user.type },
    });
  });

  router.post("/forgot-password", async (req, res) => {
    const { email, contact } = req.body;
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email=? AND contact=?",
      [email, contact],
    );
    if (!rows.length)
      return res.status(400).json({
        error:
          "We couldn't verify those details. Please check your email and contact number.",
      });

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
      subject: "🔑 Reset Your UIUSVS Password",
      htmlContent: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;background:#fffaf0;padding:30px;">
        <div style="max-width:480px;margin:auto;background:#ffffff;
                    border-radius:16px;box-shadow:0 10px 25px rgba(185,28,28,0.08);
                    overflow:hidden;border:1px solid #ffedd5;">

          <div style="background:linear-gradient(135deg,#b91c1c 0%,#ea580c 100%);
                      padding:24px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:22px;">🕉️</p>
            <p style="margin:6px 0 0;color:#ffffff;font-weight:700;font-size:16px;letter-spacing:0.5px;">
              UIU Sanatani Vidyarthi Samsad
            </p>
          </div>

          <div style="padding:32px 30px;text-align:center;">
            <h2 style="color:#5B1E1E;margin:0 0 10px;font-size:20px;">
              Password Reset Request
            </h2>
            <p style="font-size:14px;color:#555;margin:0 0 24px;line-height:1.6;">
              We received a request to reset your password. Use the code below to proceed.
            </p>

            <div style="background:#FFF8E7;border:1px dashed #E3A008;border-radius:12px;
                        padding:18px;margin:0 0 24px;">
              <p style="margin:0;font-size:32px;font-weight:800;letter-spacing:8px;color:#b91c1c;">
                ${otp}
              </p>
            </div>

            <p style="font-size:12px;color:#999;margin:0;">
              ⏱️ This code will expire in <strong>10 minutes</strong>.
            </p>
            <p style="font-size:12px;color:#b91c1c;margin:8px 0 0;font-weight:600;">
              ⚠️ If you didn't request a password reset, please secure your account immediately.
            </p>
          </div>

          <div style="background:#fffaf0;padding:16px;text-align:center;border-top:1px solid #ffedd5;">
            <p style="margin:0;font-size:11px;color:#b91c1c;font-weight:700;">
              ✨ Together we connect · Together we grow · Together we celebrate ✨
            </p>
          </div>
        </div>
      </div>`,
    });
    res.json({ message: "Reset OTP sent" });
  });

  router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [
      email,
    ]);
    if (!rows.length)
      return res
        .status(404)
        .json({ error: "We couldn't find an account with that email." });
    const user = rows[0];

    if (
      user.otp_code !== otp ||
      user.otp_purpose !== "reset_password" ||
      new Date(user.otp_expires_at) < new Date()
    ) {
      return res
        .status(400)
        .json({ error: "This verification code is invalid or has expired." });
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
  router.put("/change-password", verifySession, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE id=?", [
      req.user.id,
    ]);
    const user = rows[0];

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok)
      return res
        .status(400)
        .json({ error: "Your current password is incorrect." });

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
