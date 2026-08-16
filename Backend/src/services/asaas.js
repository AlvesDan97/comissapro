/**
 * Cliente Asaas. Sem ASAAS_API_KEY o billing local continua (piloto sem cobrança).
 * Sandbox: https://sandbox.asaas.com  API: https://api-sandbox.asaas.com
 * Produção: https://api.asaas.com
 */
const BASE = (process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com').replace(/\/$/, '');

function enabled() {
  return !!process.env.ASAAS_API_KEY;
}

async function asaasFetch(path, { method = 'GET', body } = {}) {
  if (!enabled()) {
    return { skipped: true };
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      access_token: process.env.ASAAS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.errors?.[0]?.description || data.message || `Asaas ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureCustomer(user) {
  if (!enabled()) return null;
  if (user.asaas_customer_id) return user.asaas_customer_id;
  const created = await asaasFetch('/v3/customers', {
    method: 'POST',
    body: {
      name: user.name,
      email: user.email,
      externalReference: user.id,
      notificationDisabled: false,
    },
  });
  return created.id;
}

function cycleMap(billingCycle) {
  return billingCycle === 'yearly' ? 'YEARLY' : 'MONTHLY';
}

async function createSubscription({ customerId, plan, billingCycle, extraSeats = 0, nextDueDate }) {
  if (!enabled()) return null;
  const value =
    (billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly) +
    extraSeats * (plan.extraSeatPrice || 0) * (billingCycle === 'yearly' ? 12 : 1);
  const body = {
    customer: customerId,
    billingType: 'UNDEFINED',
    value,
    cycle: cycleMap(billingCycle),
    description: `Comiss ${plan.name}${extraSeats ? ` + ${extraSeats} extra` : ''}`,
    externalReference: `${plan.id}:${billingCycle}`,
  };
  if (nextDueDate) body.nextDueDate = String(nextDueDate).slice(0, 10);
  return asaasFetch('/v3/subscriptions', { method: 'POST', body });
}

async function getSubscription(subscriptionId) {
  if (!enabled() || !subscriptionId) return null;
  try {
    return await asaasFetch(`/v3/subscriptions/${subscriptionId}`);
  } catch {
    return null;
  }
}

async function listSubscriptionPayments(subscriptionId, limit = 24) {
  if (!enabled() || !subscriptionId) return [];
  try {
    const data = await asaasFetch(`/v3/subscriptions/${subscriptionId}/payments?limit=${limit}`);
    const rows = Array.isArray(data) ? data : data.data;
    if (rows?.length || data?.object === 'list') return rows || [];
  } catch {
    /* fallback abaixo */
  }
  try {
    const data = await asaasFetch(`/v3/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=${limit}`);
    return data.data || [];
  } catch {
    return [];
  }
}

function mapPayment(p) {
  if (!p) return null;
  const status = String(p.status || '').toUpperCase();
  const failed = ['OVERDUE', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'DUNNING_REQUESTED'].includes(status);
  const open = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(status);
  return {
    id: p.id,
    value: p.value,
    dueDate: p.dueDate,
    paymentDate: p.clientPaymentDate || p.paymentDate || null,
    status,
    statusLabel: paymentLabel(status),
    billingType: p.billingType,
    invoiceUrl: p.invoiceUrl || p.bankSlipUrl || null,
    invoiceNumber: p.invoiceNumber || null,
    open,
    failed,
  };
}

function paymentLabel(status) {
  const map = {
    PENDING: 'Aguardando pagamento',
    RECEIVED: 'Pago',
    CONFIRMED: 'Confirmado',
    OVERDUE: 'Em atraso',
    REFUNDED: 'Estornado',
    RECEIVED_IN_CASH: 'Pago',
    REFUND_REQUESTED: 'Estorno pedido',
    CHARGEBACK_REQUESTED: 'Chargeback',
    AWAITING_RISK_ANALYSIS: 'Em análise',
  };
  return map[status] || status;
}

async function updateSubscription(subscriptionId, { value, nextDueDate }) {
  if (!enabled() || !subscriptionId) return null;
  const body = {};
  if (value != null) body.value = value;
  if (nextDueDate) body.nextDueDate = nextDueDate;
  return asaasFetch(`/v3/subscriptions/${subscriptionId}`, { method: 'PUT', body });
}

async function cancelSubscription(subscriptionId) {
  if (!enabled() || !subscriptionId) return null;
  return asaasFetch(`/v3/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}

function mapWebhookEvent(event) {
  const e = String(event || '').toUpperCase();
  if (e.includes('PAYMENT_RECEIVED') || e.includes('PAYMENT_CONFIRMED') || e.includes('PAYMENT_RECEIVED_IN_CASH')) {
    return 'active';
  }
  if (e.includes('OVERDUE')) return 'overdue';
  if (e.includes('DELETED') || e.includes('PAYMENT_DELETED') || e.includes('SUBSCRIPTION_DELETED')) {
    return 'canceled';
  }
  return null;
}

module.exports = {
  enabled,
  asaasFetch,
  ensureCustomer,
  createSubscription,
  getSubscription,
  listSubscriptionPayments,
  mapPayment,
  updateSubscription,
  cancelSubscription,
  mapWebhookEvent,
};
