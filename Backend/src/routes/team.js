const crypto = require('crypto');
const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { seatCap } = require('../services/plans');
const { requireManage, workspaceId } = require('../services/scope');
const { sendTemplate, appBaseUrl } = require('../services/mail');
const { notify } = require('../services/notify');
const { addDays } = require('../middleware/auth');
const { safeJson } = require('../services/safeJson');

const router = express.Router();
router.use(authRequired);

const ROLE_LABEL = { viewer: 'Ver', editor: 'Lançar', admin: 'Admin', owner: 'Dono' };

async function memberCount(ownerId) {
  const row = await db.get(
    `SELECT COUNT(*) as c FROM team_members WHERE owner_user_id=? AND status IN ('pending','accepted')`,
    [ownerId]
  );
  return Number(row?.c) || 0;
}

router.get(
  '/members',
  asyncHandler(async (req, res) => {
    if (!req.user.canSeeTeam && !req.user.isOwner) {
      return res.status(403).json({ error: 'Sem acesso à equipe.' });
    }
    const ownerId = workspaceId(req);
    const owner = await db.get('SELECT * FROM users WHERE id=?', [ownerId]);
    const members = (
      await db.all('SELECT * FROM team_members WHERE owner_user_id=? ORDER BY created_at DESC', [ownerId])
    ).map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: m.role,
      roleLabel: ROLE_LABEL[m.role] || m.role,
      status: m.status,
      memberUserId: m.member_user_id,
      createdAt: m.created_at,
      inviteLink: m.invite_token && m.status === 'pending' ? `${appBaseUrl(req)}/app?invite=${m.invite_token}` : null,
    }));
    const cap = seatCap(owner);
    res.json({
      members,
      limits: {
        included: req.user.planLimits?.maxTeamMembers || 0,
        extraSeats: Number(owner?.extra_seats) || 0,
        cap,
        used: members.length,
      },
    });
  })
);

