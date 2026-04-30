# CLAUDE.md — instruções operacionais pro agente neste repo

Esse arquivo é lido automaticamente pelo Claude Code quando opera dentro deste clone. Define políticas que o agente DEVE respeitar — não são sugestões.

## Sobre este repo

`chatlabel/paperclip` é o fork operado pela chatlabel do upstream open-source `paperclipai/paperclip`. Contém:

- código upstream completo (sync manual via workflow `sync-upstream.yml`),
- adições da chatlabel: `k8s/` (manifests + ArgoCD Application), `Dockerfile.dev`, `docker-compose.standalone.yml`, `.claude/skills/paperclip-add-project/`, `.claude/skills/k3s-ssh-paperclip/`, este arquivo.

Imagem em prod vem do upstream (`ghcr.io/paperclipai/paperclip:<tag>`). Não buildamos imagem custom enquanto não houver demanda real de patch — o fork é "envelope de deploy".

Plano de implementação fica fora do tree deste repo, em `/Users/jefersson/code/paperclip-plans/`. Consulte quando precisar de contexto de fase/decisão.

## Política de SSH ao cluster k3s do paperclip

A skill `.claude/skills/k3s-ssh-paperclip/` documenta o protocolo completo. Resumo das invariantes que o agente DEVE seguir:

### Read é livre

Comandos de inspeção (`kubectl get`, `describe`, `logs`, `top`, `curl health`, `openssl`, etc., conforme listado na skill) podem ser executados sem perguntar.

### Write exige autorização explícita prévia

**Antes** de executar qualquer comando que mute estado (apply, patch, delete, restart, scale, label/taint, secret create, kubeseal, edição de filesystem do host, restart de serviço, etc.), o agente:

1. Posta no chat a mensagem de aprovação no formato exato definido na skill, contendo:
   - **Comando** (literal, multilinha se for o caso)
   - **Por quê** (ligado a uma fase do `paperclip-plans/`)
   - **O que muda** (state diff)
   - **Resultado esperado**
   - **Worst case**
   - **Reversível?** (sim com comando / não)
   - **GitOps?** (passa por PR ou bypassa, com justificativa)
2. Pausa e aguarda autorização do operador.
3. Só executa após receber **"ok" / "pode" / "sim" / "manda"** ou equivalente claro do operador.
4. Executa **exatamente** o comando aprovado, uma vez. Sem emendas.
5. Reporta o resultado com estado pós-execução.

### Auto mode não dispensa autorização

O Claude Code em auto mode **pode prosseguir** com execução de write **APENAS APÓS** receber a autorização explícita do operador (item 3 acima). Auto mode autoriza Claude a:

- pular confirmações sobre **leituras** SSH listadas na skill,
- executar a ação de write **uma vez** após "ok" do operador, sem pedir um segundo OK redundante,
- não pausar pra confirmar follow-ups read-only após o write.

Auto mode **NÃO autoriza** Claude a:

- executar write sem ter postado o template de aprovação primeiro,
- aceitar autorização blanket ("pode tudo que precisar") como OK pra writes futuros — cada write quer seu OK individual,
- emendar comandos extras no mesmo turn ("já que tô lá vou também...").

Esse desvio do padrão "auto mode = sem fricção" é intencional. O cluster é compartilhado com workloads de produção de outros (zupys/agent-z). Erro custa downtime real.

### Sempre proibido (mesmo com OK)

Comandos catastróficos ou de exfiltração de segredo continuam proibidos mesmo com autorização. Lista canônica na skill (seção "Sempre proibido"). Exemplos: `kubectl get secret -o yaml` (dump completo), `cat /etc/rancher/k3s/k3s.yaml`, `k3s-uninstall.sh`, `rm -rf /var/lib/rancher/k3s/server/db`.

Se o operador insistir, recuse e proponha alternativa segura.

### GitOps é o caminho preferido

Mudanças de manifest viram **PR no `chatlabel/paperclip`** + sync via ArgoCD, não `kubectl apply` direto. SSH-write é exceção legítima para:

- bootstrap one-time (registrar Application, label/taint do nó dedicado),
- recovery operacional (rollout restart pra pod travado),
- debug que envolve mutação (`kubectl exec` pra investigar).

Mesmo nessas exceções, segue o template da skill.

## Outras políticas neste repo

- **Não criar** docs (`*.md`, `README*`) sem pedido explícito do operador. Exceção: este `CLAUDE.md`, a skill `k3s-ssh-paperclip` e o plano em `paperclip-plans/` foram pedidos.
- **Não editar** código upstream sem propósito claro. Mudanças nas pastas `server/`, `ui/`, `packages/`, `cli/` viram PR upstream se forem genéricas, ou ficam em pasta nossa se forem específicas da chatlabel.
- **Não rodar `git push --force`** em `master` deste repo. Branches feature ok com `--force-with-lease`.
- **Sync upstream** é manual via `Actions → Sync Upstream → Run workflow`. Não automatizar com cron.

## Onde buscar contexto adicional

- `AGENTS.md` (na raiz do repo, vem do upstream) — guia geral de contribuição.
- `doc/SPEC-implementation.md` — contrato de build do paperclip V1.
- `paperclip-plans/` (fora do repo) — fases operacionais e decisões consolidadas.
- `.claude/skills/` — skills específicas (paperclip-add-project, k3s-ssh-paperclip).
