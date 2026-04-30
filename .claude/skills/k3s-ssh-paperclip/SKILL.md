---
name: k3s-ssh-paperclip
description: SSH ao k3s do paperclip (chatlabel) pra ler estado e — com autorização explícita do user — aplicar mudanças. Read é livre. Write segue protocolo formal de aprovação obrigatório.
---

# k3s-ssh-paperclip — operações SSH no cluster do paperclip

Acesso SSH ao control plane do k3s onde o paperclip (chatlabel) é deployado. Use sempre que o operador pedir algo que envolva ler ou alterar estado do cluster: pods, logs, ingress, certs, ArgoCD, namespace `paperclip` ou namespaces de project (`paperclip-task-*`).

Cluster compartilhado com outros workloads (zupys/agent-z em production/databases/dev). Restrinja escrita a: namespace `paperclip`, namespaces `paperclip-task-*`, e bootstrap one-time do worker dedicado.

---

## Princípios

1. **Read é livre.** Inspeção, logs, descrição, estado — sem perguntar.
2. **Write é gated.** Toda mutação exige protocolo formal abaixo + autorização explícita do user. Auto mode **não substitui** autorização explícita; só permite executar **após** ela.
3. **Cada write é uma autorização individual.** "Pode aplicar X" não autoriza Y na sequência.
4. **Nunca eche secrets.** `kubectl get secret -o yaml`, dump de chave privada, conteúdo do `.kube/config`, certificados privados — proibido em qualquer caso.
5. **GitOps é o caminho preferido.** Mudanças de manifest viram PR no `chatlabel/paperclip`. SSH-write é exceção (bootstrap, recovery, debug operacional).

---

## Conexão

```text
Host:  178.104.48.164
User:  root
Port:  22
Key:   ~/.ssh/agentz_vps_id_ed25519   (ed25519, com passphrase)
```

Pattern padrão:

```bash
ssh -i ~/.ssh/agentz_vps_id_ed25519 \
    -o IdentitiesOnly=yes \
    root@178.104.48.164 \
    '<command>'
```

Se a passphrase prompta toda vez, sugerir ao operador rodar `ssh-add ~/.ssh/agentz_vps_id_ed25519` uma vez no shell dele.

---

## ✅ READ — execução livre

Sem pedir permissão. Resultado vai pro chat (resumido se longo).

### Estado do cluster

```bash
kubectl get nodes -o wide
kubectl describe node <name>
kubectl top nodes
kubectl get ns
kubectl get all -n paperclip
kubectl get all -n paperclip-task-<id>
kubectl get events -n paperclip --sort-by=.lastTimestamp | tail -50
```

### Workloads

```bash
kubectl get pods -n paperclip -o wide
kubectl describe pod -n paperclip <pod>
kubectl describe deploy/sts -n paperclip <name>
kubectl get hpa,pdb -A
kubectl top pods -n paperclip
```

### Logs (snapshot, nunca `-f`)

```bash
kubectl logs -n paperclip <pod> --tail=200
kubectl logs -n paperclip deploy/paperclip --since=30m
kubectl logs -n paperclip <pod> --previous --tail=200    # crash loop forensics
```

⚠ Nunca use `-f`/`--follow` em comando one-shot — trava a sessão SSH.

### Ingress, cert e rede

```bash
kubectl get ingress -A
kubectl describe ingress -n paperclip paperclip
kubectl get certificate -n paperclip
kubectl describe certificate -n paperclip paperclip-tls
curl -fsSI https://paperclip.dnshub.space
echo | openssl s_client -connect paperclip.dnshub.space:443 -servername paperclip.dnshub.space 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer
```

### ArgoCD

```bash
kubectl -n argocd get applications
kubectl -n argocd describe application paperclip
kubectl -n argocd logs deploy/argocd-application-controller --tail=200
```

### Sealed Secrets controller

```bash
kubectl -n kube-system get pods -l name=sealed-secrets-controller
kubectl -n kube-system logs deploy/sealed-secrets-controller --tail=100
kubectl get sealedsecrets -n paperclip
# OK: listar chaves do Secret resultante (não valores)
kubectl get secret paperclip-secrets -n paperclip -o jsonpath='{.data}' | jq 'keys'
```

