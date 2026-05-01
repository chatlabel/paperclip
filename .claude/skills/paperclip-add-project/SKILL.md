---
name: paperclip-add-project
description: Adicionar projeto novo ao Paperclip (modo K3s prod com DooD ou standalone Docker Desktop) com stack auxiliar via docker compose. Use ao registrar Project Workspace, configurar setupCommand/cleanupCommand, ou debugar permissões do socket Docker no pod.
---

# Paperclip — adicionar projeto novo com stack auxiliar

Esta skill cobre **dois modos** de operação:

| Modo | Quando usar | Estado |
|---|---|---|
| **K3s prod (DooD)** | Caminho oficial. Agente roda no pod paperclip do cluster, stacks sobem no Docker engine do nó dedicado. | Implementado em PRs #9 e #10 |
| **Standalone (Docker Desktop)** | Quando operador iterando localmente. Stacks sobem no Docker do laptop. | Mantido como referência (apêndice) |

A diferença prática: **onde está o Docker daemon**. Convenções do `docker-compose.dev.yml` do repo cliente são as mesmas (`docs/ops/project-conventions.md`).

---

## Modo K3s prod (DooD) — caminho oficial

Pré-requisitos (já cumpridos):
- `k3s-paperclip-01` com Docker CE instalado (D-12).
- Pod `paperclip-app` com `/var/run/docker.sock` montado + `docker` CLI + plugin compose mountados de `/usr/bin/docker` e `/usr/libexec/docker/cli-plugins/` (PRs #9 e #10).
- User `node` no grupo `docker` (GID 988) via wrapper de entrypoint.
- Helpers em `scripts/projects/` (este repo).

### Arquitetura (modo K3s prod)

```
K3s cluster
└─ k3s-paperclip-01 (taint: paperclip-only)
   ├─ Docker engine 29.x (instalado no nó)
   │  └─ /var/run/docker.sock
   │     ↑ hostPath mount
   ├─ pod paperclip-app
   │  ├─ /paperclip (PVC paperclip-home, RWO 30Gi)
   │  │  └─ projects/<slug>/
   │  │     ├─ main/                  ← clone canônico
   │  │     └─ worktrees/<task-id>/   ← git worktree por task
   │  ├─ /usr/local/bin/docker        ← mount do host
   │  └─ /usr/local/libexec/docker/cli-plugins/  ← mount do host
   ├─ pod paperclip-postgres
   └─ containers de stacks por task   ← criados via DooD pelo agente
      ├─ <slug>-<task-id>-postgres
      ├─ <slug>-<task-id>-redis
      └─ ...
```

**Decisão chave:** containers das stacks dos projetos rodam **no daemon do nó**, fora do K8s. O kubectl/argocd não enxerga eles. Sweep de stacks órfãs é responsabilidade do operador (cron previsto na Fase 05).

### Passos para adicionar um projeto novo

#### 1. Garantir que o repo cliente cumpre a convenção

Validar `docker-compose.dev.yml` segundo `docs/ops/project-conventions.md`:
- sem `internal: true`
- `mem_limit:` por service
- `container_name: <slug>-<svc>` (sem colisão entre projetos)
- ports em `127.0.0.1:` (nunca `0.0.0.0:`)
- named volumes (não bind-mount em `/paperclip`)
- healthchecks em services dependedos por outros

Se faltar algo, abrir issue/PR no repo cliente antes de cadastrar no Paperclip.

#### 2. Criar workspace dentro do pod paperclip

```sh
POD=$(kubectl -n paperclip get pod -l app=paperclip -o jsonpath='{.items[0].metadata.name}')
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node sh -c '
  mkdir -p /paperclip/projects/<slug>/main &&
  cd /paperclip/projects/<slug>/main &&
  git clone <repoUrl> .
'
```

Estrutura padrão:
```
/paperclip/projects/<slug>/
├── main/                      ← clone canônico (origin)
└── worktrees/                 ← criado on-demand pelo agente, um worktree por task
```

#### 3. Registrar o Project Workspace via API do Paperclip

`POST /api/companies/<companyId>/projects` com body:

```json
{
  "name": "<slug>",
  "description": "...",
  "status": "in_progress",
  "workspace": {
    "name": "main",
    "cwd": "/paperclip/projects/<slug>/main",
    "setupCommand": "/app/scripts/projects/setupProjectStack.sh <slug> ${PAPERCLIP_TASK_ID} /paperclip/projects/<slug>/worktrees/${PAPERCLIP_TASK_ID}",
    "cleanupCommand": "/app/scripts/projects/cleanupProjectStack.sh <slug> ${PAPERCLIP_TASK_ID} /paperclip/projects/<slug>/worktrees/${PAPERCLIP_TASK_ID}",
    "isPrimary": true
  }
}
```

(Os helpers ficam disponíveis em `/app/scripts/projects/` dentro do pod via build/COPY do repo `chatlabel/paperclip`. Se o repo não está copiado pra dentro da imagem, monte via volume ou ajuste o caminho.)

#### 4. Atribuir issue/task ao agente

O heartbeat de `assignment` injeta automaticamente o `cwd`, `setupCommand` e `cleanupCommand` no contexto do agente. O agente é orientado (via prompt template) a:

1. Criar worktree pra task: `git -C /paperclip/projects/<slug>/main worktree add /paperclip/projects/<slug>/worktrees/<task-id> <branch>`
2. Rodar o `setupCommand` (sobe stack)
3. Trabalhar (Coder edita / Tester roda Playwright/Vitest contra a stack)
4. Rodar o `cleanupCommand` (derruba stack, limpa volumes)
5. Remover o worktree: `git -C /paperclip/projects/<slug>/main worktree remove ../<task-id>`

#### 5. Validação manual (smoke test)

```sh
POD=$(kubectl -n paperclip get pod -l app=paperclip -o jsonpath='{.items[0].metadata.name}')

# 1. Docker engine acessível como node:
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node docker version | head -3

# 2. Stack de uma task de teste
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node \
  /app/scripts/projects/setupProjectStack.sh demo T0 /paperclip/projects/demo/worktrees/T0

# 3. Containers visíveis
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node \
  docker ps --filter label=com.docker.compose.project=demo-T0

# 4. Cleanup
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node \
  /app/scripts/projects/cleanupProjectStack.sh demo T0 /paperclip/projects/demo/worktrees/T0

# 5. Confirmar zero resíduo
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node \
  docker ps -a --filter label=com.docker.compose.project=demo-T0
```

### Pegadinhas comuns (modo K3s)

| Sintoma | Causa real | Fix |
|---|---|---|
| `docker: executable not found` dentro do pod | Mount de `/usr/local/bin/docker` não chegou (PR #10 não synced) | Argo sync. Conferir manifest. |
| `Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?` | Daemon do nó parou OU socket não montou | `ssh root@46.225.170.4 'systemctl status docker'`. Conferir hostPath no manifest. |
| `permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock` | User `node` não está no group `docker` em `/etc/group` do container | Wrapper de boot do command override falhou. Conferir logs do pod no startup. |
| Bind-mount no compose do projeto monta diretório vazio | Daemon Docker do nó não enxerga paths dentro do PVC `paperclip-home` | Trocar por named volume. Ver `docs/ops/project-conventions.md`. |
| Containers de tasks paralelas conflitam | Mesmo `container_name` ou portas | Sempre prefixar `container_name: <slug>-<svc>` (a convenção exige). Compose project name `<slug>-<task-id>` isola, mas `container_name` é global. **Ou seja: container_name** deve incluir task_id se o repo for usado em paralelo (ex.: `<slug>-<task-id>-postgres`). Decidir caso a caso. |
| Worktrees do git brigam por lock | `git fetch` paralelo no mesmo `main/` | Usa `git -C main` com flock ou fetch só no setup. |
| Stack órfã depois de pod restart | `cleanupCommand` não rodou (agente foi morto antes) | Sweep periódico (Fase 05). Filtra por `label=paperclip.task=*` cruzando com tasks abertas. |

### Checklist final (modo K3s)

- [ ] PR #9 e PR #10 (chatlabel/paperclip) merged + Argo synced
- [ ] `kubectl exec ... -- gosu node docker version` retorna client + server
- [ ] Repo cliente tem `docker-compose.dev.yml` válido pelo `docs/ops/project-conventions.md`
- [ ] Project Workspace registrado com `cwd`, `setupCommand`, `cleanupCommand`
- [ ] Smoke test setup → up → ps → cleanup → zero resíduo passou
- [ ] Agente prompt template orienta sequência: worktree → setup → trabalho → cleanup → remove worktree

---

## Apêndice: modo standalone (Docker Desktop local)

Mantido como referência caso o operador trabalhe localmente fora do K3s prod. **Não é o caminho oficial em prod** — usar quando:
- Iterando rapidamente sem mexer em prod
- Demo / desenvolvimento de skills
- Debug do próprio paperclip-app

Pre-requisito: paperclip-standalone com `Dockerfile.dev` (docker CLI + Compose v2 instalados, `node` no grupo `root`) e `docker-compose.standalone.yml` com `/var/run/docker.sock` montado e network externa `paperclip-projects-net`. Validado em 2026-04-28 com nginx-demo (HUB-7).

### Arquitetura (standalone)

```
host (macOS)
└─ Docker Desktop VM
   ├─ paperclip-app (paperclip-standalone-dev:latest)
   │   ├─ /var/run/docker.sock  ← bind do host
   │   ├─ /paperclip            ← volume nomeado paperclip-data
   │   │   └─ projects/<slug>/  ← workspace de cada projeto
   │   │       └─ docker-compose.dev.yml
   │   └─ networks: default + paperclip-projects-net
   ├─ paperclip-postgres
   └─ <slug>-<service> (mongo, redis, etc.) ← stack auxiliar do projeto
       └─ networks: paperclip-projects-net  ← reachable por hostname de paperclip-app
```

Decisões-chave (standalone):
- O daemon Docker do host (Docker Desktop) executa as stacks; paperclip-app só envia comandos via socket.
- **Bind-mounts em compose-files do projeto** são resolvidos pelo daemon do host. Paths dentro do volume nomeado `paperclip-data` NÃO são visíveis ao daemon. Use **named volumes**.
- Container names devem ser únicos globalmente (`<slug>-<service>`).

### Passos (standalone)

#### 1. Criar o workspace dentro de paperclip-app

```sh
docker exec -u node paperclip-app sh -lc 'mkdir -p /paperclip/projects/<slug>'
```

#### 2. Escrever `docker-compose.dev.yml`

Mesma convenção do modo K3s (`docs/ops/project-conventions.md`), mais o detalhe de network externa:

```yaml
name: <slug>
services:
  <svc>:
    image: <image>:<tag>
    container_name: <slug>-<svc>
    restart: unless-stopped
    mem_limit: 512m
    networks:
      - paperclip-projects-net
    volumes:
      - <slug>-<svc>-data:/var/lib/<servicodir>

volumes:
  <slug>-<svc>-data:

networks:
  paperclip-projects-net:
    external: true
```

#### 3. Registrar Project Workspace

Mesmo POST do modo K3s, mas com `cwd: /paperclip/projects/<slug>` direto (sem worktree, single-tenant).

### Pegadinhas (standalone)

| Sintoma | Causa real | Fix |
|---|---|---|
| `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` | `gosu` ignora `group_add` do compose; PID 1 fica sem GID 0 supplementary | Adicionar `usermod -aG root node` no `Dockerfile.dev`. Verificar com `docker exec paperclip-app cat /proc/1/status \| grep Groups` |
| Bind-mount no compose monta diretório vazio | Daemon Docker (host) não enxerga paths dentro do volume `paperclip-data` | Trocar por named volume |
| Agente "procura API pra trigger setupCommand" em vez de executar | Agente assume que há mecanismo gerenciado | Issue/comment dizer "rodar direto via Bash" |
| Agente pega o fallback workspace `~/.paperclip/instances/default/workspaces/<agentId>` | Heartbeat foi `on_demand` sem issue, ou issue sem `projectId/projectWorkspaceId` | Garantir `projectId` setado e wake-up por `assignment` |

---

## Arquivos relevantes no repo

- `Dockerfile` (upstream) — base do paperclip-app
- `Dockerfile.dev` — derivação standalone com Docker CLI + node no grupo root (modo standalone só)
- `docker-compose.standalone.yml` — socket mount + network externa (modo standalone)
- `k8s/base/paperclip/paperclip-app.yaml` — manifest prod (DooD ativado pelos PRs #9 e #10)
- `scripts/projects/setupProjectStack.sh` / `cleanupProjectStack.sh` — helpers compartilhados pelos dois modos
- `docs/ops/project-conventions.md` — contrato do `docker-compose.dev.yml` do cliente
- `paperclip-plans/00-decisions.md` (fora do repo) — D-3 (sem internal), D-4 (mem_limit), D-12 (DooD)