router.post(
  '/members',
  requireManage,
  asyncHandler(async (req, res) => {
    const ownerId = workspaceId(req);
    const owner = await db.get('SELECT * FROM users WHERE id=?', [ownerId]);
    const { email, name, role } = req.body || {};
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
    const allowed = req.user.plan === 'time' ? ['viewer', 'editor', 'admin'] : ['viewer', 'editor'];
    const nextRole = allowed.includes(role) ? role : 'viewer';
    if (!['pro', 'time'].includes(owner?.plan)) {
      return res.status(403).json({ error: 'Convites entram no Pro (1 parceiro) ou no Time.', upgradeRequired: true });
    }
    const used = await memberCount(ownerId);
    if (used >= seatCap(owner)) {
      return res.status(403).json({
        error:
          owner.plan === 'time'
            ? 'Limite de pessoas atingido. Adicione um assento extra (R$ 59/mês) ou remova alguém.'
            : 'O Pro inclui 1 parceiro. Passe para o Time para mais pessoas.',
        upgradeRequired: true,
        needExtraSeat: owner.plan === 'time',
      });
    }
    const exists = await db.get(
      'SELECT id FROM team_members WHERE owner_user_id=? AND email=?',
      [ownerId, email.toLowerCase()]
    );
    if (exists) return res.status(409).json({ error: 'Este e-mail já foi convidado.' });

    const id = uuid();
    const now = new Date().toISOString();
    const inviteToken = crypto.randomBytes(24).toString('hex');
    await db.run(
      `INSERT INTO team_members (id, owner_user_id, email, name, role, status, created_at, invite_token, invite_expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [id, ownerId, email.toLowerCase(), name || null, nextRole, now, inviteToken, addDays(now, 14)]
    );
    const link = `${appBaseUrl(req)}/app?invite=${inviteToken}`;
    await sendTemplate('invite', {
      to: email.toLowerCase(),
      vars: {
        ownerName: owner.name || 'Comiss',
        roleLabel: ROLE_LABEL[nextRole] || nextRole,
        link,
      },
    });
    await notify({
      userId: ownerId,
      workspaceId: ownerId,
      type: 'invite',
      title: `Convite enviado para ${email.toLowerCase()}`,
      body: `Papel: ${ROLE_LABEL[nextRole] || nextRole}`,
      link: `${appBaseUrl(req)}/app`,
    });
    const member = {
      id,
      email: email.toLowerCase(),
      name: name || null,
      role: nextRole,
      status: 'pending',
      createdAt: now,
      inviteLink: link,
    };
    await audit(req.user.id, 'INVITE', 'team_member', id, null, member);
    res.status(201).json({ member });
  })
);

router.patch(
  '/members/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM team_members WHERE id=? AND owner_user_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Membro não encontrado' });
    const { role, status } = req.body || {};
    await db.run('UPDATE team_members SET role=?, status=? WHERE id=?', [
      role || row.role,
      status || row.status,
      row.id,
    ]);
    if (row.member_user_id && role) {
      await db.run(`UPDATE users SET workspace_role=?, updated_at=? WHERE id=?`, [
        role,
        new Date().toISOString(),
        row.member_user_id,
      ]);
    }
    res.json({ ok: true });
  })
);

router.post(
  '/members/:id/resend',
  requireManage,
  asyncHandler(async (req, res) => {
    const ownerId = workspaceId(req);
    const row = await db.get('SELECT * FROM team_members WHERE id=? AND owner_user_id=?', [
      req.params.id,
      ownerId,
    ]);
    if (!row) return res.status(404).json({ error: 'Membro não encontrado' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Este convite já foi aceito.' });
    const owner = await db.get('SELECT * FROM users WHERE id=?', [ownerId]);
    let token = row.invite_token;
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
    }
    const expires = addDays(new Date().toISOString(), 14);
    await db.run(`UPDATE team_members SET invite_token=?, invite_expires_at=? WHERE id=?`, [
      token,
      expires,
      row.id,
    ]);
    const link = `${appBaseUrl(req)}/app?invite=${token}`;
    await sendTemplate('invite', {
      to: row.email,
      vars: {
        ownerName: owner?.name || 'Comiss',
        roleLabel: ROLE_LABEL[row.role] || row.role,
        link,
      },
    });
    res.json({ ok: true, inviteLink: link });
  })
);

router.delete(
  '/members/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM team_members WHERE id=? AND owner_user_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Membro não encontrado' });
    if (row.member_user_id) {
      await db.run(`UPDATE users SET workspace_id=id, workspace_role='owner', updated_at=? WHERE id=?`, [
        new Date().toISOString(),
        row.member_user_id,
      ]);
    }
    await db.run('DELETE FROM team_members WHERE id=?', [row.id]);
    await audit(req.user.id, 'DELETE', 'team_member', row.id, row, null);
    res.json({ ok: true });
  })
);

router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const sales = await db.all(
      `SELECT s.sale_date, s.title, s.client_name, s.status, s.gross_value,
              s.commission_official, s.commission_extra, s.commission_total,
              s.snapshot_json, st.name as store_name, u.name as seller_name
       FROM sales s
       LEFT JOIN stores st ON st.id=s.store_id
       LEFT JOIN users u ON u.id=COALESCE(s.seller_id, s.user_id)
       WHERE s.user_id=? ${req.user.canSeeTeam ? '' : 'AND COALESCE(s.seller_id, s.user_id)=?'}
       ORDER BY s.sale_date`,
      req.user.canSeeTeam ? [ws] : [ws, req.user.id]
    );

    const header = [
      'data',
      'vendedor',
      'titulo',
      'cliente',
      'status',
      'valor',
      'comissao',
      'faixa_snapshot',
    ];
    const lines = [header.join(';')];
    for (const s of sales) {
      const snap = safeJson(s.snapshot_json);
      lines.push(
        [
          s.sale_date,
          s.seller_name || '',
          `"${(s.title || '').replace(/"/g, '""')}"`,
          `"${(s.client_name || '').replace(/"/g, '""')}"`,
          s.status,
          String(s.gross_value).replace('.', ','),
          String(s.commission_total).replace('.', ','),
          `"${(snap.bandLabel || '').replace(/"/g, '""')}"`,
        ].join(';')
      );
    }
    await audit(req.user.id, 'EXPORT', 'sales', null, null, { count: sales.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="comiss-export.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  })
);

module.exports = router;
module.exports.ROLE_LABEL = ROLE_LABEL;
