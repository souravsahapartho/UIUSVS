async function logAdminAction(
  pool,
  { adminId, adminEmail, action, targetUserId, targetUserName, details },
) {
  try {
    await pool.query(
      `INSERT INTO admin_logs (admin_id, admin_email, action, target_user_id, target_user_name, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        adminEmail,
        action,
        targetUserId || null,
        targetUserName || null,
        details || null,
      ],
    );
  } catch (err) {
    console.error("⚠️ Failed to write audit log:", err);
  }
}

module.exports = { logAdminAction };
