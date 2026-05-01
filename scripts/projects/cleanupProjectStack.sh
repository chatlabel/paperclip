#!/usr/bin/env bash
# cleanupProjectStack.sh — derruba a stack de uma task (idempotente).
#
# Uso:
#   cleanupProjectStack.sh <slug> <task-id> [repo-path]
#
# Comportamento:
#   - Tenta `docker compose -p <slug>-<task-id> down -v --remove-orphans`.
#   - Se repo-path não foi passado ou é inválido, recorre ao plano B:
#     remove containers / networks / volumes filtrando por
#     label `com.docker.compose.project=<slug>-<task-id>`.
#   - Retorna 0 mesmo se já estava limpo (nada pra remover).
#
# Exit codes:
#   0  ok
#   2  argumentos inválidos

set -euo pipefail

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <slug> <task-id> [repo-path]

  slug       identificador estável do projeto
  task-id    identificador da task
  repo-path  (opcional) caminho do repo. Se ausente, fallback por label.

env opcional:
  COMPOSE_FILE  nome do compose-file (default: docker-compose.dev.yml)
EOF
  exit 2
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
slug="$1"
task_id="$2"
repo_path="${3:-}"
project_name="${slug}-${task_id}"
compose_file="${COMPOSE_FILE:-docker-compose.dev.yml}"

echo "[cleanupProjectStack] project=${project_name}"

# Caminho preferencial: docker compose down (descobre tudo via project name)
if [ -n "$repo_path" ] && [ -f "$repo_path/$compose_file" ]; then
  cd "$repo_path"
  docker compose -p "$project_name" -f "$compose_file" down -v --remove-orphans || {
    echo "[cleanupProjectStack] compose down retornou erro; vou pro fallback" >&2
  }
fi

# Fallback / sweep — pega tudo com a label do project, mesmo se compose-file sumiu.
filter="label=com.docker.compose.project=${project_name}"

containers=$(docker ps -a --filter "$filter" -q || true)
if [ -n "$containers" ]; then
  echo "[cleanupProjectStack] removendo containers leftover: $(echo "$containers" | wc -l)"
  docker rm -f $containers >/dev/null 2>&1 || true
fi

networks=$(docker network ls --filter "$filter" -q || true)
if [ -n "$networks" ]; then
  echo "[cleanupProjectStack] removendo networks leftover: $(echo "$networks" | wc -l)"
  docker network rm $networks >/dev/null 2>&1 || true
fi

volumes=$(docker volume ls --filter "$filter" -q || true)
if [ -n "$volumes" ]; then
  echo "[cleanupProjectStack] removendo volumes leftover: $(echo "$volumes" | wc -l)"
  docker volume rm $volumes >/dev/null 2>&1 || true
fi

echo "[cleanupProjectStack] OK"