### Host k3s

```bash
uptime
free -h
df -h
ss -tlnp
journalctl -u k3s --since "30 min ago" --no-pager | tail -100
```

---

## ⛔ WRITE — só após autorização explícita

Para qualquer comando abaixo (ou similar), **PARE**, monte a mensagem de aprovação no template, e aguarde "ok" / "pode" / "sim" / "manda" do operador. Silêncio = não.

### Template de aprovação obrigatório

Copie e cole essa estrutura. Adapte os campos. Não invente atalhos.

```text
🛠 Ação no k3s — preciso autorização

Comando:
  <comando exato, multilinha se for o caso>

Por quê:
  <1-2 frases ligando ao plano: "fase 01 do paperclip-plans, bootstrap inicial">

O que muda:
  <state diff explícito: "cria o namespace paperclip e Application paperclip no argocd">

Resultado esperado:
  <"Application aparece em kubectl -n argocd get app, sync status OutOfSync (esperado pré-1º-sync)">

Worst case:
  <"Application criada com targetRevision/path errado — sync falha, sem efeito em outros apps">

Reversível?
  <sim: "kubectl -n argocd delete app paperclip" / não: "—"; descreva como reverter>

GitOps?
  <sim: "passa por PR no repo + ArgoCD sync" / não: "kubectl direto, justificado por <razão>">

Posso prosseguir?
```

Aguarde a autorização **antes** de executar. Se o operador disser "manda" sem ler o template, peça pra ele confirmar lendo. Não execute em auto mode automático — auto mode aceita execução **depois** da resposta humana, nunca antes.

### Categorias que sempre exigem o template

#### Workload lifecycle (namespace `paperclip` ou `paperclip-task-*`)

```bash
kubectl rollout restart deploy/<name>
kubectl rollout undo deploy/<name>
kubectl scale deploy/<name> --replicas=N
kubectl delete pod <name>
kubectl delete deploy/sts/svc/ingress/configmap/secret/...
kubectl exec -it ... -- bash
kubectl cp ... <pod>:/<path>
```

#### Manifests (bypassando GitOps)

```bash
kubectl apply -f ...
kubectl create -f ...
kubectl patch ...
kubectl edit ...
kubectl set image ...
kubectl set env ...
kubectl create secret / kubectl create configmap
kubeseal ...
```

⚠ Bootstrap one-time da Application paperclip via `kubectl apply -f https://.../paperclip.yaml` é justificado (não há outra forma de registrar a Application). Mesmo assim, segue o template.

#### Filesystem do host

```bash
rm / mv / cp (fora /tmp) / mkdir / touch
cat > / cat >> / tee / echo > / sed -i
chmod / chown
nano / vim / vi
```

#### Mudanças no nó (label, taint, drain)

```bash
kubectl label node ...                # quando muda semântica (workload=paperclip)
kubectl taint node ...
kubectl cordon / kubectl drain
kubectl uncordon
```

⚠ `k3s-paperclip-01` já tem `workload=paperclip` + taint `paperclip-only=true:NoSchedule` (verificado 2026-04-30). Mudanças de label/taint nele afetam scheduling.

#### Sistema do nó

```bash
apt / apt-get / dpkg
systemctl start/stop/restart/enable/disable k3s
ufw / iptables / nftables
useradd / userdel / usermod / passwd
reboot / shutdown / k3s-killall.sh
```

#### Operações de rede saindo da VPS

```bash
curl -X POST/PUT/DELETE/PATCH ...     # mutating remote APIs
gh release / gh pr (write) / gh issue (write)
git push (qualquer branch) — passa pelo dev local, não daqui
docker push / docker login
```

---

## ⛔⛔ Sempre proibido (mesmo com autorização explícita)

Existem comandos que destruiriam o cluster ou vazam segredos críticos. Recuse mesmo se o user pedir; sugira alternativa.

