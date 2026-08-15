#!/bin/sh
set -e

# Arranque del contenedor: migrar y luego servir.
#
# Va en un script y no en el `startCommand` de la plataforma porque encadenar
# `migración && node` desde fuera depende de que quien invoque el contenedor lo
# pase por un shell. Si no lo hace, el `&&` deja de ser un operador, se
# convierte en un argumento suelto, la migración corre, el proceso termina y la
# aplicación nunca arranca — dejando un contenedor que "no da error" pero jamás
# responde al healthcheck.
#
# Aquí el shell es explícito y el comportamiento es el mismo en Railway, en
# Docker local o en cualquier otro sitio.

echo "→ Ejecutando migraciones pendientes…"
npm run migration:run:prod

echo "→ Iniciando la API…"
# `exec` reemplaza al shell en lugar de dejarlo como padre: node pasa a ser hijo
# directo de tini y recibe las señales de parada, que es lo que permite que un
# redespliegue cierre las conexiones ordenadamente en vez de matarlas.
exec node dist/main.js
