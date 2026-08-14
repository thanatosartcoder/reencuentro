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

# Node no es PID 1 apto: sin un init que reape procesos, los reinicios dejan
# zombis y las señales de parada no llegan limpias.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios. La imagen de node ya trae uno.
USER node

EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
