function appBaseUrl() {
  return (process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:3847').replace(/\/$/, '');
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap({ title, preheader, body, ctaLabel, ctaUrl }) {
  const url = ctaUrl || `${appBaseUrl()}/app`;
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#08090A;font-family:Arial,Helvetica,sans-serif;color:#E8EAEB">
  <div style="display:none;max-height:0;overflow:hidden">${esc(preheader || title)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08090A;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#121416;border:1px solid #2A2E32;border-radius:16px;overflow:hidden">
        <tr><td style="padding:28px 28px 8px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#3FDA9A;font-weight:700">Comiss</td></tr>
        <tr><td style="padding:8px 28px 0;font-size:22px;font-weight:800;color:#F4F6F7;line-height:1.3">${esc(title)}</td></tr>
        <tr><td style="padding:16px 28px 8px;font-size:15px;line-height:1.6;color:#C5C9CC">${body}</td></tr>
        <tr><td style="padding:8px 28px 28px">
          <a href="${esc(url)}" style="display:inline-block;background:#3FDA9A;color:#06170F;text-decoration:none;font-weight:800;font-size:14px;padding:12px 18px;border-radius:999px">${esc(ctaLabel || 'Abrir o Comiss')}</a>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#6B7075;margin:16px 0 0">Você recebe este e-mail porque tem uma conta no Comiss. Cobrança da assinatura é enviada pelo Asaas.</p>
    </td></tr>
  </table>
</body></html>`;
  return html;
}

const TEMPLATES = {
  invite: (v) => ({
    subject: `${v.ownerName} te convidou para o Comiss`,
    text: `${v.ownerName} te convidou como ${v.roleLabel}. Crie sua senha: ${v.link} (vale 14 dias).`,
    html: wrap({
      title: 'Você foi convidado',
      preheader: `${v.ownerName} te chamou para o espaço no Comiss`,
      body: `<p style="margin:0 0 12px"><strong>${esc(v.ownerName)}</strong> te convidou para o espaço no Comiss como <strong>${esc(v.roleLabel)}</strong>.</p><p style="margin:0">Crie sua senha para lançar e acompanhar suas comissões. O convite vale 14 dias.</p>`,
      ctaLabel: 'Aceitar convite',
      ctaUrl: v.link,
    }),
  }),
  confirm: (v) => ({
    subject: 'Confirme seu e-mail — Comiss',
    text: `Olá${v.name ? `, ${v.name}` : ''}. Confirme sua conta no Comiss: ${v.link} (vale 48 horas).`,
    html: wrap({
      title: 'Confirme seu e-mail',
      preheader: 'Um clique para liberar sua conta',
      body: `<p style="margin:0 0 12px">Olá${v.name ? `, <strong>${esc(v.name)}</strong>` : ''}. Falta um passo para entrar no Comiss.</p><p style="margin:0">Confirme que este e-mail é seu. O link vale 48 horas.</p>`,
      ctaLabel: 'Confirmar e entrar',
      ctaUrl: v.link,
    }),
  }),
  reset: (v) => ({
    subject: 'Redefinir senha — Comiss',
    text: `Para criar uma nova senha, abra: ${v.link} (24 horas).`,
    html: wrap({
      title: 'Redefinir senha',
      preheader: 'Link válido por 24 horas',
      body: `<p style="margin:0">Alguém pediu para redefinir a senha desta conta. Se foi você, continue. O link vale 24 horas. Se não foi, ignore este e-mail.</p>`,
      ctaLabel: 'Criar nova senha',
      ctaUrl: v.link,
    }),
  }),
  receivable: (v) => ({
    subject: `Recebimento para confirmar · ${v.amountLabel}`,
    text: `Há comissão para confirmar se caiu na conta (${v.amountLabel}). ${v.link}`,
    html: wrap({
      title: 'Confirme se caiu na conta',
      preheader: v.amountLabel,
      body: `<p style="margin:0 0 12px">Há <strong>${esc(v.amountLabel)}</strong> com vencimento até hoje${v.detail ? `: ${esc(v.detail)}` : ''}.</p><p style="margin:0">Abra o Painel e confirme o que já entrou.</p>`,
      ctaLabel: 'Confirmar no Painel',
      ctaUrl: v.link,
    }),
  }),
  lead: (v) => ({
    subject: `Lead parado: ${v.title}`,
    text: `O lead "${v.title}" está sem movimento há ${v.days} dias. ${v.link}`,
    html: wrap({
      title: 'Lead sem follow-up',
      preheader: v.title,
      body: `<p style="margin:0">O lead <strong>${esc(v.title)}</strong>${v.client ? ` (${esc(v.client)})` : ''} está parado há <strong>${esc(v.days)} dias</strong>. Vale um toque hoje.</p>`,
      ctaLabel: 'Abrir pipeline',
      ctaUrl: v.link,
    }),
  }),
  trial: (v) => ({
    subject: `Seu mês grátis acaba em ${v.days} dia${v.days === 1 ? '' : 's'}`,
    text: `O trial termina em ${v.days} dia(s). Depois começa a cobrança do plano ${v.planName}. ${v.link}`,
    html: wrap({
      title: 'Mês grátis acabando',
      preheader: `${v.days} dia(s) restantes`,
      body: `<p style="margin:0">Faltam <strong>${esc(v.days)} dia${v.days === 1 ? '' : 's'}</strong> do período grátis. Em seguida o Asaas cobra o plano <strong>${esc(v.planName)}</strong>. Sem reembolso depois do trial.</p>`,
      ctaLabel: 'Ver planos',
      ctaUrl: v.link,
    }),
  }),
  inviteRemind: (v) => ({
    subject: `Convite ainda pendente: ${v.email}`,
    text: `${v.email} ainda não aceitou o convite. Reenvie ou acompanhe em Equipe. ${v.link}`,
    html: wrap({
      title: 'Convite sem resposta',
      preheader: v.email,
      body: `<p style="margin:0"><strong>${esc(v.email)}</strong> ainda não entrou no espaço. O convite pode expirar. Abra Equipe para reenviar ou remover.</p>`,
      ctaLabel: 'Ver equipe',
      ctaUrl: v.link,
    }),
  }),
  followup: (v) => ({
    subject: v.title || 'Pendência no Comiss',
    text: `${v.title}. ${v.body || ''} ${v.link}`,
    html: wrap({
      title: v.title || 'Pendência',
      preheader: v.body,
      body: `<p style="margin:0">${esc(v.body || 'Há uma pendência aguardando você no Comiss.')}</p>`,
      ctaLabel: 'Ver pendências',
      ctaUrl: v.link,
    }),
  }),
  supportReply: (v) => ({
    subject: `Comiss respondeu: ${v.subject || 'sua conversa'}`,
    text: `Olá${v.name ? `, ${v.name}` : ''}. Resposta sobre "${v.subject || 'sua conversa'}": ${v.body || ''} ${v.link}`,
    html: wrap({
      title: 'Nova resposta da Comiss',
      preheader: v.subject,
      body: `<p style="margin:0 0 12px">Olá${v.name ? `, <strong>${esc(v.name)}</strong>` : ''}. Respondemos sobre <strong>${esc(v.subject || 'sua conversa')}</strong>.</p><p style="margin:0">${esc(v.body || '')}</p>`,
      ctaLabel: 'Abrir no app',
      ctaUrl: v.link,
    }),
  }),
};

function render(name, vars = {}) {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Template de e-mail desconhecido: ${name}`);
  return fn(vars);
}

module.exports = { render, wrap };