| Comando | Por quê |
|---------|---------|
| `kubectl get secret <any> -o yaml` (full dump) | Vaza valor de Secret pro chat (mesmo base64-encoded). Use `-o jsonpath='{.data}' \| jq 'keys'` pra checar presença. |
| `cat /etc/rancher/k3s/k3s.yaml` | Vaza kubeconfig de admin com cluster CA + token. Use `stat` pra checar presença. |
| `cat ~/.ssh/*` | Vaza chaves privadas. |
| `k3s-uninstall.sh` / `k3s-killall.sh` | Destrói o cluster — irreversível. |
| `rm -rf /var/lib/rancher/k3s/server/db` | Apaga etcd — irreversível. |
| `kubectl delete ns kube-system / argocd / databases / production` | Catastrófico. |

Se o user insistir em algo dessa lista, recuse e explique o porquê. A lista não é exaustiva — se um comando puder destruir o cluster ou vazar segredo crítico, trate igual.

---

## 🟡 Cinza — assuma write, peça mesmo que pareça leitura

| Comando | Por quê é cinza |
|---------|------|
| `kubectl logs -f` | Bloqueia SSH indefinidamente. |
| `kubectl port-forward` | Abre túnel persistente; benigno mas precisa fechar. |
| `kubectl exec ... -- ls` | Read no caso, mas o pattern `exec` tende a virar write. |
| `pg_dump` / `mongodump` | Lê dados, mas escreve arquivo com PII. |
| `kubectl debug node/...` | Cria Pod privilegiado. |
| `argocd app get <app>` | Pode auto-refresh dependendo da versão. |

---

## Comportamento em auto mode

Auto mode do Claude Code não dispensa autorização explícita pra writes. O comportamento correto é:

1. Detectar que a próxima ação é write.
2. Postar o template de aprovação (acima).
3. **Pausar** — não executar nada da categoria write até receber a resposta.
4. Após "ok"/"pode"/"sim" do user, executar **uma vez** o comando exato listado no template. Não emendar comandos extras.
5. Reportar resultado: estado pré, comando executado, estado pós, feito-ou-rollback.

Se o user, em auto mode, der OK pré-emptivo (ex: "manda tudo que precisar"), recuse: o protocolo exige um OK por comando, mesmo em auto mode. Aceitar OK genérico viola a invariante.

A política equivalente está no `CLAUDE.md` da raiz do repo.

---

## Receitas comuns (read-only)

### "Paperclip está no ar?"

```bash
ssh ... 'kubectl -n paperclip get pods,svc,ingress,certificate && \
         curl -fsS https://paperclip.dnshub.space/api/health'
```

### "Que versão de imagem está rodando?"

```bash
ssh ... 'kubectl -n paperclip get deploy paperclip \
          -o jsonpath="image: {.spec.template.spec.containers[0].image}{\"\n\"}"'
```

### "Por que paperclip-postgres não sobe?"

```bash
ssh ... 'kubectl -n paperclip describe pod -l app=paperclip-postgres | tail -60 && \
         echo "--- logs ---" && \
         kubectl -n paperclip logs sts/paperclip-postgres --tail=100'
```

### "Cert do paperclip.dnshub.space está válido?"

```bash
ssh ... 'echo | openssl s_client -connect paperclip.dnshub.space:443 \
          -servername paperclip.dnshub.space 2>/dev/null | openssl x509 -noout -dates'
```

### "ArgoCD app paperclip está sincronizado?"

```bash
ssh ... 'kubectl -n argocd get app paperclip -o wide'
```

### "Sealed-secrets controller está saudável?"

```bash
ssh ... 'kubectl -n kube-system get pods -l name=sealed-secrets-controller && \
         kubectl -n kube-system logs deploy/sealed-secrets-controller --tail=30'
```

---

## Após executar um write autorizado

1. Mostre o estado **pós** com um read complementar (`get`, `describe`).
2. Diga explicitamente "feito" ou "executado" — não deixe ambíguo.
3. Se algo falhou no meio, pare; descreva o que rodou e o que não rodou; ofereça caminho de rollback.
4. Se a mudança bypassou GitOps, lembre: ArgoCD pode reverter no próximo sync. Recomende o PR correspondente.

---

## Recap final

1. Read = livre.
2. Write = template de aprovação + OK explícito + execução única.
3. GitOps preferido — `kubectl apply` direto na VPS é exceção, não regra.
4. Secrets nunca no chat, em forma alguma.
5. Auto mode não dispensa OK explícito — só permite executar **depois** dele.
6. Em dúvida, trate como write.
