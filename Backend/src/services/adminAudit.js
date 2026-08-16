const { v4: uuid } = require('uuid');
const db = require('../db');

async function adminAudit(req, action, entity, entityId, before = null, after = null) {
  await db.run(
    `INSERT INTO admin_audit_logs (id, admin_id, action, entity, entity_id, before_json, after_json, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      req.admin?.id || 'system',
      action,
      entity,
      entityId || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      req.adminIp || null,
      new Date().toISOString(),
    ]
  );
}

module.exports = { adminAudit };
