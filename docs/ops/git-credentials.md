# Git credentials no pod do Paperclip

Como autenticar `git clone` / `git fetch` / `gh repo clone` em repositórios privados a partir do pod `paperclip-app`.

## Padrão escolhido — PAT fine-grained + `~/.netrc`

| | |
|---|---|
| **Mecanismo** | Personal Access Token (fine-grained) injetado como env `GH_TOKEN` via Secret K8s `paperclip-git`; init wrapper do pod cria `/paperclip/.netrc` com perms 600 no boot. |
| **Escopo** | Read-only (ou read/write se a task pedir), em **N repos** do mesmo owner ou de orgs específicas. Um único Secret atende todos os projetos clientes. |
| **Persistência** | `.netrc` mora em `/paperclip` = PVC, sobrevive restart do pod. |
| **Rotação** | Manual quando o PAT expirar. Operador gera novo PAT, atualiza Secret (`kubectl create secret generic paperclip-git --from-literal=GH_TOKEN=<novo> -n paperclip --dry-run=client -o yaml \| kubectl apply -f -`), `kubectl rollout restart deploy/paperclip`. Boot wrapper reescreve o `.netrc`. |

## Setup inicial — uma vez por cluster

### 1. Criar PAT fine-grained no GitHub

1. Acessar **github.com/settings/personal-access-tokens** (ou Settings → Developer settings → Personal access tokens → Fine-grained tokens).
2. **Generate new token**:
   - **Token name:** `paperclip-prod-pod`
   - **Expiration:** 90d (ou outro razoável; planeje rotação)
   - **Resource owner:** seu user ou a org que detém os repos clientes
   - **Repository access:** "Only select repositories" → escolher os repos que serão Project Workspaces. Ou "All repositories" se preferir confiar amplo (não recomendado).
   - **Permissions:**
     - Contents → **Read** (ou Read/Write se o agente precisar fazer push de PRs)
     - Metadata → Read (default)
     - Pull requests → Read/Write (se quiser que o agente abra/comente PRs)
3. **Generate token**, copia.

### 2. Criar Secret `paperclip-git` no cluster

Sem GitOps (mais simples, escolhido pra não vazar PAT em git mesmo encriptado):

```sh
kubectl create secret generic paperclip-git \
  --from-literal=GH_TOKEN='ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' \
  -n paperclip
```

Ou via SealedSecret (precisa kubeseal local + cert público do controller):

```sh
echo -n 'ghp_xxx...' | kubectl create secret generic paperclip-git \
  --from-file=GH_TOKEN=/dev/stdin \
  --dry-run=client -o yaml \
  | kubeseal -o yaml > k8s/base/paperclip/sealed-secret-git.yaml
# committar o sealed-secret-git.yaml e adicionar em kustomization.yaml
```

### 3. Restart do pod (apenas se a deploy já estava rodando antes do Secret existir)

```sh
kubectl rollout restart deploy/paperclip -n paperclip
```

### 4. Validar

```sh
POD=$(kubectl -n paperclip get pod -l app=paperclip -o jsonpath='{.items[0].metadata.name}')

# .netrc existe e tem perms 600
kubectl -n paperclip exec "$POD" -c paperclip -- ls -la /paperclip/.netrc
# Esperado: -rw------- 1 node node ...

# Boot log deve ter a linha confirmando
kubectl -n paperclip logs "$POD" -c paperclip | grep "boot"
# Esperado: [boot] /paperclip/.netrc configurado (github.com)

# Smoke clone de um repo privado
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node \
  git clone https://github.com/<owner>/<priv-repo>.git /tmp/clone-test
kubectl -n paperclip exec "$POD" -c paperclip -- gosu node \
  rm -rf /tmp/clone-test
```

## Como o agente usa

`git clone https://github.com/...` funciona transparente. `~/.netrc` é lido pelo libcurl e pelo git automaticamente.

```sh
# Dentro do worktree do projeto:
git clone https://github.com/jeferssonlemes/agent-z.git
git fetch origin
git push origin <branch>   # se PAT tem write
```

`gh` CLI também funciona — usa `GH_TOKEN` do env var diretamente:

```sh
gh repo clone jeferssonlemes/agent-z
gh pr create --base main --head <branch>
```

## Trade-offs

| Aspecto | Escolha | Alternativa |
|---|---|---|
| Múltiplos repos | ✅ 1 PAT serve N | Deploy keys (1 por repo) — perde quando há muitos |
| Rotação | Manual (humano avisa quando expira) | GitHub App — auto-rotation, mas overhead de setup |
| Auditoria | PAT logs no GitHub | OK pra solo operator |
| Secret armazenado | K8s Secret base64 | SealedSecret se quiser GitOps strict |

## Quando migrar pra GitHub App

Considerar se:
- Mais de 5 operadores compartilham o cluster
- Compliance exige rotation automática
- Quer escopo per-installation por repo
- Tem orgs com policy de "no PATs"

GitHub App entrega tudo isso, mas precisa setup (criar a App, gerar private key, instalar nos repos) e o pod precisa biblioteca pra trocar JWT por installation token. Adia até precisar.
