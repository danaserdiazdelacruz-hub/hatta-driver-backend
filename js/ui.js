/* ============================================================
   UI — Modales propios (reemplazan prompt()/confirm() del navegador)
   uiPrompt(titulo, {label, value, placeholder}, onOk)
   uiConfirm(titulo, mensaje, onOk, {danger})
   ============================================================ */

function cerrarUiModal() {
  const m = document.getElementById('ui-modal');
  if (m) m.remove();
  document.removeEventListener('keydown', _uiKeyHandler);
}

let _uiOnOk = null;
function _uiKeyHandler(e) {
  if (e.key === 'Escape') cerrarUiModal();
  else if (e.key === 'Enter') { const b = document.getElementById('ui-modal-ok'); if (b) { e.preventDefault(); b.click(); } }
}

function _uiBase(inner) {
  cerrarUiModal();
  const o = document.createElement('div');
  o.className = 'ui-modal';
  o.id = 'ui-modal';
  o.innerHTML = `<div class="ui-modal-card">${inner}</div>`;
  o.addEventListener('click', (e) => { if (e.target === o) cerrarUiModal(); });
  document.body.appendChild(o);
  document.addEventListener('keydown', _uiKeyHandler);
  icons();
  return o;
}

function uiPrompt(titulo, opts, onOk) {
  opts = opts || {};
  _uiOnOk = onOk;
  _uiBase(`
    <h3>${esc(titulo)}</h3>
    ${opts.label ? `<label class="ui-label">${esc(opts.label)}</label>` : ''}
    <input id="ui-modal-input" class="form-input" value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}">
    <div class="ui-modal-actions">
      <button class="btn btn-ghost" onclick="cerrarUiModal()">Cancelar</button>
      <button class="btn btn-primary" id="ui-modal-ok">Aceptar</button>
    </div>`);
  const input = document.getElementById('ui-modal-input');
  setTimeout(() => { input.focus(); input.select(); }, 60);
  document.getElementById('ui-modal-ok').onclick = () => {
    const val = input.value.trim();
    cerrarUiModal();
    if (typeof onOk === 'function') onOk(val);
  };
}

function uiConfirm(titulo, mensaje, onOk, conf) {
  conf = conf || {};
  _uiBase(`
    <h3>${esc(titulo)}</h3>
    <p class="ui-msg">${esc(mensaje)}</p>
    <div class="ui-modal-actions">
      <button class="btn btn-ghost" onclick="cerrarUiModal()">Cancelar</button>
      <button class="btn ${conf.danger ? 'btn-danger' : 'btn-primary'}" id="ui-modal-ok">${esc(conf.okText || 'Confirmar')}</button>
    </div>`);
  document.getElementById('ui-modal-ok').onclick = () => {
    cerrarUiModal();
    if (typeof onOk === 'function') onOk();
  };
}

function uiChoose(titulo, opciones, onPick) {
  const botones = (opciones || []).map((o, i) =>
    `<button class="ui-choice" data-i="${i}">${esc(o)}</button>`).join('');
  _uiBase(`
    <h3>${esc(titulo)}</h3>
    <div class="ui-choices">${botones}</div>
    <div class="ui-modal-actions"><button class="btn btn-ghost" onclick="cerrarUiModal()">Cancelar</button></div>`);
  document.querySelectorAll('#ui-modal .ui-choice').forEach(b => {
    b.onclick = () => { const v = opciones[parseInt(b.dataset.i, 10)]; cerrarUiModal(); if (typeof onPick === 'function') onPick(v); };
  });
}
