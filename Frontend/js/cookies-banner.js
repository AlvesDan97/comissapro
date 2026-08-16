(function () {
  if (localStorage.getItem('cp_cookie_consent')) return;

  const bar = document.createElement('div');
  bar.id = 'cookieBar';
  bar.innerHTML = `
    <div class="cookie-inner">
      <p>Usamos cookies essenciais para login e preferências. Analytics só com o seu ok. Veja a <a href="/cookies.html">Política de Cookies</a> e a <a href="/privacidade.html">Privacidade</a>.</p>
      <div class="cookie-actions">
        <button type="button" id="cookieReject" class="cookie-btn ghost">Só essenciais</button>
        <button type="button" id="cookieAccept" class="cookie-btn">Aceitar todos</button>
      </div>
    </div>`;
  document.body.appendChild(bar);

  const style = document.createElement('style');
  style.textContent = `
    #cookieBar{position:fixed;left:0;right:0;bottom:0;z-index:300;padding:14px 14px calc(14px + env(safe-area-inset-bottom,0px));background:rgba(8,9,10,.92);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.12)}
    #cookieBar .cookie-inner{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
    #cookieBar p{margin:0;color:#c5cbc3;font-size:13px;line-height:1.45;max-width:64ch;font-family:'DM Sans',sans-serif}
    #cookieBar a{color:#3FDA9A}
    .cookie-actions{display:flex;gap:8px;flex-shrink:0}
    .cookie-btn{border:none;border-radius:8px;padding:10px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#3FDA9A;color:#06170F;font-family:'DM Sans',sans-serif}
    .cookie-btn.ghost{background:transparent;color:#F2F4F0;border:1px solid rgba(255,255,255,.15)}
    @media(max-width:720px){
      .cookie-actions{width:100%;flex-direction:column}
      .cookie-btn{width:100%}
    }
  `;
  document.head.appendChild(style);

  const save = (value) => {
    localStorage.setItem('cp_cookie_consent', value);
    bar.remove();
  };
  document.getElementById('cookieAccept').onclick = () => save('all');
  document.getElementById('cookieReject').onclick = () => save('essential');
})();
