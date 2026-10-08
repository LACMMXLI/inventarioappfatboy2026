# Despliegue independiente en Docker y Coolify

Cada recurso tiene su propio proyecto Compose. Actualizar el frontend no ejecuta comandos de base de datos, API, migraciones ni respaldo. Las fotografías y PostgreSQL se guardan en volúmenes externos con nombre fijo: no pertenecen al ciclo de vida de los contenedores.

| Recurso                   | Archivo                             | Puerto interno            | Persistencia                                  |
| ------------------------- | ----------------------------------- | ------------------------- | --------------------------------------------- |
| PostgreSQL                | `infra/deploy/database.compose.yml` | 5432 privado              | `fatboy-postgres`                             |
| API                       | `infra/deploy/api.compose.yml`      | 3000 privado              | `fatboy-uploads`                              |
| Frontend / Nginx          | `infra/deploy/frontend.compose.yml` | 8080, destino del dominio | Sin datos de negocio                          |
| Migraciones, tarea manual | `infra/deploy/migrate.compose.yml`  | Ninguno                   | Usa la base existente                         |
| Respaldos externos        | `infra/deploy/backup.compose.yml`   | Ninguno                   | `fatboy-backup-status`, fotos de solo lectura |

Los recursos se comunican mediante la red externa dedicada `fatboy-production`. Solo el frontend recibe tráfico público; `/api` se reenvía a `fatboy-api:3000` en el mismo origen. Nginx vuelve a resolver DNS cada diez segundos para reconocer una API reemplazada. Un fallo de API no impide arrancar ni consultar la salud del frontend (`/healthz`).

## Preparación inicial en el servidor

Requisitos: Linux con Docker Engine y Docker Compose v2 con soporte para `up --wait`. Ejecutar desde la raíz del repositorio. Los scripts no requieren Node instalado en el host.

```sh
git clone https://github.com/LACMMXLI/inventarioappfatboy2026.git
cd inventarioappfatboy2026
cp infra/deploy/.env.example .env.deploy
chmod 600 .env.deploy
# Editar .env.deploy: claves nuevas, dominio y nombres definitivos de los volúmenes.
sh scripts/deploy.sh prepare
sh scripts/deploy.sh database
sh scripts/deploy.sh build-api
sh scripts/deploy.sh seed
sh scripts/deploy.sh api
sh scripts/deploy.sh frontend
```

`seed` ejecuta migraciones y crea roles, las tres sucursales y el administrador inicial; no crea productos ni saldos de ejemplo. Conservar `ADMIN_PASSWORD` únicamente donde se ejecuta el seed. El contenedor de API no recibe esa contraseña. `DATABASE_URL` utiliza `fatboy-db` como host; codificar la contraseña en la URL si contiene caracteres reservados.

Los nombres `DEPLOY_NETWORK`, `POSTGRES_VOLUME`, `UPLOADS_VOLUME` y `BACKUP_STATUS_VOLUME` en `.env.deploy` deben escribirse sin comillas, espacios ni interpolaciones para el script `prepare`. Para staging usar otros nombres y otro `STACK_PREFIX`. No conectar producción y staging a una misma red con los mismos alias.

## Configurar Coolify como recursos separados

1. Preparar red y volúmenes en el servidor con el paso anterior. La red externa es intencional: conecta proyectos Compose independientes. No es necesario publicar PostgreSQL ni la API.
2. Crear **tres recursos diferentes** desde este repositorio, rama `main`, build pack Docker Compose, directorio base `/`. En cada uno indicar su ubicación de Compose: `/infra/deploy/database.compose.yml`, `/infra/deploy/api.compose.yml` o `/infra/deploy/frontend.compose.yml`. Mantener el contexto de construcción `../..`, relativo al archivo Compose, para incluir el monorepo.
3. Configurar las variables por recurso usando la tabla siguiente. No subir `.env.deploy` a Git. Comprobar en el Compose renderizado que se conservan la red externa, alias y nombres de volumen.
4. Desplegar primero base de datos. Construir la imagen API y ejecutar la tarea de migración/seed desde el checkout del servidor con la misma configuración. Luego desplegar API y frontend. Para migraciones también se puede usar la terminal de una API existente: `pnpm db:migrate`; el primer seed requiere pasar sus dos variables de administrador a esa tarea, no al frontend.
5. Asignar al servicio `frontend` el dominio `https://inventarios.tu-dominio.com:8080`. El puerto indica el destino interno del proxy; el usuario accede por HTTPS normal. Configurar `APP_ORIGIN=https://inventarios.tu-dominio.com` en la API, sin puerto 8080 ni barra final.
6. Mantener **despliegue automático desactivado para la base de datos**. Inicialmente usar despliegue manual también en API/frontend. Para cambiar solo interfaz, desplegar únicamente el recurso frontend. No crear un único recurso con el Compose raíz si se busca esta separación.
7. Crear un cuarto recurso para `backup.compose.yml` cuando estén configurados age y rclone. El archivo rclone debe existir en el host en una ruta absoluta. Ver [respaldos y restauración](PRODUCCION.md).

