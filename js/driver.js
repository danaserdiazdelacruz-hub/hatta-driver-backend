/* ============================================================
   CHOFER — Consulta de estado por placa (vista pública)
   ============================================================ */
function buscarPlacaChofer() {
  const input = document.getElementById('driver-placa-input');
  const out = document.getElementById('driver-result');
  const placa = (input.value || '').toUpperCase().trim();
  if (!placa) return showToast('Error', 'Ingrese una placa', 'danger');
  const v = state.viajes.find(x => x.placa === placa);
  if (!v) {
    out.className = 'driver-result no-encontrado';
    out.innerHTML = `<i data-lucide="x-circle" class="dr-icon" style="color:var(--danger)"></i>
      <div class="dr-placa">${esc(placa)}</div><h3>No encontrado</h3>
      <p>Esta placa no está en el sistema.</p><p class="dr-hint">Verifique con Tráfico.</p>`;
    out.style.display = 'block'; icons(); return;
  }
  if (v.estado === EST.PENDIENTE || v.estado === EST.CARGANDO) {
    out.className = 'driver-result en-rampa';
    out.innerHTML = `<i data-lucide="check-circle" class="dr-icon" style="color:var(--success)"></i>
      <div class="dr-placa">${esc(placa)}</div><h3>Diríjase a la rampa</h3>
      <div class="dr-rampa">${esc(v.dock)}</div>
      <p>Estado: <strong>${v.estado === EST.CARGANDO ? 'Cargando' : 'Pendiente de carga'}</strong></p>`;
  } else if (v.estado === EST.LISTO || v.estado === EST.CARGADO_PATIO) {
    out.className = 'driver-result en-rampa';
    out.innerHTML = `<i data-lucide="package-check" class="dr-icon" style="color:var(--success)"></i>
      <div class="dr-placa">${esc(placa)}</div><h3>Carga completada</h3>
      <p class="dr-big">Listo para salir</p><p class="dr-hint">Diríjase a la garita.</p>`;
  } else {
    const cola = porEstado(EST.DISPONIBLE).sort((a, b) => (prioOrden(a.prioridad) - prioOrden(b.prioridad)) || (new Date(a.entrada) - new Date(b.entrada)));
    const pos = cola.findIndex(x => x.id === v.id);
    out.className = 'driver-result en-cola';
    out.innerHTML = `<i data-lucide="clock" class="dr-icon" style="color:var(--accent)"></i>
      <div class="dr-placa">${esc(placa)}</div>
      <h3>${v.estado === EST.DISPONIBLE ? 'Esperando rampa' : 'En patio'}</h3>
      ${pos >= 0 ? `<p class="dr-big">Turno <strong>${pos + 1}</strong> de ${cola.length}</p>` : '<p class="dr-big">En patio, espere a Tráfico</p>'}
      <p>Esperando: <strong>${calcEspera(v.entrada)}</strong></p>`;
  }
  out.style.display = 'block'; icons();
}
