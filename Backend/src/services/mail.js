/**
 * Envio transacional. Sem RESEND_API_KEY só registra no log (dev).
 */
const { render } = require('./emailTemplates');

async function sendMail({ to, subject, text, html }) {
  const payload = { to, subject, text: text || '', html: html || text };
  if (!to) return { ok: false, skipped: true };

  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Comiss <noreply@comiss.com.br>',
        to: [to],
        subject,
        text: payload.text,
        html: payload.html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[mail] Resend falhou:', err);
      return { ok: false, error: err };
    }
    return { ok: true, provider: 'resend' };
  }

  console.log('[mail:dev]', JSON.stringify({ to, subject, text: payload.text }, null, 2));
  return { ok: true, provider: 'log' };
}

async function sendTemplate(name, { to, vars }) {
  const msg = render(name, vars || {});
  return sendMail({ to, ...msg });
}

function appBaseUrl() {
  return (process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:3847').replace(/\/$/, '');
}

module.exports = { sendMail, sendTemplate, appBaseUrl };
