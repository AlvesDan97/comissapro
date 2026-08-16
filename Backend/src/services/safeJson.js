function safeJson(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || (Array.isArray(fallback) ? '[]' : '{}'));
  } catch {
    return fallback;
  }
}

module.exports = { safeJson };
