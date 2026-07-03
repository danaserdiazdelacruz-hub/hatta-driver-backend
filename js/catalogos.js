/* ============================================================
   CATALOGOS — Motor declarativo del Maestro
   ============================================================
   FILOSOFÍA:
   · Las definiciones viven en HATTA.CATALOGOS (hatta.config.js)
   · Este motor genera formulario, tabla, búsqueda, validación,
     auditoría (antes → después) y persistencia para TODOS los
     catálogos. Cero código por catálogo.
   · Agregar un catálogo = agregar un bloque en HATTA.CATALOGOS.
   · Los módulos operativos consultan CAT.opciones(tipo) para
     poblar selects/datalists. Nunca acceden al storage directo.

   API PÚBLICA:
     CAT.items(tipo)        → todos los registros
     CAT.activos(tipo)      → solo activos
     CAT.opciones(tipo, k?) → valores del campo principal (o k)
     CAT.crear / CAT.actualizar / CAT.toggleActivo / CAT.eliminar
     renderCatalogos()      → pinta el panel en #catalogos-engine
   ============================================================ */

let catTipoSel = null;   // catálogo seleccionado en el panel
let catEditId  = null;   // id en edición (null = modo crear)

const CAT = {

  def(tipo)  { return HATTA.CATALOGOS[tipo] || null; },
  tipos()    { return Object.keys(HATTA.CATALOGOS); },

  items(tipo) {
    const d = this.def(tipo); if (!d) return [];
    if (d.storage === 'tabla') return state[d.stateKey] || [];
    if (!state.catalogos) state.catalogos = {};
    if (!state.catalogos[tipo]) state.catalogos[tipo] = [];
    return state.catalogos[tipo];
  },

  activos(tipo) { return this.items(tipo).filter(x => x.activo !== false); },

  opciones(tipo, campo) {
    const d = this.def(tipo); if (!d) return [];
    const k = campo || d.campoPrincipal;
    return this.activos(tipo).map(x => x[k]).filter(Boolean);
  },

  buscar(tipo, campo, valor) {
    const v = String(valor || '').trim().toLowerCase();
    return this.items(tipo).find(x => String(x[campo] || '').toLowerCase() === v) || null;
  },

  /* ---- Validación declarativa ---- */
  _validar(def, datos, idActual) {
    for (const c of def.campos) {
      let v = (datos[c.key] == null) ? '' : String(datos[c.key]).trim();
      if (c.mayus) v = v.toUpperCase();
      datos[c.key] = v;
      if (c.requerido && !v)                return `${c.label} es obligatorio`;
      if (c.min && v && v.length < c.min)   return `${c.label} demasiado corto`;
      if (c.tipo === 'numero' && v && isNaN(Number(v))) return `${c.label} debe ser numérico`;
      if (c.unico && v) {
        const dup = CAT.items(def._tipo).find(x =>
          x.id !== idActual && String(x[c.key] || '').toUpperCase() === v.toUpperCase());
        if (dup) return `Ya existe un ${def.singular} con ${c.label.toLowerCase()} "${v}"`;
      }
    }
    return null;
  },

  /* ---- Diff para auditoría: "Placa: ABC123 → ABC124" ---- */
  _dif(def, antes, despues) {
    const cambios = [];
    def.campos.forEach(c => {
      const a = antes[c.key] == null ? '' : String(antes[c.key]);
      const b = despues[c.key] == null ? '' : String(despues[c.key]);
      if (a !== b) cambios.push(`${c.label}: ${a || '—'} → ${b || '—'}`);
    });
    return cambios.join(' · ');
  },

  /* ---- Persistencia (adaptador según storage) ---- */
  _persistir(op, def, tipo, item) {
    if (def.storage === 'tabla') {
      if (op === 'insertar')   return api[def.apiKey].insertar(item);
      if (op === 'actualizar') return api[def.apiKey].actualizar(item.id, item);
      if (op === 'eliminar')   return api[def.apiKey].eliminar(item.id);
    } else {
      if (op === 'insertar')   return api.catalogos.insertar(tipo, item);
      if (op === 'actualizar') return api.catalogos.actualizar(item.id, item);
      if (op === 'eliminar')   return api.catalogos.eliminar(item.id);
    }
    return Promise.resolve(null);
  },

  /* ---- Operaciones ---- */
  crear(tipo, datos) {
    const def = this.def(tipo); if (!def) return false;
    def._tipo = tipo;
    const err = this._validar(def, datos, null);
    if (err) { showToast('Revisa el formulario', err, 'warning'); return false; }

    const item = Object.assign({ id: uid(), activo: true }, datos);
    this.items(tipo).push(item);                       // optimista
    this._persistir('insertar', def, tipo, item).then(guardado => {
      if (guardado && guardado.id && guardado.id !== item.id) item.id = guardado.id;
    }).catch(() => {});

    logAccion(`Creó ${def.singular}`, item[def.campoPrincipal] || '');
    showToast(`${def.titulo}`, `${item[def.campoPrincipal]} agregado`, 'success');
    return true;
  },

  actualizar(tipo, id, datos) {
    const def = this.def(tipo); if (!def) return false;
    def._tipo = tipo;
    const item = this.items(tipo).find(x => x.id === id);
    if (!item) return false;

    const err = this._validar(def, datos, id);
    if (err) { showToast('Revisa el formulario', err, 'warning'); return false; }

    const antes = Object.assign({}, item);
    Object.assign(item, datos);
    const dif = this._dif(def, antes, item);
    if (!dif) { showToast('Sin cambios', 'No modificaste ningún campo', 'info'); return true; }

    this._persistir('actualizar', def, tipo, item).catch(() => {});
    logAccion(`Editó ${def.singular}`, `${antes[def.campoPrincipal] || ''} · ${dif}`);
    showToast('Actualizado', item[def.campoPrincipal] || '', 'success');
    return true;
  },

  toggleActivo(tipo, id) {
    const def = this.def(tipo); if (!def) return;
    const item = this.items(tipo).find(x => x.id === id);
    if (!item) return;
    item.activo = item.activo === false;               // invertir
    this._persistir('actualizar', def, tipo, item).catch(() => {});
    logAccion(`${item.activo ? 'Activó' : 'Desactivó'} ${def.singular}`, item[def.campoPrincipal] || '');
    renderCatalogos();
  },

  eliminar(tipo, id) {
    const def = this.def(tipo); if (!def) return;
    const idx = this.items(tipo).findIndex(x => x.id === id);
    if (idx === -1) return;
    const item = this.items(tipo)[idx];
    if (!confirm(`¿Eliminar ${def.singular} "${item[def.campoPrincipal] || ''}"?\nSe recomienda desactivar en lugar de eliminar para conservar el historial.`)) return;
    this.items(tipo).splice(idx, 1);
    this._persistir('eliminar', def, tipo, item).catch(() => {});
    logAccion(`Eliminó ${def.singular}`, item[def.campoPrincipal] || '');
    renderCatalogos();
  },
};

