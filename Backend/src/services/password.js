function passwordChecks(password) {
  const p = String(password || '');
  return {
    len: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    num: /\d/.test(p),
  };
}

function passwordError(password) {
  const c = passwordChecks(password);
  if (c.len && c.upper && c.lower && c.num) return null;
  return 'Senha fraca. Use pelo menos 8 caracteres, com letra maiúscula, minúscula e número.';
}

module.exports = { passwordChecks, passwordError };
