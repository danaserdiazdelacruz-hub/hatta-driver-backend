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
async function _aplicarSesion(sesion) {
  state.currentUser     = sesion.rol;
  state.currentUserName = sesion.nombre;

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
    }, cfg);
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
  state.users = usuarios.map(u => ({ id: u.id, name: u.nombre, role: u.rol }));
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
  document.querySelectorAll('[data-tab="maestro"]').forEach(btn => {
    btn.style.display = role === 'admin' ? 'flex' : 'none';
  });
  const ur = document.getElementById('user-role-display');
  if (ur) ur.textContent = state.currentUserName;
  const saved = localStorage.getItem(HATTA.LS_PREFIX + 'tab')
    ? JSON.parse(localStorage.getItem(HATTA.LS_PREFIX + 'tab')) : null;
  if (saved && document.getElementById('tab-' + saved) && !(saved === 'maestro' && role !== 'admin')) {
    switchTab(saved);
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
function renderUsuarios() {
  const tb = document.getElementById('tabla-usuarios');
  if (!tb) return;
  if (!state.users.length) {
    tb.innerHTML = '<tr><td colspan="4" class="empty">Sin usuarios.</td></tr>';
    return;
  }
  tb.innerHTML = state.users.map(u => `
    <tr>
      <td><strong>${esc(u.name)}</strong></td>
      <td><span class="role-pill ${u.role}">${esc(u.role.toUpperCase())}</span></td>
      <td class="mono">••••</td>
      <td>${u.role === 'admin' && state.users.filter(x => x.role === 'admin').length <= 1
        ? '<span class="muted-italic">Sistema</span>'
        : `<button class="btn btn-danger btn-sm" data-action="del-user" data-id="${u.id}">Borrar</button>`}</td>
    </tr>`).join('');
}

async function crearUsuario(event) {
  event.preventDefault();
  const f = event.target;
  const email = f.new_user_email.value.trim();
  const nombre = f.new_user_name.value.trim();
  const password = f.new_user_pin.value.trim();
  const role = f.new_user_role.value;
  if (!email || !email.includes('@')) return showToast('Error', 'Email inválido', 'warning');
  if (nombre.length < 2) return showToast('Error', 'Nombre muy corto', 'warning');
  if (password.length < 6) return showToast('Error', 'La contraseña debe tener al menos 6 caracteres', 'danger');

  const eid = api._eid();
  const sbClient = api.auth.getClient();
  // Crear en Supabase Auth + perfil
  const { data: authData, error: authErr } = await sbClient.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (authErr) return showToast('Error', authErr.message, 'danger');
  const { error: profileErr } = await sbClient.from('usuarios').insert({
    auth_id: authData.user.id, empresa_id: eid, nombre, rol: role,
  });
  if (profileErr) return showToast('Error', profileErr.message, 'danger');

  // Recargar lista
  const usuarios = await api.usuarios.leer();
  state.users = usuarios.map(u => ({ id: u.id, name: u.nombre, role: u.rol }));
  renderUsuarios();
  f.reset();
  showToast('Usuario creado', `${nombre} (${email})`, 'success');
}

async function borrarUsuario(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  if (u.role === 'admin' && state.users.filter(x => x.role === 'admin').length <= 1)
    return showToast('Error', 'No puedes borrar el único Administrador', 'danger');
  uiConfirm('Desactivar usuario', `¿Desactivar a ${u.name}? No podrá iniciar sesión.`, async () => {
    await api.usuarios.desactivar(id);
    state.users = state.users.filter(x => x.id !== id);
    renderUsuarios();
    showToast('Usuario desactivado', u.name, 'success');
  }, { danger: true, okText: 'Desactivar' });
}

/* ---- Compatibilidad: completeLogin ya no se usa desde el flujo nuevo ---- */
function completeLogin(role, name) {
  state.currentUser     = role;
  state.currentUserName = name || getRoleName(role);
  showAppForRole(role);
}
