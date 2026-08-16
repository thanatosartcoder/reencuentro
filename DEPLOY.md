# Despliegue

Web en **Vercel**, API en **Railway**, fotos en **Cloudflare R2**.

Todo lo que hay aquí está probado salvo donde se diga lo contrario: la imagen de Docker se construyó y arrancó contra PostGIS respondiendo `/api/health`. Lo que no se puede probar sin credenciales es el bucket real.

---

## 1 · Cloudflare R2

**Por qué R2 y no S3:** egreso a **$0**. Esto es un listado público de fotos; si un medio lo enlaza, el tráfico se multiplica sin aviso. Con S3 eso es una factura sorpresa.

1. Panel de Cloudflare → **R2** → *Create bucket* → `reencuentro-fotos`, ubicación **WNAM** o **ENAM** (las más cercanas a Colombia).
2. **R2** → *Manage API Tokens* → *Create API Token*
   - Permiso: **Object Read & Write**
   - Alcance: solo ese bucket
3. Guarda `Access Key ID`, `Secret Access Key` y el **endpoint**, con la forma:
   ```
   https://<ID_DE_CUENTA>.r2.cloudflarestorage.com
   ```

**Antes de pagar:** aplica a [**Project Galileo**](https://www.cloudflare.com/galileo/). Da servicios de nivel Business sin costo a organizaciones humanitarias; hoy protege 3.400+ dominios en 120 países. Una plataforma de búsqueda de desaparecidos tras un desastre encaja de lleno.

---

## 2 · Railway (API)

```bash
npm i -g @railway/cli
railway login          # abre el navegador
railway init
railway add            # elegir PostgreSQL
```

**PostGIS:** el Postgres de Railway no lo trae activo. Una vez creada la base:

```bash
railway connect postgres
```
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

> Si el plugin de Railway no permite crear extensiones, usa la imagen `imresamu/postgis:16-3.5-alpine` como servicio Docker, o una base gestionada con PostGIS (Neon y Supabase lo traen). **Sin PostGIS nada del mapa funciona.**

Variables de entorno:

```bash
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_USER=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
DB_NAME=${{Postgres.PGDATABASE}}

NODE_ENV=production
PORT=4000
CORS_ORIGINS=https://tu-app.vercel.app

# Railway pone un balanceador delante. Sin esto, el límite de peticiones deja de
# ser por cliente —pasa a ser un único cupo que un solo atacante agota, dejando
# 429 a quien intenta reportar— y la bitácora registra la IP del balanceador en
# lugar de la de quien consultó datos personales.
TRUST_PROXY_HOPS=1

# Genera cada uno con: openssl rand -hex 32
FIELD_ENCRYPTION_KEY=<64 caracteres hex>
# La API no arranca si este falta, repite el valor de ejemplo o mide menos de 32
# caracteres. Con el secreto del repositorio, cualquiera firma un token de
# administrador y entra al panel de validación.
JWT_SECRET=<aleatorio largo>

STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<ID_DE_CUENTA>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=reencuentro-fotos
S3_ACCESS_KEY_ID=<del token de R2>
S3_SECRET_ACCESS_KEY=<del token de R2>

INGEST_CRON_ENABLED=true

# Sin esto los cron corren en UTC: la ingesta vial, que bloquea su tabla unos
# 36 segundos, caería a las 23:20 hora colombiana en vez de a las 04:20.
TZ=America/Bogota
```

```bash
railway up      # desde apps/api
```

`railway.json` ya define el build por Dockerfile, el healthcheck en `/api/health` y que las migraciones corran al arrancar.

> ⚠️ **`FIELD_ENCRYPTION_KEY` no se puede perder ni rotar.** Sin ella, documento, teléfono y correo cifrados son irrecuperables. Guárdala fuera de Railway también.

---

## 3 · Vercel (web)

```bash
npm i -g vercel
cd apps/web
vercel login
vercel link
```

Una variable:

```bash
NEXT_PUBLIC_API_ORIGIN=https://tu-api.up.railway.app
```

`next.config.ts` reexpone la API bajo `/api` del mismo origen, así que **no hay preflight CORS** en cada petición — se nota en 2G.

```bash
vercel --prod
```

Después: vuelve a Railway y pon `CORS_ORIGINS` con el dominio real de Vercel. El WebSocket sí cruza origen y lo necesita.

---

## 4 · Comprobar

```bash
curl https://tu-api.up.railway.app/api/health
# postgis: "3.5 ..." ← si falta, el mapa no funciona

curl https://tu-api.up.railway.app/api/situacion | head -c 300
```

En los logs de Railway debe aparecer:

```
[StorageService] Almacenamiento de fotos: s3(<cuenta>.r2.cloudflarestorage.com)
```

Si dice `local`, las variables de R2 no llegaron y **las fotos se están escribiendo en el contenedor**, donde se pierden en cada despliegue.

Siembra y carga inicial:

```bash
railway run npm run seed          # operadores + geografía del sismo
railway run npm run ingest:hdx    # 575 edificaciones con daño
railway run npm run ingest:vias   # 161.322 tramos viales (~160 MB, tarda)
```

---

## Copias de seguridad

Railway ofrece recuperación a un punto en el tiempo, pero solo sobre su imagen
oficial de Postgres; esta base corre PostGIS de la comunidad, así que no está
disponible. Sin lo de aquí abajo no habría copia ninguna.

Corre sola cada noche a las 02:40 y se guardan las últimas catorce. Se excluyen
los datos de las capas externas —vías, daño, sismos— porque sus cron las vuelven
a traer idénticas y son con diferencia lo más pesado; el esquema sí viaja entero.

Se puede lanzar una a mano desde el panel: **Copias de seguridad → Hacer una
copia ahora**. Útil antes de una migración delicada, porque tener la copia de
anoche no consuela si el cambio se aplicó esta mañana.

### Cifrado: la clave privada no vive aquí

`BACKUP_PUBLIC_KEY` lleva **solo la clave pública**. El servidor escribe copias
que no puede volver a leer, así que comprometerlo no entrega también el
historial de lo que las familias contaron.

El par se genera en la máquina de quien despliega, nunca en el servidor —si lo
generara el servidor, la privada existiría ahí aunque fuera un momento:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out privada.pem
openssl rsa -in privada.pem -pubout -out publica.pem
```

El contenido de `publica.pem` va a Railway. `privada.pem` va donde guardas lo que
no puedes perder, **con una segunda copia en otro sitio**, fuera de la carpeta
del proyecto. Sin ella las copias son bytes inservibles: eso es el punto y
también el riesgo.

Cómo saber si está funcionando, sin descargar nada: el nombre del archivo. Si
termina en `.sql.gz.enc` se cifró; si termina en `.sql.gz` la clave no se leyó, y
el registro lleva un `WARN` diciéndolo.

### Restaurar

Esto es la mitad que se usa el peor día. **Pruébala antes de necesitarla**, y
antes de borrar la privada de tu máquina.

```bash
npm --prefix apps/api run backup:restore -- \
  backups/reencuentro-AAAA-MM-DD-HHMM.sql.gz.enc \
  /ruta/a/privada.pem \
  --remoto
```

`--remoto` la descarga del bucket usando las variables `S3_*`; sin esa opción,
lee un archivo que ya tengas en disco. Si responde con el número de tablas, el
circuito está cerrado. Si falla, el error distingue entre clave equivocada,
archivo truncado y archivo alterado.

Después, lo de siempre:

```bash
psql "$DATABASE_URL" < reencuentro-AAAA-MM-DD-HHMM.sql
```

Borra el `.sql` cuando termines: ese sí va en claro.

> Si lo haces a menudo, un guion personal con las credenciales dentro evita
> repetir variables. El `.gitignore` cubre `*.local.sh` para eso. No pegues su
> contenido en ningún sitio: las credenciales del bucket son credenciales.

---

## Notas que ahorran un susto

**El disco de Railway es efímero.** Por eso `STORAGE_PROVIDER=s3` no es opcional en producción: con `local`, cada despliegue borra las fotos.

**Una sola instancia por ahora.** El gateway de WebSocket no tiene adapter de Redis, así que con varias réplicas los avisos en vivo llegarían solo a quien esté conectado al mismo nodo. El `docker-compose` ya trae Redis para cuando toque.

**La ingesta vial pide memoria.** Procesa 134 MB por streaming, pero la transacción de 161.322 tramos necesita holgura. Con menos de 1 GB, deja `INGEST_CRON_ENABLED=false` y córrela a mano.

**Rotar la contraseña de Postgres son cuatro pasos, no dos.** `POSTGRES_PASSWORD`
solo se lee al crear la base, así que cambiar la variable no cambia nada dentro
de Postgres. Y aunque las variables de la API sean referencias
(`${{PostGIS.POSTGRES_PASSWORD}}`), Railway **no reinicia el servicio** al
cambiar la fuente: el proceso sigue con el valor viejo en memoria y responde 500
hasta que se le fuerza el reinicio.

```bash
NEW=$(openssl rand -hex 24)
OLD=$(railway variables --service PostGIS --kv | grep '^DATABASE_URL=' | cut -d= -f2-)
psql "$OLD" -c "ALTER USER postgres PASSWORD '$NEW';"   # 1. la base
railway variables --service PostGIS --set "POSTGRES_PASSWORD=$NEW"  # 2. la variable
railway redeploy --yes                                   # 3. reiniciar la API
curl https://tu-api.up.railway.app/api/health            # 4. comprobar
```

**Migraciones al arrancar.** `railway.json` las ejecuta antes de levantar la API. Con varias réplicas eso sería una carrera; con una, es lo correcto.

---

## Alternativas si Railway no encaja

| Plataforma | Nota |
|---|---|
| **Fly.io** | Más cerca de Colombia (`gru`, São Paulo). Postgres con PostGIS por imagen propia. |
| **Render** | Postgres gestionado; PostGIS hay que verificarlo. |
| **Neon / Supabase** | Solo base, con PostGIS incluido. Se combinan con Railway o Fly para la API. |

El frontend funciona igual en Vercel, Cloudflare Pages o Netlify: es Next.js estándar sin dependencias de plataforma.