/* ============================================================
   RENDER — panel genérico dentro de Maestro → Catálogos
   ============================================================ */

function _catResolverOpciones(c) {
  // 'lista' con opcionesDe: 'config.catUnidad' → resuelve la ruta en state
  if (Array.isArray(c.opciones)) return c.opciones;
  if (c.opcionesDe) {
    const partes = c.opcionesDe.split('.');
    let ref = state;
    for (const p of partes) { ref = ref && ref[p]; }
    if (Array.isArray(ref)) return ref;
  }
  return [];
}

function _catCampoInput(c, valor) {
  const v = valor == null ? '' : String(valor);
  const base = `name="cat_${c.key}" class="form-input sm" style="margin:0;flex:1;min-width:110px${c.mayus ? ';text-transform:uppercase' : ''}"`;
  if (c.tipo === 'lista') {
    const ops = _catResolverOpciones(c);
    return `<select ${base}>${ops.map(o =>
      `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  if (c.tipo === 'ref') {
    const ops = CAT.opciones(c.ref);
    const listId = `dl-${c.ref}-${c.key}`;
    return `<input type="text" ${base} list="${listId}" placeholder="${esc(c.label)}" value="${esc(v)}">` +
      `<datalist id="${listId}">${ops.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
  }
  const tipo = c.tipo === 'numero' ? 'number' : 'text';
  return `<input type="${tipo}" ${base} placeholder="${esc(c.label)}${c.requerido ? ' *' : ''}" value="${esc(v)}"${c.requerido ? ' required' : ''}>`;
}

function renderCatalogos() {
  const cont = document.getElementById('catalogos-engine');
  if (!cont) return;

  const tipos = CAT.tipos();
  if (!catTipoSel || !tipos.includes(catTipoSel)) catTipoSel = tipos[0];
  const def = CAT.def(catTipoSel);
  const enEdicion = catEditId ? CAT.items(catTipoSel).find(x => x.id === catEditId) : null;
  if (catEditId && !enEdicion) catEditId = null;

  // --- Sub-navegación de catálogos ---
  const nav = tipos.map(t => {
    const d = CAT.def(t);
    return `<button class="chip cat-chip${t === catTipoSel ? ' active' : ''}" data-action="cat-tipo" data-tipo="${t}">
      <i data-lucide="${d.icono || 'database'}"></i> ${esc(d.titulo)}
      <span class="settings-count">${CAT.items(t).length}</span></button>`;
  }).join('');

  // --- Formulario generado desde la definición ---
  const campos = def.campos.map(c => _catCampoInput(c, enEdicion ? enEdicion[c.key] : '')).join('');
  const form = `
    <form onsubmit="catSubmit(event)" class="settings-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${campos}
      <button type="submit" class="btn btn-primary">${enEdicion ? 'Guardar cambios' : '+'}</button>
      ${enEdicion ? `<button type="button" class="btn btn-ghost btn-sm" data-action="cat-cancel">Cancelar</button>` : ''}
    </form>`;

  // --- Tabla generada desde la definición ---
  const q = (cont.querySelector('#cat-q') || {}).value || '';
  const ql = q.toLowerCase().trim();
  let filas = CAT.items(catTipoSel);
  if (ql) filas = filas.filter(x => def.campos.some(c => String(x[c.key] || '').toLowerCase().includes(ql)));

  const th = def.campos.map(c => `<th>${esc(c.label)}</th>`).join('');
  const tr = filas.length ? filas.map(x => `
    <tr class="${x.activo === false ? 'cat-inactivo' : ''}">
      ${def.campos.map(c => `<td class="${c.mayus ? 'mono' : ''}">${esc(x[c.key] || '—')}</td>`).join('')}
      <td><span class="badge" style="background:${x.activo === false ? 'var(--danger)' : 'var(--success)'};color:#fff">${x.activo === false ? 'Inactivo' : 'Activo'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-action="cat-edit" data-id="${x.id}" title="Editar"><i data-lucide="pencil"></i></button>
        <button class="btn btn-ghost btn-sm" data-action="cat-toggle" data-id="${x.id}" title="${x.activo === false ? 'Activar' : 'Desactivar'}"><i data-lucide="power"></i></button>
        <button class="btn btn-danger btn-sm" data-action="cat-del" data-id="${x.id}" title="Eliminar">✕</button>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="${def.campos.length + 2}" class="empty">${ql ? 'Nada coincide' : `Sin ${def.titulo.toLowerCase()} aún`}</td></tr>`;

  cont.innerHTML = `
    <div class="motivos-chips" style="margin-bottom:14px">${nav}</div>
    ${def.ayuda ? `<p class="muted" style="margin-bottom:10px">${esc(def.ayuda)}</p>` : ''}
    ${form}
    <div class="modbar-search" style="margin:10px 0;max-width:320px">
      <i data-lucide="search"></i>
      <input id="cat-q" oninput="renderCatTabla()" placeholder="Buscar en ${esc(def.titulo.toLowerCase())}…" autocomplete="off" value="${esc(q)}">
    </div>
    <div style="overflow-x:auto"><table><thead><tr>${th}<th>Estado</th><th></th></tr></thead><tbody id="cat-tabla">${tr}</tbody></table></div>`;

  _catBind(cont);
  icons();
}

/* Re-render solo de la tabla (para no perder el foco del buscador) */
function renderCatTabla() {
  const cont = document.getElementById('catalogos-engine');
  const tb = document.getElementById('cat-tabla');
  if (!cont || !tb) return;
  const def = CAT.def(catTipoSel);
  const ql = ((document.getElementById('cat-q') || {}).value || '').toLowerCase().trim();
  let filas = CAT.items(catTipoSel);
  if (ql) filas = filas.filter(x => def.campos.some(c => String(x[c.key] || '').toLowerCase().includes(ql)));
  tb.innerHTML = filas.length ? filas.map(x => `
    <tr class="${x.activo === false ? 'cat-inactivo' : ''}">
      ${def.campos.map(c => `<td class="${c.mayus ? 'mono' : ''}">${esc(x[c.key] || '—')}</td>`).join('')}
      <td><span class="badge" style="background:${x.activo === false ? 'var(--danger)' : 'var(--success)'};color:#fff">${x.activo === false ? 'Inactivo' : 'Activo'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-action="cat-edit" data-id="${x.id}" title="Editar"><i data-lucide="pencil"></i></button>
        <button class="btn btn-ghost btn-sm" data-action="cat-toggle" data-id="${x.id}" title="${x.activo === false ? 'Activar' : 'Desactivar'}"><i data-lucide="power"></i></button>
        <button class="btn btn-danger btn-sm" data-action="cat-del" data-id="${x.id}" title="Eliminar">✕</button>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="${def.campos.length + 2}" class="empty">${ql ? 'Nada coincide' : `Sin ${def.titulo.toLowerCase()} aún`}</td></tr>`;
  icons();
}

/* ---- Delegación autocontenida (no toca app.js) ---- */
function _catBind(cont) {
  if (cont._catBound) return;
  cont._catBound = true;
  cont.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    switch (a) {
      case 'cat-tipo':   catTipoSel = el.dataset.tipo; catEditId = null; renderCatalogos(); break;
      case 'cat-edit':   catEditId = id; renderCatalogos(); break;
      case 'cat-cancel': catEditId = null; renderCatalogos(); break;
      case 'cat-toggle': CAT.toggleActivo(catTipoSel, id); break;
      case 'cat-del':    CAT.eliminar(catTipoSel, id); break;
    }
  });
}

function catSubmit(event) {
  event.preventDefault();
  const def = CAT.def(catTipoSel);
  const f = event.target;
  const datos = {};
  def.campos.forEach(c => {
    const input = f.elements['cat_' + c.key];
    datos[c.key] = input ? input.value : '';
  });
  const ok = catEditId
    ? CAT.actualizar(catTipoSel, catEditId, datos)
    : CAT.crear(catTipoSel, datos);
  if (ok) { catEditId = null; renderCatalogos(); }
}
