# Project conventions — `docker-compose.dev.yml` do repo cliente

> Como repos clientes devem ser estruturados pra que o Paperclip rodando no K3s prod consiga subir suas stacks de teste/desenvolvimento via DooD (Docker out of Docker — ver D-12 no `paperclip-plans/00-decisions.md`).

## Por que existe esse contrato

O agente Paperclip (CEO/Coder/Tester/...) roda dentro de um pod no K3s. Esse pod tem socket Docker do nó dedicado (`k3s-paperclip-01`) montado, então pode executar `docker compose up` literalmente. Pra isso funcionar de forma previsível e sem estado órfão, o `docker-compose.dev.yml` do repo precisa cumprir algumas regras.

A skill `paperclip-add-project` automatiza o registro do Project Workspace no Paperclip e referencia este doc como fonte da verdade do contrato.

## Regras obrigatórias

### 1. Sem `internal: true` na network do projeto

```yaml
# ❌ NÃO
networks:
  default:
    internal: true
```

`internal: true` desabilita rota externa — containers não conseguem fazer `npm install`, `apt update`, chamadas pra APIs externas em testes. Stacks reais precisam disso. Decisão D-3.

```yaml
# ✅ OK — sem networks declarada, compose cria <project>_default com internet
services:
  ...
```

### 2. `mem_limit:` obrigatório por service (D-4)

Cada `service` declara um teto. Sem isso uma stack pode estourar a RAM do nó e derrubar tudo (inclusive o pod do Paperclip). Defaults sugeridos:

| Tipo | Sugestão |
|---|---|
| Postgres / MySQL | `512m` |
| Redis / Memcached | `128m` |
| MongoDB | `512m` |
| RabbitMQ / Kafka | `512m` |
| App Node / Python | `512m` (dev) |
| Browser headless (chromium pra Playwright se for sidecar) | `1g` |

```yaml
services:
  postgres:
    image: postgres:17-alpine
    mem_limit: 512m
    ...
```

### 3. `container_name: <slug>-<svc>`

Nomes únicos globais evitam colisão entre projetos diferentes no mesmo daemon. Prefixe com o slug do projeto.

```yaml
services:
  postgres:
    container_name: my-app-postgres
  redis:
    container_name: my-app-redis
```

### 4. Port publishing **só em `127.0.0.1:`** (loopback)

Nunca exponha em `0.0.0.0:` — o nó tem IP público e portas em `0.0.0.0` ficam acessíveis da internet.

```yaml
# ❌ NÃO
ports:
  - "5432:5432"      # equivale a 0.0.0.0:5432

# ✅ OK
ports:
  - "127.0.0.1:5432:5432"
```

Comunicação **entre containers da mesma stack** acontece pela network do compose via DNS interno (nome do service ou container_name) — não precisa de port publishing pra isso. Use ports só se um agente externo precisar acessar.

### 5. Named volumes (não bind-mount em `/paperclip`)

```yaml
# ❌ NÃO — bind-mount em path do PVC do paperclip
services:
  postgres:
    volumes:
      - /paperclip/projects/my-app/data:/var/lib/postgresql/data

# ✅ OK — named volume
services:
  postgres:
    volumes:
      - my-app-pgdata:/var/lib/postgresql/data

volumes:
  my-app-pgdata:
```

O daemon Docker do host **não enxerga paths dentro do PVC** do pod paperclip (é volume k8s, não diretório do host). Bind-mount aponta pra path do daemon, que vai criar/usar diretório vazio no host. Resultado é um diretório vazio dentro do container — confusão. Use named volumes.

### 6. Healthchecks em todo service que outros dependem

`docker compose up --wait` (usado pelo helper `setupProjectStack.sh`) só sabe que o serviço está pronto se tiver healthcheck. Sem isso, ele dá `up` e segue sem garantia.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
```

## Exemplo completo

`docker-compose.dev.yml` mínimo pra um app Node + Postgres + Redis:

```yaml
name: my-app

services:
  postgres:
    image: postgres:17-alpine
    container_name: my-app-postgres
    restart: unless-stopped
    mem_limit: 512m
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: my_app
    volumes:
      - my-app-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev -d my_app"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  redis:
    image: redis:8-alpine
    container_name: my-app-redis
    restart: unless-stopped
    mem_limit: 128m
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  my-app-pgdata:
```

(Sem `networks:` — compose cria `my-app_default` automático com saída pra internet, conforme D-3.)

## Como o Paperclip usa isso

O agente é orientado a chamar dois helpers (`scripts/projects/`) no início e no fim de cada task:

```sh
# setup
scripts/projects/setupProjectStack.sh <slug> <task-id> <repo-path>

# trabalho do agente acontece aqui (testes, edits, etc.)

# cleanup
scripts/projects/cleanupProjectStack.sh <slug> <task-id> <repo-path>
```

Os helpers escopam tudo por **compose project name** = `<slug>-<task-id>`, com label `com.docker.compose.project` aplicada automaticamente. Cleanup remove containers, networks e volumes daquele project — sem afetar tasks paralelas no mesmo repo.

Setup é **idempotente** (re-rodar não recria); cleanup é **idempotente** (não reclama se já estava limpo).

## Validação manual

Antes de cadastrar o repo no Paperclip, rode local pra garantir que o compose-file cumpre:

```sh
cd <repo>
docker compose -p $(basename "$PWD")-validate -f docker-compose.dev.yml up -d --wait
docker ps --filter label=com.docker.compose.project=$(basename "$PWD")-validate
docker compose -p $(basename "$PWD")-validate -f docker-compose.dev.yml down -v --remove-orphans
```

Se `up --wait` ficar travado, falta healthcheck em algum service. Se containers ficarem com nome conflitando, falta `container_name` único. Se a network reclamar de internet, alguém colocou `internal: true` por engano.

## Referências

- Decisão **D-3** (sem `internal: true`) e **D-4** (`mem_limit:` obrigatório) em `paperclip-plans/00-decisions.md`
- Decisão **D-12** (DooD em prod) idem
- Skill `.claude/skills/paperclip-add-project/SKILL.md` — automação do registro
- Helpers `scripts/projects/setupProjectStack.sh` / `cleanupProjectStack.sh`
