# Despliegue, respaldos y restauración

## Docker / Coolify

**Opción recomendada: [recursos independientes](DESPLIEGUE-INDEPENDIENTE.md)** con un Compose por servicio en `infra/deploy/`. Permite actualizar frontend o API por separado y aplica las migraciones como tarea manual. El Compose raíz descrito a continuación es una alternativa integrada; no usarlo como un solo recurso Coolify si se desea desplegar cada componente de forma independiente.

El proyecto incluye `docker-compose.yml`, imágenes de API y frontend, PostgreSQL y un perfil opcional de respaldo. No publicar el puerto de PostgreSQL ni el de la API; Nginx expone frontend y `/api` bajo el mismo origen. Coolify debe terminar TLS y dirigir el dominio al puerto 8080 del servicio web.

Configurar secretos mediante Coolify o un `.env` excluido de Git en la raíz:

```dotenv
POSTGRES_PASSWORD=una_clave_fuerte_sin_caracteres_reservados_de_URL
JWT_SECRET=secreto_aleatorio_de_al_menos_32_caracteres
APP_ORIGIN=https://inventarios.tu-dominio.com
ADMIN_EMAIL=correo_del_administrador
ADMIN_PASSWORD=clave_inicial_del_administrador
WEB_PORT=8080
```

`APP_ORIGIN` debe coincidir exactamente con el origen del navegador, sin barra final. Para claves de PostgreSQL con caracteres reservados, codificar apropiadamente la contraseña en la URL o adaptar DATABASE_URL en Compose. No reutilizar las claves locales del equipo en producción.

```sh
docker compose build
docker compose up -d
docker compose ps
```

`init` espera a PostgreSQL, aplica migraciones y ejecuta el seed; API espera a que termine correctamente. Volúmenes persistentes separados para base y fotografías. El usuario del contenedor API es `node`. Para producción con más de una instancia, mantener un único planificador activo; la idempotencia de programación protege contra duplicación, pero esta versión se opera con una sola API.

Antes de cada actualización: respaldo verificado, probar la versión y migraciones en staging, ejecutar migraciones controladamente y comprobar salud. No revertir una migración destructiva automáticamente ni ejecutar `migrate reset` en producción. Restaurar a una base nueva si una actualización requiere recuperar datos.

## Respaldos externos cifrados

El perfil `backup` crea cada 24 horas un respaldo PostgreSQL custom, fotografías comprimidas y un paquete cifrado con age. Sube el paquete a un remoto rclone externo y conserva 30 días. Mantener la clave privada age fuera del servidor.

Configurar `AGE_RECIPIENT`, `BACKUP_REMOTE` y `RCLONE_CONFIG_PATH` con credenciales del destino externo. El archivo rclone no debe entrar en Git. El remoto debe ser un prefijo dedicado a Fatboy, no la raíz de almacenamiento compartido.

```sh
docker compose --profile backup up -d backup
docker compose logs backup
```

El contenedor registra un timestamp solo tras subir el paquete; su healthcheck falla si el último éxito supera 26 horas. Configurar alertas en Coolify/monitor externo para salud, HTTP `/api/v1/health`, errores 5xx, disco sobre 80 % y atraso de respaldo. Los archivos por sí solos no configuran alertas externas ni almacenamiento remoto.

Objetivo inicial: RPO de 24 horas. Medir RTO con los datos reales antes de definir compromiso operativo.

## Restauración

1. Descargar el paquete desde el remoto a un entorno controlado.
2. Descifrar: `age -d -i /ruta/clave-privada -o bundle.tar fatboy-FECHA.tar.age`.
3. Extraer `database.dump` y `uploads.tar.gz` del paquete.
4. Crear una base **nueva y vacía** con el mismo mayor de PostgreSQL o uno compatible.
5. Restaurar con `pg_restore --exit-on-error --no-owner -d BASE_NUEVA database.dump`.
6. Restaurar fotografías en un volumen nuevo, asignando permisos al usuario de la API.
7. Arrancar la versión correspondiente del código contra esa base y verificar login, conteos, transferencias, reportes y `/api/v1/inventory/reconcile` como administrador.
8. Comparar conteos de registros y muestras antes de cambiar el servicio operativo. Conservar la base anterior hasta validar.

En desarrollo, `pnpm test:restore` verifica pg_dump/pg_restore, cifrado AES-GCM de ida y vuelta, conteos de siete tablas y conciliación completa en una base nueva. Esta prueba local no demuestra conectividad al almacenamiento externo de producción ni la restauración del volumen de fotos en Coolify.

## Cierre de producción

Se requiere infraestructura real, dominio, HTTPS, remoto cifrado y alertas, y una prueba operativa con personal de Fatboy. Estos pasos no pueden darse por concluidos solo con pruebas locales. Documentar servidor, responsable de recuperación, ubicación segura de claves y resultado del ensayo de restauración.
