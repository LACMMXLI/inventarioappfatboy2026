# Evidencia de verificación

Fecha: 8 de octubre de 2026. Entorno local Windows, Node.js 24.21.0, pnpm 11.25.0 y PostgreSQL 17.9 real.

## Resultado de las fases

| Fase | Implementación y comprobación local |
|---|---|
| 1 — Fundamentos | Monorepo, autenticación Argon2id/JWT, renovación rotativa, revocación, roles y sucursales. Comprobados login, sesiones y rechazos de acceso por HTTP. |
| 2 — Catálogo e inventario | Catálogo, unidades, presentaciones, fotos, mínimos, movimientos y reversión. Comprobadas precisión decimal, conversión, no negativos, inmutabilidad, aislamiento, reintentos e idempotencia concurrente. |
| 3 — Conteos | Borradores, asignación, programación, bloqueo de productos, captura móvil, versiones, revisión, recuentos, ajustes y cancelación. Comprobadas referencias protegidas, ocultación al empleado y aprobación simultánea sin duplicación. |
| 4 — Transferencias | Solicitud, despacho, recepción parcial, devolución, pérdida autorizada y cierre. Comprobada conservación de cantidades y rechazo de excesos/cancelación posterior al envío. |
| 5 — Administración | Dashboard, filtros, reportes, ABC, Excel/PDF, usuarios, permisos y auditoría. Comprobada coincidencia con datos y firmas de archivos reales. |
| 6 — Calidad y operación | Build de producción, PWA, iconos, pruebas de navegador, configuración Docker/Coolify, respaldo cifrado y manuales. La puesta en producción externa permanece pendiente. |

## Pruebas ejecutadas

- `pnpm build`: contratos, backend y frontend compilados correctamente; service worker y manifiesto generados.
- `pnpm test`: **20 pruebas de backend/dominio y 2 de frontend aprobadas**.
- `pnpm test:e2e`: **4 pruebas aprobadas**, con flujo completo en Chromium de escritorio y viewport iPhone: producto, inventario inicial, conteo, aprobación y exportaciones; también acceso anónimo y origen de renovación inválido. Ver reporte local Playwright para la última ejecución.
- `pnpm test:restore`: respaldo custom de `fatboy_test`, cifrado/descifrado AES-GCM, restauración a una base nueva, comparación de siete tablas y conciliación entre saldos y libro.
- `pnpm audit --prod --audit-level high`: **sin vulnerabilidades conocidas reportadas** en la revisión ejecutada. Las dependencias están fijadas y el lockfile conserva la resolución.

Se agregaron versiones corregidas de NestJS, Prisma y React Router, y overrides explícitos para dependencias transitivas vulnerables. Los flujos y exportaciones se volvieron a ejecutar tras esas actualizaciones.

## Separación de ambientes

`fatboy` es la base operativa local. `fatboy_test` contiene fixtures y operaciones automatizadas. Las bases `fatboy_restore_*` son restauraciones de prueba. Ningún producto o saldo de demostración se cargó en la base operativa.

Los accesos locales se configuraron con las claves proporcionadas por el propietario y están fuera del repositorio. La contraseña de la aplicación se almacena en PostgreSQL como hash Argon2id.

## Pendientes de infraestructura y validación operativa

- Docker no está instalado en este equipo: no se ejecutó una construcción ni un arranque de los contenedores. Los archivos Docker/Compose se entregan para validación en el servidor de destino.
- No se desplegó en Coolify ni se configuró un dominio o certificado HTTPS.
- No se proporcionó un destino externo de respaldo, configuración rclone ni clave age. Se entregó el servicio configurable; su subida y alertas externas todavía no se han probado.
- La restauración local verifica la base de datos; falta ensayar el paquete completo de producción, incluyendo fotografías y recuperación en Coolify.
- La cámara física, instalación en dispositivos reales y operación con personal de Fatboy requieren validación en los dispositivos y entorno de destino. El flujo móvil se comprobó en navegador automatizado.
- Los logotipos y fotografías originales de marca no estaban disponibles como archivos independientes. Se implementó identidad tipográfica con corona y carga de fotografías, sin recortar las capturas de referencia.

No declarar la fase de producción cerrada hasta resolver estos puntos. Las funcionalidades diferidas del plan —offline, POS, lotes, caducidades y lectores especializados— no forman parte de esta entrega.
