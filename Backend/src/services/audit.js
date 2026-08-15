const db = require('../db');
const { v4: uuid } = require('uuid');

async function audit(userId, action, entity, entityId, before = null, after = null) {
  await db.run(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      userId,
      action,
      entity,
      entityId || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      new Date().toISOString(),
    ]
  );
}

async function listAudit(userId, limit = 100) {
  const rows = await db.all(
    `SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((row) => ({
    ...row,
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null,
  }));
}

module.exports = { audit, listAudit };
