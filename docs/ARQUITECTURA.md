# Arquitectura y reglas de dominio

Monorepo pnpm con aplicación React/Vite, API NestJS y contratos TypeScript. La API es un monolito modular por dominio. PostgreSQL mantiene las relaciones y restricciones; Prisma administra migraciones y transacciones. El frontend nunca calcula ni modifica el saldo oficial.

## Datos y precisión

Cantidades `Decimal(18,6)`, costos `Decimal(18,4)`, moneda MXN. La API recibe cantidades como cadenas en notación decimal con punto y sin separadores. Todas las conversiones y operaciones contables usan `Prisma.Decimal`. La interfaz puede formatear valores para presentación, pero no envía sus redondeos como resultados contables.

Unidad base inmutable después del primer movimiento. Presentaciones con factor positivo; factor, nombre y costo quedan copiados en cada movimiento. Costo estándar editable para operaciones futuras. Los productos desactivados conservan su historial.

`inventory_movements` es el libro oficial. `stock_balances` es una proyección transaccional que se concilia diariamente. Nunca existe una ruta para sobrescribir saldos. Los triggers impiden editar o borrar movimientos, auditoría y revisiones, incluso por SQL ordinario.

## Concurrencia e idempotencia

Las mutaciones contables requieren `Idempotency-Key` único. Se almacenan identidad, operación, huella del cuerpo y respuesta en la misma transacción. Repetir el mismo contenido retorna el resultado original; reutilizar la clave con otro contenido se rechaza.

Las operaciones usan aislamiento Serializable, bloqueo de filas y hasta cinco intentos en conflictos de serialización, deadlocks y colisiones de unicidad. Los conflictos persistentes se reportan al cliente; no se silencian ni se repiten acciones fuera de la transacción.

Las existencias no pueden ser negativas. Las transferencias contabilizan salida y recepción mediante el mismo servicio de movimientos. La diferencia pendiente se calcula como enviado menos recibido, devuelto y perdido.

## Conteos

Al iniciar se bloquean todos los productos incluidos en la sucursal y se fija referencia y costo. Los movimientos siguen disponibles para otros productos y sucursales. Se permite un único bloqueo por sucursal/producto. La captura guarda versiones para rechazar sobrescrituras desde otro dispositivo. Las correcciones quedan en revisiones.

Al enviar, todas las cantidades deben estar capturadas; se calculan diferencias y se liberan bloqueos. Aprobar aplica esas diferencias al saldo vigente y crea una autorización única. Si otro conteo bloqueó el producto o el ajuste produciría negativo, la aprobación se rechaza completa hasta resolver la situación. Rechazar nunca ajusta saldos. Cancelar libera bloqueos. Recontar archiva la captura previa, fija nueva referencia y vuelve a bloquear.

Las programaciones generan borradores mediante el planificador del backend cada minuto. No bloquean productos hasta iniciar captura. El índice programación/fecha evita duplicados y los vencimientos pendientes se recuperan en siguientes ciclos. La frecuencia mensual limita el día al último día del mes cuando sea necesario.

## Seguridad

Argon2id para contraseñas; JWT de acceso de 15 minutos en memoria del navegador; token de renovación aleatorio, almacenado como SHA-256 y transportado solo en cookie HttpOnly. Renovación rotativa, vigencia de siete días y sesiones revocables. Cada petición autenticada vuelve a comprobar usuario activo, sesión, permisos y sucursales.

Renovación y cierre de sesión requieren Origin igual al origen configurado. Cookies Secure en producción y SameSite Strict. Límites de solicitudes y límite específico de login. Backend protegido aunque se invoque una ruta escondida en la interfaz.

Fotografías autenticadas, archivos de hasta 2 MB, formatos PNG/JPEG/WebP identificados por firma binaria, nombres internos aleatorios y almacenamiento abstraído por `PhotoStore`. No se aceptan SVG ni rutas de archivo del cliente.

## API pública

Prefijo `/api/v1`. OpenAPI en `/api/docs`. Autenticación Bearer para las operaciones protegidas.

| Área | Rutas |
|---|---|
| Sesiones | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password`; `GET /auth/me` |
| Administración | `GET/POST /branches`, `PATCH /branches/:id`, `GET/POST /users`, `PATCH /users/:id`, `GET /roles`, `PATCH /roles/:id` |
| Catálogo | `GET /catalog/meta`, `POST /catalog/categories`, `/catalog/units`; `GET/POST /catalog/products`, `PATCH /catalog/products/:id`, `GET/POST /catalog/products/:id/photo` |
| Inventario | `GET /inventory`, `/inventory/movements`, `/inventory/reconcile`; `POST /inventory/movements`, `/inventory/movements/:id/reverse` |
| Conteos | `GET/POST /counts`, `GET /counts/:id`, `POST /counts/:id/:action` |
| Programación | `GET/POST /schedules`, `PATCH /schedules/:id` |
| Transferencias | `GET/POST /transfers`, `GET /transfers/branches`, `POST /transfers/:id/:action` |
| Consultas | `GET /dashboard`, `/reports`, `/reports/export/xlsx`, `/reports/export/pdf`, `/audit` |

Listados operativos aceptan `page`, `pageSize` (máximo 100), y filtros compatibles `branchId`, `productId`, `categoryId`, `search`, `from`, `to`. Fechas ISO UTC. Errores uniformes `{statusCode,message,requestId}`. La selección de sucursal nunca amplía los permisos del usuario.

Acciones de conteo: `start`, `capture`, `submit`, `review`, `recount`, `approve`, `reject`, `cancel`. Captura: `{itemId,quantity,version}`. Recuento, rechazo y cancelación requieren `reason`. Acciones de transferencia: `request`, `send`, `receive`, `return`, `loss`, `cancel`. Recepción/devolución/pérdida: `{reason,items:[{itemId,quantity}]}`.
