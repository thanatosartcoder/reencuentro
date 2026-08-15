#!/bin/bash
set -e

# Configura el repositorio en GitHub con la protección de rama.
#
# Deja `main` cerrada: nadie —incluido el mantenedor— puede empujar directo.
# Todo entra por pull request, con revisión y con la CI en verde.
#
# Bloquear también al dueño es deliberado. La protección que se puede saltar
# "solo esta vez porque es urgente" no protege de nada, y este proyecto toca
# datos de personas desaparecidas: las prisas son justo cuando más falta hace.
#
# Las aprobaciones exigidas van en CERO a propósito: GitHub no permite aprobar
# el propio PR, así que con un mantenedor único exigir una aprobación deja la
# rama en punto muerto. La protección real sigue en pie —no se puede empujar a
# main, la CI tiene que pasar— y quien contribuye desde fuera no puede fusionar
# nada porque no tiene permiso de escritura. Cuando el proyecto tenga un segundo
# mantenedor, sube este número a 1 y activa require_code_owner_reviews.
#
# Uso:  ./scripts/setup-github.sh <usuario>/<repo> [--publico]

REPO="${1:?Falta el repositorio. Ejemplo: ./scripts/setup-github.sh usuario/reencuentro}"
VISIBILIDAD="private"
[ "${2:-}" = "--publico" ] && VISIBILIDAD="public"

command -v gh >/dev/null || { echo "Falta el CLI de GitHub: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sin sesión. Ejecuta: gh auth login"; exit 1; }

echo "→ Repositorio $REPO ($VISIBILIDAD)"
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "  ya existe, se reutiliza"
else
  gh repo create "$REPO" --"$VISIBILIDAD" --source=. --remote=origin --push
fi

git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
git push -u origin main

echo "→ Protegiendo main"
# `enforce_admins` incluye al dueño. Ver el comentario de arriba.
gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "API · tipos y pruebas",
      "Web · tipos y compilación",
      "Imagen de producción"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "require_code_owner_reviews": false,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

echo "→ Ajustes del repositorio"
gh repo edit "$REPO" \
  --enable-issues \
  --enable-wiki=false \
  --enable-projects=false \
  --delete-branch-on-merge \
  --allow-update-branch \
  --enable-squash-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false

echo
echo "Listo."
echo
echo "  main queda cerrada: ni tú puedes empujar directo."
echo "  Para trabajar:  git switch -c arregla/lo-que-sea"
echo
echo "  Falta hacer a mano en la web de GitHub:"
echo "    · Settings → Code security → activar los avisos privados de seguridad"
echo "    · Añadir una licencia si aún no la tiene"
