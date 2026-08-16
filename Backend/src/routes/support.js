const express = require('express');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const support = require('../services/supportTickets');

const router = express.Router();
router.use(authRequired);

router.get(
  '/unread',
  asyncHandler(async (req, res) => {
    res.json({ unread: await support.unreadForUser(req.user.id) });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tickets = await support.listForUser(req.user.id);
    res.json({ tickets, unread: await support.unreadForUser(req.user.id) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const id = await support.createTicket({
        user: req.user,
        kind: String(req.body?.kind || 'support'),
        category: req.body?.category,
        subject: req.body?.subject,
        body: req.body?.body,
        rating: req.body?.rating,
      });
      const row = await support.getTicket(id);
      res.status(201).json({
        ticket: support.publicTicket(row),
        messages: await support.messages(id),
      });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await support.getTicket(req.params.id);
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    await support.markRead(row, 'user');
    const next = await support.getTicket(row.id);
    res.json({
      ticket: support.publicTicket(next),
      messages: await support.messages(row.id),
    });
  })
);

router.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const row = await support.getTicket(req.params.id);
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    try {
      await support.replyAsUser(row, req.user, req.body?.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const next = await support.getTicket(row.id);
    res.json({
      ticket: support.publicTicket(next),
      messages: await support.messages(row.id),
    });
  })
);

router.post(
  '/:id/rate',
  asyncHandler(async (req, res) => {
    const row = await support.getTicket(req.params.id);
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    try {
      await support.setRating(row, req.body?.rating);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const next = await support.getTicket(row.id);
    res.json({ ticket: support.publicTicket(next), messages: await support.messages(row.id) });
  })
);

module.exports = router;
