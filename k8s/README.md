# Manifestos Kubernetes

Descrição dos recursos que compõem a solução no cluster, na ordem em que devem ser aplicados.

| Ordem | Arquivo | Recursos | Papel |
|---|---|---|---|
| 00 | `00-namespace.yaml` | `Namespace` | Isola todos os recursos em `vehicle-sales` |
| 01 | `01-configmap.yaml` | `ConfigMap` | Configuração **não sensível**: `NODE_ENV`, `PORT`, host/porta/base/usuário do banco |
| 02 | `02-secret.yaml` | `Secret` | Dado **sensível**: senha do banco |
| 03 | `03-postgres.yaml` | `PersistentVolumeClaim`, `Deployment`, `Service` | PostgreSQL com volume persistente, exposto só internamente (ClusterIP) |
| 04 | `04-api.yaml` | `Deployment`, `Service` | API com 2 réplicas, initContainers de migration, probes e NodePort |
| 05 | `05-hpa.yaml` | `HorizontalPodAutoscaler` | Escala de 2 a 10 réplicas conforme CPU/memória |

## Subindo tudo

```bash
# Automatizado (build da imagem + apply + espera o rollout)
./k8s/deploy.sh

# Ou manualmente
kubectl apply -f k8s/
```

> Em minikube, construa a imagem dentro do daemon do cluster para que
> `imagePullPolicy: IfNotPresent` a encontre:
> ```bash
> eval $(minikube docker-env)
> docker build -t vehicle-sales-api:latest .
> ```

## Acessando a API

```bash
kubectl -n vehicle-sales port-forward svc/vehicle-sales-api-service 3000:80
# Swagger: http://localhost:3000/docs
```

Alternativamente, via NodePort: `minikube service vehicle-sales-api-service -n vehicle-sales --url`.

## Inspecionando

```bash
kubectl -n vehicle-sales get all
kubectl -n vehicle-sales get configmap vehicle-sales-config -o yaml
kubectl -n vehicle-sales get secret vehicle-sales-secret -o yaml
kubectl -n vehicle-sales describe deployment vehicle-sales-api
kubectl -n vehicle-sales logs -l app=vehicle-sales-api --tail=100
kubectl -n vehicle-sales logs -l app=vehicle-sales-api -c run-migrations
kubectl -n vehicle-sales get hpa -w
```

## Detalhes de projeto

**Migrations em `initContainer`.** Com 2+ réplicas, deixar `prisma migrate deploy` no comando
principal faria todas as réplicas aplicarem o schema simultaneamente. O initContainer
`run-migrations` executa uma vez por rollout, antes de qualquer réplica subir; o initContainer
`wait-for-db` antes dele garante que o PostgreSQL já aceita conexões.

**`DATABASE_URL` composta em runtime.** A URL é montada a partir das variáveis do ConfigMap mais a
senha do Secret, usando a interpolação `$(VAR)` do Kubernetes — a senha nunca aparece escrita em um
manifesto de configuração.

**Probes com papéis diferentes.** `/health` (liveness) não consulta o banco: reiniciar o pod não
resolveria uma queda do PostgreSQL e só pioraria o incidente. `/health/ready` (readiness) executa
`SELECT 1` e, em caso de falha, tira o pod do balanceamento do Service sem matá-lo.

**Banco não exposto.** O `Service` do PostgreSQL é `ClusterIP`: acessível apenas de dentro do
cluster.

**Estratégia de atualização.** A API usa `RollingUpdate` com `maxUnavailable: 0` (nenhuma queda de
disponibilidade durante o deploy). O PostgreSQL usa `Recreate`, porque o volume `ReadWriteOnce` não
pode ser montado por dois pods ao mesmo tempo.

## Removendo

```bash
./k8s/cleanup.sh     # ou: kubectl delete namespace vehicle-sales
```
