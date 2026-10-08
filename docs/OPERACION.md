# Manual operativo

## Primera preparación — administrador

1. Iniciar sesión y revisar las tres sucursales en **Sucursales**. Agregar nuevas desde la aplicación cuando corresponda.
2. Crear usuarios en **Usuarios** y asignarles rol y sucursales. El administrador accede a todas; los demás solo a las asignadas.
3. Crear productos en **Productos**, con código único, categoría, unidad base, costo, presentaciones y mínimos por sucursal. La fotografía es opcional.
4. Registrar un movimiento **Inventario inicial** por producto y sucursal. Solo se admite antes de cualquier otro movimiento de esa combinación.
5. Crear o programar los conteos de operación.

## Movimientos — administrador y encargado

En **Inventario → Registrar movimiento**, seleccionar sucursal, tipo, producto, cantidad, presentación opcional y motivo. Entradas suman; salidas y mermas restan. El sistema rechaza saldos negativos y productos bloqueados por conteo.

Los movimientos contabilizados no se editan ni borran. El administrador puede revertir un movimiento manual desde el libro, con motivo. Transferencias y ajustes se corrigen mediante su flujo de origen para no romper su trazabilidad.

## Conteos — administrador, encargado y empleado

El administrador o encargado crea un borrador con sucursal, responsable y productos. Al iniciarlo se informa del bloqueo temporal de movimientos. Planear la captura para evitar interrumpir abastecimientos.

El empleado abre su conteo asignado, selecciona categoría, busca productos y registra cantidades. **Guardar y siguiente** confirma cada guardado. Cero es una captura válida; un campo vacío significa pendiente. Las unidades por pieza no admiten fracciones. Puede continuar después desde el mismo conteo mientras tenga conexión.

Cuando todos los productos estén guardados, **Revisar y enviar** solicita confirmación. Se liberan bloqueos y el conteo pasa a enviado. El envío no modifica el saldo oficial.

El encargado revisa o solicita recuento con motivo. El administrador aprueba o rechaza. La aprobación aplica diferencias al saldo actual conservando movimientos posteriores al envío. Un recuento conserva la captura anterior, fija nueva referencia y bloquea nuevamente mientras se captura.

Cancelar un conteo abierto conserva su historial y libera bloqueos. No dejar conteos iniciados innecesariamente.

## Transferencias

1. Crear borrador con origen, destino, productos y motivo. Los productos deben estar habilitados en ambas sucursales.
2. Solicitar envío y confirmar salida cuando los productos salgan físicamente. Solo ese paso descuenta origen.
3. El destino registra cantidades recibidas. Se permiten varias recepciones, sin superar pendientes.
4. Registrar devoluciones solo después de confirmar regreso físico al origen.
5. El administrador puede autorizar una pérdida de mercancía en tránsito con motivo.
6. Se cierra automáticamente cuando toda cantidad enviada está recibida, devuelta o conciliada como pérdida.

No cancelar una transferencia despachada. Conservar evidencia operativa de cualquier diferencia.

## Reportes y mantenimiento

Seleccionar sucursal global y filtros de fecha, categoría y producto en **Reportes**. Exportar los mismos resultados a Excel o PDF. Inventario y ABC reflejan el saldo actual; los reportes de operaciones usan fechas. Las mermas se expresan en cantidad y valor, sin vinculación a ventas.

**Auditoría** muestra acciones y cambios. Para retirar accesos, desactivar usuarios; sus registros se conservan. Para desactivar sucursales, resolver existencias y operaciones abiertas. Cambiar contraseña desde **Mi cuenta** revoca todas las sesiones.

La instalación PWA está disponible en navegadores compatibles con HTTPS. No usar la aplicación sin conexión para capturar: esperar a recuperar conexión y confirmar el guardado. El escáner requiere un navegador compatible y permiso de cámara; siempre se puede buscar manualmente.
