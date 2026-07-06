/* ============================================================
   AUTH — Autenticación con Supabase
   ============================================================
   Fase 2: Supabase Auth reemplaza sessionStorage + PIN.
   El usuario inicia sesión con email + contraseña.
   El JWT de Supabase mantiene la sesión entre recargas.
   El rol (admin/trafico/chofer) viene de public.usuarios.
   ============================================================ */

function getRoleName(role) {
  return ({ admin: 'Administrador', trafico: 'Tráfico', chofer: 'Chofer' })[role] || role;
}

/* ---- Verificar sesión existente al cargar la app ---- */
async function checkSession() {
  const sesion = await api.auth.restaurarSesion();
  if (sesion) {
    _aplicarSesion(sesion);
  } else {
    showLoginScreen();
  }
}

/* ---- Login con email + password ---- */
async function loginConCredenciales() {
  const emailInput = (document.getElementById('lf-user').value || '').trim();
  const passInput  = (document.getElementById('lf-pass').value || '').trim();
  const errEl      = document.getElementById('lf-error');

  errEl.style.display = 'none';
  errEl.textContent = '';

  if (!emailInput || !passInput) { _lfError('Ingrese usuario y contraseña'); return; }

  // Mostrar spinner en el botón
  const btn = document.querySelector('.lf-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }

  const result = await api.auth.login(emailInput, passInput);

  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="log-in"></i> Ingresar'; icons(); }

  if (!result.ok) {
    _lfError(result.error || 'Usuario o contraseña incorrectos');
    document.getElementById('lf-pass').value = '';
    document.getElementById('lf-pass').focus();
    return;
  }

  document.getElementById('lf-user').value = '';
  document.getElementById('lf-pass').value = '';
  _aplicarSesion(result.session);
}

/* ---- Aplicar sesión: cargar datos + mostrar app ---- */
/* Módulos efectivos de un usuario: su lista asignada o, si es
   null, los valores por defecto de su rol. 'maestro' jamás para
   no-admins, aunque esté en la lista. */
function modulosDe(u) {
  const validos = HATTA.MODULOS.map(m => m.id);
  let mods = Array.isArray(u.modulos) && u.modulos.length
    ? u.modulos.filter(id => validos.includes(id))
    : (HATTA.modulosPorRol[u.rol] || []).slice();
  if (u.rol !== 'admin') mods = mods.filter(id => id !== 'maestro');
  return mods;
}

async function _aplicarSesion(sesion) {
  state.currentUser     = sesion.rol;
  state.currentUserName = sesion.nombre;
  state.usuarioId       = sesion.usuario_id;
  state.misModulos      = modulosDe(sesion);

  // Sincronizar state con Supabase
  await _cargarEstadoInicial();

  // Activar Realtime
  api.realtime.suscribir();

  // Registrar en bitácora
  logAccion('Inicio de sesión', sesion.nombre);

  showAppForRole(sesion.rol);
  showToast('Bienvenido', `Hola, ${sesion.nombre}`, 'success');
}

/* ---- Cargar todo el estado desde Supabase ---- */
async function _cargarEstadoInicial() {
  const [viajes, historial, rechazos, demoras, vehiculos, choferes, usuarios, rampasDB, cfg, bitacora, catalogos] =
    await Promise.all([
      api.viajes.leer(),
      api.historial.leer(),
      api.rechazos.leer(),
      api.demoras.leer(),
      api.vehiculos.leer(),
      api.choferes.leer(),
      api.usuarios.leer(),
      api.rampas.leer(),
      api.config.leer(),
      api.bitacora.leer(),
      api.catalogos.leerTodos(),
    ]);

  state.viajes    = viajes;
  state.history   = historial;
  state.rechazos  = rechazos;
  state.demoras   = demoras;
  state.vehiculos = vehiculos;
  state.choferes  = choferes;
  state.bitacora  = bitacora;
  state.catalogos = catalogos || {};

  // Config de empresa — ANTES de construir rampas, porque
  // numRampas() depende de config.numRampas
  if (cfg) {
    state.config = Object.assign({
      modoSalida:    HATTA.defaults.modoSalida,
      sla:           JSON.parse(JSON.stringify(HATTA.defaults.sla)),
      motivosDemora: [...HATTA.defaults.motivosDemora],
      motivosRampa:  [...HATTA.defaults.motivosRampa],
      catUnidad:     [...HATTA.defaults.catUnidad],
      catVehiculo:   [...HATTA.defaults.catVehiculo],
      selPatio:      { ...HATTA.defaults.selPatio },
    }, Object.fromEntries(Object.entries(cfg).filter(([, v]) => v != null)));
  }

  // Mapear rampas a los arrays de estado que usa el sistema
  state.docksActive = Array(numRampas()).fill(true);
  state.docksMotivo = {};
  rampasDB.forEach(r => {
    if (r.num >= 1 && r.num <= numRampas()) {
      state.docksActive[r.num - 1] = r.activa;
      if (!r.activa && r.motivo_baja) state.docksMotivo[r.num] = r.motivo_baja;
    }
  });

  // Usuarios para Maestro (id, nombre, rol)
  state.users = usuarios.map(u => ({ id: u.id, name: u.nombre, role: u.rol, modulos: u.modulos, activo: u.activo !== false }));
}

/* ---- Logout ---- */
async function logout() {
  if (state.currentUser && state.currentUser !== 'chofer') {
    logAccion('Cierre de sesión', state.currentUserName);
    // Escribir la bitácora antes de cerrar sesión
    await api.bitacora.insertar({
      usuario: state.currentUserName, rol: state.currentUser,
      accion: 'Cierre de sesión', detalle: state.currentUserName,
    });
  }
  api.realtime.desuscribir();
  state.currentUser = null;
  state.currentUserName = '';
  await api.auth.logout();
  showLoginScreen();
}

/* ---- Pantallas ---- */
function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('driver-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'none';
  const errEl = document.getElementById('lf-error');
  if (errEl) errEl.style.display = 'none';
  const u = document.getElementById('lf-user');
  const p = document.getElementById('lf-pass');
  if (u) u.value = '';
  if (p) p.value = '';
  setTimeout(() => { if (u) u.focus(); }, 150);
  icons();
}

function showAppForRole(role) {
  document.getElementById('login-screen').style.display = 'none';
  if (role === 'chofer') {
    document.getElementById('driver-screen').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
    icons(); return;
  }
  document.getElementById('driver-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';

  // Visibilidad de pestañas según los módulos del usuario
  if (!Array.isArray(state.misModulos) || !state.misModulos.length) {
    state.misModulos = modulosDe({ rol: role, modulos: null });
  }
  const mods = state.misModulos;
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.style.display = mods.includes(btn.dataset.tab) ? 'flex' : 'none';
  });

  const ur = document.getElementById('user-role-display');
  if (ur) ur.textContent = state.currentUserName;
  const saved = localStorage.getItem(HATTA.LS_PREFIX + 'tab')
    ? JSON.parse(localStorage.getItem(HATTA.LS_PREFIX + 'tab')) : null;
  if (saved && document.getElementById('tab-' + saved) && mods.includes(saved)) {
    switchTab(saved);
  } else if (mods.length) {
    switchTab(mods[0]);
  } else {
    renderAll();
  }
  icons();
}

