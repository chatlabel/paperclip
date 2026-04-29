---
name: paperclip-add-project
description: Adicionar projeto novo ao Paperclip standalone com stack auxiliar (DB, broker, nginx) via docker compose. Use ao registrar Project Workspace, configurar setupCommand/cleanupCommand, ou debugar socket Docker em paperclip-app.
---

# Paperclip — adicionar projeto novo com stack auxiliar

Pre-requisito: paperclip-standalone com `Dockerfile.dev` (docker CLI + Compose v2 instalados, `node` no grupo `root`) e `docker-compose.standalone.yml` com `/var/run/docker.sock` montado e network externa `paperclip-projects-net`. Validado em 2026-04-28 com nginx-demo (HUB-7).

## Arquitetura

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

Decisões-chave:
- O daemon Docker do host executa as stacks; paperclip-app só envia comandos via socket.
- **Bind-mounts em compose-files do projeto** sao resolvidos pelo daemon do host. Paths dentro do volume nomeado `paperclip-data` NAO sao visiveis ao daemon. Use **named volumes** para dados persistentes (Postgres/Mongo data) ou imagens/configs estaticas.
- Container names devem ser unicos globalmente (`<slug>-<service>`). Cada projeto namespaceia seu compose com `name: <slug>` no topo.

## Passos para adicionar um projeto novo

### 1. Criar o workspace dentro de paperclip-app

```sh
docker exec -u node paperclip-app sh -lc 'mkdir -p /paperclip/projects/<slug>'
```

### 2. Escrever `docker-compose.dev.yml`

Template para `<slug>` (substituir):

```yaml
name: <slug>
services:
  <svc>:
    image: <image>:<tag>
    container_name: <slug>-<svc>
    restart: unless-stopped
    networks:
      - paperclip-projects-net
    # Para dados persistentes use named volume — NAO use bind-mount com path
    # do volume paperclip-data (o daemon nao enxerga).
    volumes:
      - <slug>-<svc>-data:/var/lib/<servicodir>

volumes:
  <slug>-<svc>-data:

networks:
  paperclip-projects-net:
    external: true
```

Coloca via:

```sh
cat <<'EOF' | docker exec -i -u node paperclip-app tee /paperclip/projects/<slug>/docker-compose.dev.yml > /dev/null
... (yaml acima) ...
EOF
```

### 3. Registrar o Project Workspace via API

`POST /api/companies/<companyId>/projects` com body:

```json
{
  "name": "<slug>",
  "description": "...",
  "status": "in_progress",
  "workspace": {
    "name": "main",
    "cwd": "/paperclip/projects/<slug>",
    "setupCommand": "cd /paperclip/projects/<slug> && docker compose -f docker-compose.dev.yml up -d --wait",
    "cleanupCommand": "cd /paperclip/projects/<slug> && docker compose -f docker-compose.dev.yml down",
    "isPrimary": true
  }
}
```

Pegue o `companyId` do localStorage (`paperclip.selectedCompanyId`) ou via `GET /api/companies`. A API requer sessao autenticada (cookie HttpOnly do Better Auth) — chamar do browser via `fetch(..., { credentials: 'include' })` ou via `paperclipai company list --api-key <token>`.

### 4. Atribuir issue ao agente

Quando o agente recebe a issue, o heartbeat de `assignment` injeta automaticamente o `cwd` do Project Workspace. Confirmavel no log do run via `"system","subtype":"init","cwd":"/paperclip/projects/<slug>"`.

### 5. (Para projetos com codigo da app) clonar o repo no workspace

O `setupCommand` pode tambem fazer `git clone` na primeira execucao:

```sh
[ -d ./.git ] || git clone <repoUrl> .
docker compose -f docker-compose.dev.yml up -d --wait
```

Ou use `repoUrl`/`repoRef` no workspace para que o Paperclip clone (modo execution_workspace).

## Validacao

Apos registrar o projeto, peca ao agente algo simples:

```sh
cd /paperclip/projects/<slug>
docker compose -f docker-compose.dev.yml up -d --wait
docker ps --filter name=<slug>-
curl -sS http://<slug>-<svc>:<port>/  # ou comando especifico do servico
docker compose -f docker-compose.dev.yml down
```

O agente deve conseguir tudo sem ajuda externa. Se falhar com `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`, ver [Pegadinhas](#pegadinhas) abaixo.

## Pegadinhas

| Sintoma | Causa real | Fix |
|---|---|---|
| `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` | `gosu` ignora `group_add` do compose; PID 1 fica sem GID 0 supplementary | Adicionar `usermod -aG root node` no `Dockerfile.dev`. Verificar com `docker exec paperclip-app cat /proc/1/status \| grep Groups` — deve mostrar `Groups: 0` |
| `docker exec -u node` funciona mas a process tree do agente nao | Mesmo motivo — `-u node` aplica group_add, gosu nao | Mesmo fix acima |
| Bind-mount no compose do projeto monta diretorio vazio no container | Daemon Docker (host) nao enxerga paths dentro do volume `paperclip-data` | Trocar por named volume. Para conteudo, usar imagem/configmap. |
| Containers de projetos diferentes conflitam | Mesmos `container_name` ou portas | Sempre prefixar com `<slug>-` no `container_name`. Evitar publicar portas do host (`ports:`) — comunicar so pela network interna. |
| Agente "procura API pra trigger setupCommand" em vez de executar | Faltou instrucao explicita; agente assume que ha mecanismo gerenciado | Issue/comment dizer "rodar direto via Bash; nao ha endpoint" |
| Agente pega o fallback workspace `~/.paperclip/instances/default/workspaces/<agentId>` em vez do cwd do projeto | Heartbeat foi `on_demand` sem issue, ou issue sem `projectId/projectWorkspaceId` | Garantir que a issue tem `projectId` setado e o agente foi acordado por `assignment` |
| `setupCommand`/`cleanupCommand` estao no DB mas nao executam automaticamente | Sao executados manualmente pelo agente OU via UI; nao ha auto-trigger no heartbeat | Documentar no prompt do agente que ele precisa rodar antes/depois |

## Checklist final

- [ ] `docker exec paperclip-app cat /proc/1/status \| grep Groups` retorna `Groups: 0`
- [ ] `docker exec -u node paperclip-app docker version` retorna Client e Server
- [ ] `docker network inspect paperclip-projects-net` mostra paperclip-app conectado
- [ ] `POST /api/companies/<id>/projects` retorna 201 com `primaryWorkspace.cwd` correto
- [ ] Agente atribuido roda heartbeat com `cwd: /paperclip/projects/<slug>` (visivel no log)
- [ ] `docker ps` mostra os containers da stack do projeto na `paperclip-projects-net`
- [ ] `cleanupCommand` derruba tudo limpo

## Arquivos relevantes no repo Paperclip

- [Dockerfile.dev](../../../Dockerfile.dev) — derivacao com docker CLI + node no grupo root
- [docker-compose.standalone.yml](../../../docker-compose.standalone.yml) — socket mount + network externa
- [doc/spec/agents-runtime.md](../../../doc/spec/agents-runtime.md) — modelo de heartbeat e cwd
- [docs/api/goals-and-projects.md](../../../docs/api/goals-and-projects.md) — schema do Project Workspace
- [packages/db/src/schema/project_workspaces.ts](../../../packages/db/src/schema/project_workspaces.ts) — campos `setupCommand`/`cleanupCommand`
