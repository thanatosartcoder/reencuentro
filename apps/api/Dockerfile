# syntax=docker/dockerfile:1

# Railway y cualquier plataforma que construya con Docker usan este archivo.
# Se compila en dos etapas para que la imagen final no cargue con el compilador
# de TypeScript ni con las dependencias de desarrollo.

FROM node:22-slim AS build
WORKDIR /app

# Las dependencias se instalan antes de copiar el código: mientras el
# package-lock no cambie, esta capa se reutiliza y el despliegue es mucho más
# rápido.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# sharp trae binarios nativos de libvips; se reinstalan en la imagen final para
# que correspondan a esta arquitectura y no a la de la etapa de compilación.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# tini: Node no es PID 1 apto — sin un init que reape procesos, los reinicios
# dejan zombis y las señales de parada no llegan limpias.
#
# postgresql-client-16: lo usa la copia de seguridad nocturna. Va del repositorio
# de PostgreSQL y no del de Debian porque este trae la 15, y pg_dump se niega a
# volcar un servidor más nuevo que él. La base corre PostGIS 16.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios. La imagen de node ya trae uno.
USER node

EXPOSE 4000
# El script encadena migración y arranque dentro de un shell explícito, para
# que no dependa de cómo la plataforma invoque el contenedor.
ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