/* ---- Error de login ---- */
function _lfError(msg) {
  const el = document.getElementById('lf-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.classList.remove('lf-shake');
  void el.offsetWidth;
  el.classList.add('lf-shake');
}

/* ---- Gestión de usuarios (Maestro → Admin) ---- */
/* ============================================================
   ADMINISTRADOR DE ACCESO — Maestro → Usuarios
   Cada usuario tiene módulos asignados (toggles de un toque).
   Reglas de seguridad:
   · 'maestro' solo puede asignarse a administradores
   · un admin no puede quitarse 'maestro' a sí mismo (anti-bloqueo)
   · todo usuario debe conservar al menos 1 módulo
   · cada cambio queda en bitácora y se guarda al instante
   ============================================================ */
function renderUsuarios() {
  const cont = document.getElementById('acceso-admin');
  if (!cont) return;
  const usuarios = state.users;
  if (!usuarios.length) {
    cont.innerHTML = vacio('users', 'Sin usuarios cargados', 'Da de alta el primero con la guía de abajo');
    return;
  }
  cont.innerHTML = usuarios.map(u => {
    const mods = modulosDe({ rol: u.role, modulos: u.modulos });
    const esYo = u.id === state.usuarioId;
    const chips = HATTA.MODULOS.map(m => {
      const activo = mods.includes(m.id);
      const bloqueado = (m.soloAdmin && u.role !== 'admin');
      return `<button class="mod-chip ${activo ? 'on' : ''} ${bloqueado ? 'lock' : ''}"
        style="--modc:${m.color};--modc-ink:${m.tinta}" ${bloqueado ? 'disabled title="Solo administradores"' : ''}
        onclick="toggleModuloUsuario('${esc(u.id)}','${m.id}')">
        <i data-lucide="${m.icono}"></i> ${esc(m.label)}</button>`;
    }).join('');
    return `<div class="acceso-user ${u.activo ? '' : 'inactivo'}">
      <div class="acceso-user-head">
        <div class="acceso-user-id">
          <strong>${esc(u.name)}</strong>${esYo ? ' <span class="yo-pill">tú</span>' : ''}
          <span class="role-pill ${esc(u.role)}">${esc((u.role || '').toUpperCase())}</span>
          ${u.activo ? '' : '<span class="badge" style="background:var(--danger);color:#fff">Inactivo</span>'}
        </div>
        ${esYo || (u.role === 'admin' && state.users.filter(x => x.role === 'admin' && x.activo).length <= 1)
          ? ''
          : `<button class="btn btn-ghost btn-sm" data-action="del-user" data-id="${esc(u.id)}"><i data-lucide="user-x"></i> Desactivar</button>`}
      </div>
      <div class="acceso-user-mods">${chips}</div>
    </div>`;
  }).join('');
  icons();
}

function toggleModuloUsuario(userId, modId) {
  const u = state.users.find(x => x.id === userId);
  if (!u) return;
  const def = HATTA.MODULOS.find(m => m.id === modId);
  if (!def) return;
  if (def.soloAdmin && u.role !== 'admin')
    return showToast('No permitido', 'El Maestro es solo para administradores', 'warning');

  const actuales = modulosDe({ rol: u.role, modulos: u.modulos });
  const tiene = actuales.includes(modId);

  if (tiene && u.id === state.usuarioId && modId === 'maestro')
    return showToast('No permitido', 'No puedes quitarte el Maestro a ti mismo — otro administrador debe hacerlo', 'warning');
  if (tiene && actuales.length <= 1)
    return showToast('No permitido', 'Todo usuario debe conservar al menos un módulo', 'warning');

  const nuevos = tiene ? actuales.filter(m => m !== modId) : [...actuales, modId];
  u.modulos = nuevos;
  api.usuarios.actualizar(u.id, { modulos: nuevos })
    .then(ok => { if (!ok) showToast('No se guardó en la nube', 'El cambio quedó solo en este equipo', 'danger'); })
    .catch(err => showToast('No se guardó en la nube', err.message || String(err), 'danger'));
  logAccion('Acceso modificado', `${u.name}: ${tiene ? 'quitó' : 'agregó'} ${def.label} · módulos: ${nuevos.join(', ')}`);

  // Si me lo cambié a mí mismo, aplicar en vivo
  if (u.id === state.usuarioId) {
    state.misModulos = nuevos;
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.style.display = nuevos.includes(btn.dataset.tab) ? 'flex' : 'none';
    });
  }
  renderUsuarios();
}

