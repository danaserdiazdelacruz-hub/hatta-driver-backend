# HATTA v2 — Configuración con Supabase

## Pasos para activar el backend

### 1. Crear proyecto en Supabase
1. Ir a https://supabase.com → New project
2. Nombrar el proyecto (ej. "hatta-produccion")
3. Elegir región: **US East** (más cercana a RD)
4. Guardar la contraseña del proyecto

### 2. Crear las tablas
1. En el dashboard de Supabase → **SQL Editor** → New query
2. Abrir el archivo `supabase_schema.sql` de este proyecto
3. Pegar todo el contenido → **Run**
4. Verificar que aparecen las tablas en Table Editor

### 3. Configurar credenciales en HATTA
1. En Supabase → **Settings** → **API**
2. Copiar **Project URL** y **anon public**
3. Abrir `js/hatta.config.js`
4. Pegar los valores:
```js
supabase: {
  url:     'https://TU-PROYECTO.supabase.co',
  anonKey: 'eyJhbGciOiJI...(tu anon key)...',
}
```

### 4. Crear el primer usuario administrador
1. En Supabase → **Authentication** → **Users** → **Add user**
2. Ingresar email y contraseña del Admin
3. Copiar el UUID del usuario creado
4. En SQL Editor, ejecutar:
```sql
INSERT INTO public.usuarios (auth_id, empresa_id, nombre, rol)
VALUES (
  'UUID-DEL-USUARIO-AQUI',
  '00000000-0000-0000-0000-000000000001',
  'Admin Principal',
  'admin'
);
```

### 5. Abrir HATTA
- Abrir `index.html` en el navegador
- Iniciar sesión con el email y contraseña del paso 4
- Listo — datos en la nube

---

## Migrar datos existentes (si venías del HATTA v4 local)

1. Abrir el HATTA v4 viejo (el que usa localStorage)
2. Abrir la consola del navegador (F12)
3. Ejecutar:
```js
await migrarDatos()
```
4. Ingresar el empresa_id cuando lo pida
5. Confirmar la migración

---

## Crear usuarios adicionales (desde el sistema)

1. Iniciar sesión como Admin
2. Ir a **Maestro** → **Usuarios** → **Nuevo usuario**
3. Ingresar: email, nombre, contraseña (min 6 caracteres), rol
4. El usuario puede iniciar sesión de inmediato

---

## Notas de seguridad

- **Nunca** subir `hatta.config.js` con las credenciales a GitHub
- El `anonKey` es público (está diseñado así — el RLS protege los datos)
- La `service_role key` de Supabase NUNCA va en el frontend
- Las contraseñas de usuarios las maneja Supabase Auth (encriptadas)

