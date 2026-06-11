# YMS — Backend (Fastify + TypeScript)

Backend de los módulos Garita y Despacho. Validado de punta a punta: **19/19 tests de integración** contra Postgres real con las migraciones 001-005 aplicadas (auth, ciclo completo, PIN, rate limit, registro del día).

## Arquitectura en una línea

**La DB decide, el backend autentica y transporta.** Cada endpoint llama una función `fn_*` de Postgres; los errores de negocio viajan como `{ success:false, error_code }` con HTTP 200; los HTTP 401/403/500 son auth o bugs.

## Variables de entorno (Railway)

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Connection string de Supabase (Database → Connection string → **Transaction pooler**, puerto 6543) |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret. Permite verificar tokens **localmente, sin llamada de red por request** |
| `FRONTEND_ORIGIN` | URL del frontend de garita (CORS). Ej: `https://garita.tudominio.com` |
| `TRUST_PROXY` | `true` en Railway |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | Opcionales (defaults sanos) |

Si falta algo, el proceso **no arranca** y dice exactamente qué falta (validación Zod en `env.ts`).

## Endpoints

| Método | Ruta | Roles | Hace |
|---|---|---|---|
| POST | `/api/garita/scan` | garita, trafico, admin | `fn_procesar_scan(qr,'GARITA',user,cd)` — entrada o salida según FSM |
| POST | `/api/garita/salida-excepcional` | garita, trafico, admin | Valida PIN (`fn_validar_pin_supervisor`) → `fn_cambiar_estatus(SALIDA_SIN_CARGA)` firmada con `autorizado_por` |
| POST | `/api/garita/rechazar-ingreso` | garita, trafico, admin | `fn_rechazar_ingreso` — incidencia, no cambia estado |
| GET | `/api/garita/registro-dia` | garita, trafico, admin | `v_registro_garita` del día **en zona America/Santo_Domingo** (no UTC) |
| GET | `/api/despacho/contexto` | despacho, trafico, admin | Rampas del CD + unidades EN_PATIO (para los selects) |
| POST | `/api/despacho/asignar` | despacho, trafico, admin | `fn_cambiar_estatus(ASIGNAR_RAMPA)` — bloquea rampa ocupada y condición especial |
| POST | `/api/despacho/scan` | despacho, trafico, admin | `fn_procesar_scan(qr,'RAMPA',...)` — inicia o termina carga según FSM |
| POST | `/api/despacho/cancelar` | despacho, trafico, admin | `fn_cambiar_estatus(CANCELAR_SOLICITUD)` con motivo — libera rampa |
| GET | `/api/despacho/monitor` | despacho, trafico, admin | `v_monitor_despacho`: 3 listas con minutos calculados (requiere migración **006**) |
| GET | `/health` | público | Para UptimeRobot/Railway |

## Decisiones de seguridad

- **JWT verificado localmente** (HS256 con el secret del proyecto) — más rápido y barato que llamar a Supabase por request; perfil (rol, CD) cacheado 60s, así desactivar un usuario surte efecto en <1 min.
- **PIN nunca en logs**: Pino redacta `*.pin`, `*.cedula`, `*.telefono` y el header Authorization desde el día 1.
- **Rate limit de PIN**: 5 intentos/minuto por usuario, en memoria. Si algún día corre con >1 réplica, migrar a Redis con `INCR` (nota en `rate-limit.ts`).
- **Roles por endpoint** vía `requireRol(...)` — agregar el módulo Despacho será `requireRol("despacho","trafico","admin")` y listo.

## Modo pruebas sin login (AUTH_DISABLED)

Para la etapa de pruebas, el backend puede correr **sin autenticación**:

```
AUTH_DISABLED=true
DEV_PERFIL_ID=<uuid de un perfil activo con cd_id>
```

Todas las operaciones quedan atribuidas a ese perfil (la trazabilidad de movimientos sigue intacta) y el log avisa con ⚠️ al arrancar. Crear el perfil de pruebas: `insert into perfiles (id, nombre, rol, cd_id) values (gen_random_uuid(), 'Pruebas', 'admin', '<cd uuid>') returning id;`

**Regla de oro: nunca con datos reales ni en la URL definitiva.** Activar el login real = quitar estas dos variables.

## Correr local / tests

```bash
npm install
npm run dev        # necesita .env con las variables de arriba
npm test           # tests de integración (necesita Postgres con migraciones 001-005)
```

## Onboarding de un usuario nuevo (manual, hasta que exista /admin)

1. Crear el usuario en Supabase Auth (email + password).
2. Insertar su perfil: `insert into perfiles (id, nombre, rol, cd_id) values ('<auth uid>', 'Nombre', 'garita', '<cd uuid>');`
3. Si es supervisor: `select fn_asignar_pin('<uid>', '1234');`

## Conectar el frontend

En el proyecto `garita-app`, definir `VITE_API_URL=https://<este-backend>.railway.app` — el modo demo se apaga solo. El login del frontend (pendiente, pieza chica) usa `@supabase/supabase-js` con `signInWithPassword` y manda el `access_token` como `Authorization: Bearer`.
