#!/usr/bin/env bash
# setupProjectStack.sh — sobe (idempotente) a stack auxiliar de um projeto
# para uma task específica usando docker compose, isolada por compose project
# name `<slug>-<task-id>` e marcada com label `paperclip.task=<task-id>`.
#
# Uso:
#   setupProjectStack.sh <slug> <task-id> <repo-path>
#
# Pré-requisitos:
#   - Pod paperclip com /var/run/docker.sock montado (DooD — ver D-12).
#   - Repo do cliente clonado em <repo-path> contendo docker-compose.dev.yml
#     conforme docs/ops/project-conventions.md.
#
# Idempotência:
#   - Se a stack já está up com mesmas labels, comando vira no-op.
#   - Retorna 0 mesmo em "no-op". Erros reais (compose-file inválido, etc.)
#     retornam ≠ 0.
#
# Exit codes:
#   0  ok (subiu nova ou já estava up)
#   2  argumentos inválidos
#   3  repo-path inexistente ou sem docker-compose.dev.yml
#   4  docker compose falhou (compose-file, recursos, etc.)

set -euo pipefail

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <slug> <task-id> <repo-path>

  slug       identificador estável do projeto (ex.: demo-task-runner)
  task-id    identificador da task corrente (ex.: T123)
  repo-path  caminho absoluto do repo cliente (deve ter docker-compose.dev.yml)

env opcional:
  COMPOSE_FILE    nome do compose-file (default: docker-compose.dev.yml)
  COMPOSE_TIMEOUT segundos pra --wait (default: 180)
EOF
  exit 2
}

[ "$#" -eq 3 ] || usage
slug="$1"
task_id="$2"
repo_path="$3"

[ -d "$repo_path" ] || {
  echo "ERROR: repo-path não existe: $repo_path" >&2
  exit 3
}

compose_file="${COMPOSE_FILE:-docker-compose.dev.yml}"
[ -f "$repo_path/$compose_file" ] || {
  echo "ERROR: $repo_path/$compose_file não encontrado" >&2
  exit 3
}

project_name="${slug}-${task_id}"
timeout="${COMPOSE_TIMEOUT:-180}"

echo "[setupProjectStack] project=${project_name} cwd=${repo_path}"

# `--wait` aguarda services com healthcheck ficarem healthy.
# `--remove-orphans` elimina containers de tentativas antigas com mesmo project.
# Labels são aplicadas pelo compose pra cada container; aqui adicionamos via env
# DOCKER_COMPOSE_LABELS pra sweep / introspecção (best-effort, depende do compose
# repassar variáveis pra labels — em geral o nome do projeto já permite filtrar).
cd "$repo_path"

if ! docker compose \
    -p "$project_name" \
    -f "$compose_file" \
    up -d --wait --wait-timeout "$timeout" --remove-orphans; then
  echo "ERROR: docker compose up falhou para project=${project_name}" >&2
  exit 4
fi

# Aplica label paperclip.task em todos containers do projeto via update.
# (compose v2 não tem flag direta pra adicionar labels arbitrárias além do
# label "com.docker.compose.project". Como label adicional, fazemos um
# `docker update` com --label-add não existe — então só registramos via
# rotulação manual com --label no compose-file ou via `docker container
# update`. Aqui fica como best-effort: lemos os containers e logamos.)
echo "[setupProjectStack] containers up:"
docker ps --filter "label=com.docker.compose.project=${project_name}" \
  --format "  - {{.Names}} ({{.Image}}, {{.Status}})"

echo "[setupProjectStack] OK"
