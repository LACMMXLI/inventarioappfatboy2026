# Implementación por fases

Antes de cada fase se fija el siguiente alcance. Los resultados se registran en VERIFICACION.md.

| Fase | Componentes / datos | Operaciones | Aceptación |
|---|---|---|---|
| 1 | web, API, contratos, usuarios, roles, sucursales, sesiones | login, renovación, permisos, administración | autenticación real y aislamiento por sucursal |
| 2 | catálogo, unidades, presentaciones, habilitaciones, saldos, libro | alta, entrada, salida, merma, reversión | precisión decimal, no negativos, concurrencia e idempotencia |
| 3 | conteos, ítems, revisiones, programaciones, ajustes | iniciar, capturar, enviar, revisar, recontar, aprobar/rechazar | bloqueo de movimientos, ajuste único autorizado e historial |
| 4 | transferencias, ítems, recepciones | solicitar, despachar, recibir, devolver, conciliar pérdida | conservación de cantidades y recepción parcial |
| 5 | dashboard, consultas, auditoría, ABC | filtros, paginación, Excel/PDF | permisos y cifras consistentes |
| 6 | Docker, PWA, pruebas, respaldos, manuales | desplegar, respaldar, restaurar | flujos críticos aprobados, restauración y validación operativa |

No cerrar una fase con fallos críticos conocidos. Infraestructura externa requiere servidor y almacenamiento de respaldos configurados; no confundir archivos de despliegue con despliegue ejecutado.
