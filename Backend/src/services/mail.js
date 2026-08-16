/**
 * Envio transacional. Sem RESEND_API_KEY só registra no log (dev).
 * Todo e-mail passa por aqui — links localhost nunca saem quando o app está no ar.
 */
const { render, appBaseUrl } = require('./emailTemplates');

const LOCAL_ORIGIN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/gi;

function rewriteLocalUrls(value) {
  if (value == null) return value;
  if (typeof value !== 'string') return value;
  const base = appBaseUrl();
  if (/localhost|127\.0\.0\.1/i.test(base)) return value;
  return value.replace(LOCAL_ORIGIN, base);
}

function sanitizeVars(vars) {
  const out = { ...(vars || {}) };
  for (const key of Object.keys(out)) {
    out[key] = rewriteLocalUrls(out[key]);
  }
  return out;
}

async function sendMail({ to, subject, text, html }) {
  const payload = {
    to,
    subject,
    text: rewriteLocalUrls(text || ''),
    html: rewriteLocalUrls(html || text),
  };
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
  const msg = render(name, sanitizeVars(vars));
  return sendMail({ to, ...msg });
}

module.exports = { sendMail, sendTemplate, appBaseUrl };