async function borrarUsuario(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  if (u.role === 'admin' && state.users.filter(x => x.role === 'admin' && x.activo).length <= 1)
    return showToast('Error', 'No puedes desactivar el único Administrador', 'danger');
  uiConfirm('Desactivar usuario', `¿Desactivar a ${u.name}? No podrá iniciar sesión.`, async () => {
    await api.usuarios.actualizar(id, { activo: false });
    u.activo = false;
    logAccion('Usuario desactivado', u.name);
    renderUsuarios();
    showToast('Usuario desactivado', u.name, 'success');
  }, { danger: true, okText: 'Desactivar' });
}

/* Guía de alta: SQL listo con la empresa de la sesión */
function copiarSqlAlta() {
  const eid = api._eid() || 'EMPRESA_ID';
  const sql = `insert into public.usuarios (auth_id, empresa_id, nombre, rol)\nvalues ('UID_DEL_PASO_1', '${eid}', 'NOMBRE', 'trafico');`;
  (navigator.clipboard ? navigator.clipboard.writeText(sql) : Promise.reject())
    .then(() => showToast('SQL copiado', 'Pega en Supabase → SQL Editor y completa UID y nombre', 'success'))
    .catch(() => uiPrompt('Copia este SQL', { label: 'SQL de alta', value: sql }, () => {}));
}

/* ---- Compatibilidad: completeLogin ya no se usa desde el flujo nuevo ---- */
function completeLogin(role, name) {
  state.currentUser     = role;
  state.currentUserName = name || getRoleName(role);
  showAppForRole(role);
}