| Recurso          | Variables                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Base de datos    | `POSTGRES_PASSWORD`, `DEPLOY_NETWORK`, `POSTGRES_VOLUME`, `STACK_PREFIX`                                                           |
| API              | `DATABASE_URL`, `JWT_SECRET`, `APP_ORIGIN`, `DEPLOY_NETWORK`, `UPLOADS_VOLUME`, `STACK_PREFIX`, opcional `API_IMAGE`/`API_VERSION` |
| Frontend         | `API_UPSTREAM=http://fatboy-api:3000`, `DEPLOY_NETWORK`, `STACK_PREFIX`, opcional `WEB_IMAGE`/`WEB_VERSION`                        |
| Migración / seed | `DATABASE_URL`, `DEPLOY_NETWORK`, imagen y versión API; `ADMIN_EMAIL`/`ADMIN_PASSWORD` solo para seed                              |
| Respaldo         | `POSTGRES_PASSWORD`, `AGE_RECIPIENT`, `BACKUP_REMOTE`, `RCLONE_CONFIG_PATH`, red y nombres de volúmenes                            |

Al usar construcción local, la imagen de migración debe existir en el host con el mismo `API_IMAGE:API_VERSION`. `sh scripts/deploy.sh build-api` la genera. No usar una versión distinta de la API que se desplegará después.

Referencias: [Docker Compose en Coolify](https://coolify.io/docs/applications/builds/docker-compose), [redes externas entre proyectos Compose](https://docs.docker.com/compose/how-tos/networking/).

## Actualizar solo frontend

En Coolify: elegir el recurso **frontend**, seleccionar el commit y pulsar Deploy. Base de datos y API tienen otro recurso y no se despliegan por esa acción.

Por terminal, después de revisar y traer el commit deseado:

```sh
git pull --ff-only
sh scripts/deploy.sh frontend
```

El script construye la interfaz y ejecuta `up -d --no-build --no-deps` únicamente en su proyecto. No ejecuta `down`, ni reinicia otros servicios. La actualización puede producir una interrupción breve de la interfaz; no promete cero downtime. Evitar eliminar inmediatamente las imágenes y assets de la versión anterior si hay sesiones abiertas; una pestaña antigua puede necesitar recarga para cargar módulos de la nueva versión.

## Actualizar API y esquema

1. Probar la versión y migraciones en staging y verificar un respaldo recuperable.
2. Traer el commit y construir API: `sh scripts/deploy.sh build-api`.
3. Si hay cambios de esquema, ejecutar **explícitamente** `sh scripts/deploy.sh migrate`. Si falla, no avanzar.
4. Desplegar API: `sh scripts/deploy.sh api`, o desplegar solo su recurso Coolify.
5. Verificar `/api/v1/health` y una operación autenticada desde el dominio público.

Mantener migraciones compatibles con la API que sigue en ejecución: agregar campos primero, migrar datos y retirar campos en una entrega posterior. Cambios destructivos requieren ventana de mantenimiento. No automatizar migraciones al iniciar cada contenedor. Un redeploy de API no debe ejecutar seed.

## Servidor sin Coolify

Publicar solo el frontend con el override; por defecto escucha únicamente en loopback para un proxy TLS del host:

```sh
docker compose --env-file .env.deploy -f infra/deploy/frontend.compose.yml -f infra/deploy/frontend.port.compose.yml up -d --build --no-deps --wait
```

Usar esa misma combinación de archivos en posteriores actualizaciones para conservar el mapeo del puerto. No usar `deploy.sh frontend` para reemplazar un despliegue que depende de este override. Configurar TLS en el proxy y `APP_ORIGIN` con la URL pública real. Las cookies de producción requieren HTTPS.

## Conservación y rollback

- No ejecutar `docker volume rm`, `docker system prune --volumes` ni cambiar los nombres de volúmenes en una actualización ordinaria. Los volúmenes externos están fuera de Compose, pero todavía pueden eliminarse manualmente.
- No actualizar PostgreSQL al actualizar la interfaz. Mantener la versión fijada y planear su mantenimiento por separado.
- Para regresar solo frontend, desplegar el commit anterior en ese recurso. Para regresar API, comprobar compatibilidad con el esquema actual; no deshacer migraciones automáticamente.
- Si ya hay datos en el Compose raíz, sus volúmenes se llaman normalmente `fatboy-inventarios_postgres_data` y `fatboy-inventarios_uploads`. Inspeccionar los nombres reales y respaldar antes de migrar. Configurar los nombres existentes en `.env.deploy` o restaurar en volúmenes nuevos. **No arrancar dos PostgreSQL sobre el mismo volumen**: detener el antiguo durante una migración planificada.

## Verificación automatizada

El workflow `deployment.yml` construye las imágenes en un runner Linux, prepara una base aislada, inicia cada proyecto, prueba el proxy y compara ID y fecha de inicio de los contenedores de base y API tras reemplazar el frontend. También reemplaza la API y comprueba que Nginx la encuentra sin reiniciar el frontend. Esta prueba no despliega en producción ni configura dominio, TLS o almacenamiento externo.
