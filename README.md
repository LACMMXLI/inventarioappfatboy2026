# Fatboy Inventarios

Aplicación React/TypeScript y API NestJS con persistencia real en PostgreSQL. Inventarios por sucursal, catálogo central, movimientos inmutables, conteos con aprobación, transferencias parciales, reportes Excel/PDF y auditoría.

## Desarrollo local en Windows

Para producción con servicios independientes: **[guía Docker/Coolify](docs/DESPLIEGUE-INDEPENDIENTE.md)**. Incluye archivos separados para PostgreSQL, API, frontend, migraciones y respaldos. Actualizar la interfaz no recrea la base de datos.

Requisitos: Node.js 24 y pnpm 11.25.0. No se necesita instalar PostgreSQL como servicio para este entorno: el repositorio incluye un iniciador de PostgreSQL 17 local. No sustituye la configuración de producción.

```powershell
pnpm install
pnpm db:local
```

Dejar esa terminal abierta. En otra terminal, desde la raíz:

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Aplicación: http://localhost:5173
- API y base de datos: http://localhost:3000/api/v1/health
- OpenAPI: http://localhost:3000/api/docs
- PostgreSQL local: `127.0.0.1:55432`, base `fatboy`, usuario `fatboy`.
- Usuario inicial: `admin@fatboy.local`. La contraseña es la indicada por el propietario durante la configuración; no está en el código.

La configuración local reside en `apps/api/.env`; los datos en `.local/postgres`. Ambos están excluidos de Git. No borrar `.local` para reiniciar la aplicación: contiene la base de datos. El iniciador solo genera configuración cuando falta, y conserva datos entre reinicios.

Para un PostgreSQL existente, copiar `.env.example` a `apps/api/.env`, configurar conexión y secretos y omitir `pnpm db:local`. La carga inicial crea roles, sucursales, unidades y categorías, pero ningún producto ni saldo ficticio. Ejecutar nuevamente el seed conserva las cuentas existentes y no reemplaza sus contraseñas.

## Verificación

Con PostgreSQL local iniciado:

```powershell
pnpm test:prepare
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:restore
```

Las pruebas usan `fatboy_test`, independiente de `fatboy`. La restauración crea una base nueva con nombre `fatboy_restore_*`. Los registros de prueba se conservan allí para inspección y nunca se cargan en la base operativa. Evitar ejecutar `test:prepare` durante una sesión de pruebas: regenera la configuración de pruebas.

`test:restore` requiere `pg_dump` y `pg_restore` de PostgreSQL 17 o superior. En este equipo se prepararon herramientas portables en `.local/pg-tools`; en otro equipo configurar `PG_TOOLS_DIR` o usar el contenedor oficial PostgreSQL siguiendo la guía de producción.

## Código y operación

- `apps/web`: navegación, dashboard, catálogo, captura móvil, administración, PWA.
- `apps/api`: servicios de dominio, autenticación, API REST, Prisma y migraciones.
- `packages/contracts`: contratos públicos compartidos; cantidades e importes son cadenas decimales.
- `infra/docker`: imágenes, proxy y respaldo cifrado externo.
- [Arquitectura](docs/ARQUITECTURA.md), [manual operativo](docs/OPERACION.md), [producción y restauración](docs/PRODUCCION.md), [resultados de validación](docs/VERIFICACION.md).

La PWA requiere HTTPS en producción. Solo almacena recursos estáticos, no respuestas de la API ni capturas offline. El escaneo por cámara depende de la compatibilidad del navegador y tiene búsqueda manual como alternativa.
