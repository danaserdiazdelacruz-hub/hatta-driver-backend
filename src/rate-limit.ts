// Rate limit en memoria para intentos de PIN: 5 por minuto por
// usuario. Suficiente para frenar fuerza bruta de un PIN de 4-8
// dígitos en una app interna; si algún día hay >1 réplica, migrar
// a Redis con INCR (lección de CitasMed).
const ventanas = new Map<string, { count: number; resetAt: number }>();

const LIMITE = 5;
const VENTANA_MS = 60_000;

export function pinPermitido(usuarioId: string): boolean {
  const now = Date.now();
  const v = ventanas.get(usuarioId);
  if (!v || v.resetAt <= now) {
    ventanas.set(usuarioId, { count: 1, resetAt: now + VENTANA_MS });
    return true;
  }
  if (v.count >= LIMITE) return false;
  v.count += 1;
  return true;
}
