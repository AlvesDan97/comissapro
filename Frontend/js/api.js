const API_BASE = window.COMISSAPRO_API || '/api';

const Api = {
  token: localStorage.getItem('cp_token') || null,

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('cp_token', token);
    else localStorage.removeItem('cp_token');
  },

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (err) {
      // Offline queue for mutating calls
      if (options.method && options.method !== 'GET') {
        queueOffline({ path, options });
        throw new Error('Sem conexão — ação salva na fila offline');
      }
      throw err;
    }

    if (res.status === 204) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/csv')) {
      if (!res.ok) throw new Error('Falha no export');
      return res.blob();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || 'Erro na API');
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  },

  get: (p) => Api.request(p),
  post: (p, body) => Api.request(p, { method: 'POST', body: JSON.stringify(body) }),
  patch: (p, body) => Api.request(p, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (p) => Api.request(p, { method: 'DELETE' }),

  async upload(path, formData) {
    return Api.request(path, { method: 'POST', body: formData, headers: {} });
  },
};

function queueOffline(item) {
  const key = 'cp_offline_queue';
  const q = JSON.parse(localStorage.getItem(key) || '[]');
  q.push({ ...item, createdAt: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(q));
  window.dispatchEvent(new Event('cp-offline-queued'));
}

async function flushOfflineQueue() {
  const key = 'cp_offline_queue';
  const q = JSON.parse(localStorage.getItem(key) || '[]');
  if (!q.length || !Api.token) return 0;
  try {
    await Api.post('/tools/offline-sync', { items: q });
    // replay best-effort
    for (const item of q) {
      try {
        await Api.request(item.path, {
          method: item.options.method,
          body: item.options.body,
        });
      } catch (_) {
        /* ignore replay conflicts */
      }
    }
    localStorage.setItem(key, '[]');
    window.dispatchEvent(new Event('cp-offline-flushed'));
    return q.length;
  } catch {
    return 0;
  }
}

window.addEventListener('online', () => flushOfflineQueue());

window.Api = Api;
window.flushOfflineQueue = flushOfflineQueue;
