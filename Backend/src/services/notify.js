const { v4: uuid } = require('uuid');
const db = require('../db');
const { sendTemplate, appBaseUrl } = require('./mail');

const DEFAULT_PREFS = {
  emailReceivable: true,
  emailLead: true,
  emailTrial: true,
  emailInviteRemind: true,
};

function parsePrefs(raw) {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw || '{}') || {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

async function userPrefs(userId) {
  const row = await db.get('SELECT notify_prefs_json, email FROM users WHERE id=?', [userId]);
  return { email: row?.email, prefs: parsePrefs(row?.notify_prefs_json) };
}

async function savePrefs(userId, patch) {
  const { prefs } = await userPrefs(userId);
  const next = { ...prefs, ...patch };
  await db.run(`UPDATE users SET notify_prefs_json=?, updated_at=? WHERE id=?`, [
    JSON.stringify(next),
    new Date().toISOString(),
    userId,
  ]);
  return next;
}

async function notify({
  userId,
  workspaceId,
  type,
  title,
  body,
  link,
  emailTemplate,
  emailVars,
  prefKey,
  forceEmail = false,
}) {
  const now = new Date().toISOString();
  const id = uuid();
  await db.run(
    `INSERT INTO notifications (id, user_id, workspace_id, type, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, workspaceId, type, title, body || '', link || `${appBaseUrl()}/app`, now]
  );
  const { email, prefs } = await userPrefs(userId);
  const allowEmail = forceEmail || (prefKey ? prefs[prefKey] !== false : false);
  if (allowEmail && email && emailTemplate) {
    const sent = await sendTemplate(emailTemplate, {
      to: email,
      vars: { ...(emailVars || {}), link: emailVars?.link || link || `${appBaseUrl()}/app` },
    });
    if (sent.ok) {
      await db.run(`UPDATE notifications SET email_sent_at=? WHERE id=?`, [now, id]);
    }
  }
  return { id };
}

async function unreadCount(userId) {
  const row = await db.get(
    `SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read_at IS NULL`,
    [userId]
  );
  return Number(row?.c) || 0;
}

module.exports = {
  DEFAULT_PREFS,
  parsePrefs,
  userPrefs,
  savePrefs,
  notify,
  unreadCount,
};
