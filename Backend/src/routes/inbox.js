const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { workspaceId } = require('../services/scope');
const { userPrefs, savePrefs, unreadCount, DEFAULT_PREFS } = require('../services/notify');
const { syncWorkspace, closeFollowup } = require('../services/followups');

const router = express.Router();
router.use(authRequired);

router.get(
  '/unread',
  asyncHandler(async (req, res) => {
    const unread = await unreadCount(req.user.id);
    const ws = workspaceId(req);
    const pending = await db.get(
      `SELECT COUNT(*) as c FROM followups
       WHERE workspace_id=? AND status='open'
         AND (${req.user.canSeeTeam ? '1=1' : 'seller_id=? OR seller_id IS NULL'})`,
      req.user.canSeeTeam ? [ws] : [ws, req.user.id]
    );
    res.json({ unread, pending: Number(pending?.c) || 0 });
  })
);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 60`,
      [req.user.id]
    );
    res.json({
      unread: await unreadCount(req.user.id),
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: !!n.read_at,
        createdAt: n.created_at,
      })),
    });
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await db.run(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL`, [
      new Date().toISOString(),
      req.user.id,
    ]);
    res.json({ ok: true, unread: 0 });
  })
);

router.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await db.run(`UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL`, [
      new Date().toISOString(),
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true, unread: await unreadCount(req.user.id) });
  })
);

router.get(
  '/followups',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    await syncWorkspace(ws);
    const rows = await db.all(
      `SELECT * FROM followups
       WHERE workspace_id=? AND status='open'
         AND (${req.user.canSeeTeam ? '1=1' : '(seller_id=? OR seller_id IS NULL)'})
       ORDER BY due_at ASC, created_at DESC`,
      req.user.canSeeTeam ? [ws] : [ws, req.user.id]
    );
    res.json({
      followups: rows.map((f) => ({
        id: f.id,
        type: f.type,
        title: f.title,
        body: f.body,
        dueAt: f.due_at,
        createdAt: f.created_at,
      })),
    });
  })
);

router.post(
  '/followups/:id/done',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const row = await db.get(`SELECT * FROM followups WHERE id=? AND workspace_id=?`, [
      req.params.id,
      ws,
    ]);
    if (!row) return res.status(404).json({ error: 'Pendência não encontrada' });
    if (!req.user.canSeeTeam && row.seller_id && row.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão nesta pendência.' });
    }
    await closeFollowup(row.id);
    await db.run(`UPDATE followups SET done_by=? WHERE id=?`, [req.user.id, row.id]);
    res.json({ ok: true });
  })
);

router.get(
  '/prefs',
  asyncHandler(async (req, res) => {
    const { prefs } = await userPrefs(req.user.id);
    res.json({ prefs: { ...DEFAULT_PREFS, ...prefs } });
  })
);

router.patch(
  '/prefs',
  asyncHandler(async (req, res) => {
    const allowed = Object.keys(DEFAULT_PREFS);
    const patch = {};
    for (const k of allowed) {
      if (typeof req.body?.[k] === 'boolean') patch[k] = req.body[k];
    }
    const prefs = await savePrefs(req.user.id, patch);
    res.json({ prefs });
  })
);

module.exports = router;
