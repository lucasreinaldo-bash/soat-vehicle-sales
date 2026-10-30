# Plataforma de Revenda de Veículos — Tech Challenge Fase 3 (SOAT PósTech)

API REST da plataforma de revenda de veículos automotores. A API cobre:

- cadastro e edição de veículos;
- **compra pela internet, restrita a clientes cadastrados**, com pagamento confirmado depois por
  webhook assinado;
- listagens de veículos à venda e de veículos vendidos, ordenadas por preço.

Implementada em **NestJS + TypeScript + PostgreSQL**, com **Clean Architecture** e **SOLID**,
empacotada em **Docker** e publicada em **Kubernetes**.

O cadastro e a autenticação dos clientes **não** ficam nesta API. Eles vivem num serviço de
identidade totalmente apartado (Keycloak), em outro repositório:
**[soat-vehicle-identity](https://github.com/lucasreinaldo-bash/soat-vehicle-identity)**.
Esta API não guarda nome, e-mail nem CPF de ninguém. Das vendas, guarda apenas o identificador
opaco do comprador que vem no token.

> A versão entregue na Fase 2 está preservada na tag
> [`fase-2`](https://github.com/lucasreinaldo-bash/soat-vehicle-sales/releases/tag/fase-2).

---

## Sumário

- [O que mudou na Fase 3](#o-que-mudou-na-fase-3)
- [Requisitos atendidos](#requisitos-atendidos)
- [Separação entre identidade e vendas](#separação-entre-identidade-e-vendas)
- [Modelagem do domínio](#modelagem-do-domínio)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Como executar localmente](#como-executar-localmente)
- [Endpoints e autorização](#endpoints-e-autorização)
- [Fluxo completo de ponta a ponta](#fluxo-completo-de-ponta-a-ponta)
- [Como testar](#como-testar)
- [Implantação em Kubernetes](#implantação-em-kubernetes)
- [Fluxo de mudanças: Pull Requests e CI](#fluxo-de-mudanças-pull-requests-e-ci)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Decisões de arquitetura](#decisões-de-arquitetura)

---

## O que mudou na Fase 3

| Fase 2 | Fase 3 |
|---|---|
| Venda registrada pelo operador, informando o CPF do comprador (`POST /vehicles/{id}/sale`) | **Compra feita pelo próprio cliente autenticado** (`POST /vehicles/{id}/purchase`), sem corpo: o comprador vem do token |
| CPF do comprador guardado na tabela de vendas | **Nenhum dado pessoal na base de vendas**: só o `buyer_id` (o `sub` do token). A coluna `buyer_cpf` foi removida por migration |
| API aberta | **JWT obrigatório por padrão**; papéis `admin` (operador) e `customer` (cliente) |
| Webhook de pagamento aberto | **Webhook assinado com HMAC-SHA256**, com proteção contra replay |
| — | `GET /me/purchases`: o cliente consulta as próprias compras |
| Mudanças direto na `main` | Toda mudança por **Pull Request**, com a `main` protegida e CI obrigatório |

---

## Requisitos atendidos

| # | Requisito do enunciado | Onde está implementado |
|---|---|---|
| 1 | Cadastrar um veículo (marca, modelo, ano, cor, preço) | `POST /vehicles`, papel `admin`: [`CreateVehicleUseCase`](src/application/use-cases/vehicle/create-vehicle.usecase.ts) |
| 2 | Editar os dados do veículo | `PUT /vehicles/{id}`, papel `admin`: [`UpdateVehicleUseCase`](src/application/use-cases/vehicle/update-vehicle.usecase.ts) |
| 3 | Compra pela internet **somente por pessoas cadastradas** | `POST /vehicles/{id}/purchase`, papel `customer`: [`PurchaseVehicleUseCase`](src/application/use-cases/sale/purchase-vehicle.usecase.ts). Sem token válido a API responde 401. O papel `customer` só existe para quem se cadastrou no serviço de identidade |
| 4 | Efetivação da compra | `POST /payments/webhook`, assinado: [`ProcessPaymentWebhookUseCase`](src/application/use-cases/sale/process-payment-webhook.usecase.ts) |
| 5 | Listagem de veículos à venda, por preço crescente | `GET /vehicles/available` (pública): [`ListAvailableVehiclesUseCase`](src/application/use-cases/vehicle/list-available-vehicles.usecase.ts) |
| 6 | Listagem de veículos vendidos, por preço crescente | `GET /vehicles/sold` (pública): [`ListSoldVehiclesUseCase`](src/application/use-cases/vehicle/list-sold-vehicles.usecase.ts) |
| 7 | Cadastro e autorização do comprador separados, em serviço apartado | Keycloak no repositório [soat-vehicle-identity](https://github.com/lucasreinaldo-bash/soat-vehicle-identity). Esta API só valida tokens: [`src/infrastructure/http/auth/`](src/infrastructure/http/auth/) |
| 8 | Dados do cliente separados dos dados transacionais da venda | Bancos distintos e redes distintas. A venda guarda só o `buyer_id`; [migration que remove o CPF](prisma/migrations/20261030000000_buyer_id_sem_cpf/migration.sql) |
| 9 | Mudanças por CI/CD e Pull Requests | [`.github/workflows/`](.github/workflows/), `main` protegida. Ver [Fluxo de mudanças](#fluxo-de-mudanças-pull-requests-e-ci) |
| 10 | README, código funcional e Kubernetes | Este arquivo, [`k8s/`](k8s/), [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml) |

---

## Separação entre identidade e vendas

```
                        ┌──────────────────────────────┐
  Cliente ─cadastro───▶ │  SERVIÇO DE IDENTIDADE       │──▶ identity-db
          ─login──────▶ │  Keycloak · realm            │    nome, e-mail, CPF, senha
                        │  vehicle-sales               │
                        └──────────────┬───────────────┘
                                       │ JWT RS256: sub · papéis · aud
                                       │ (a API busca só as chaves públicas, JWKS)
                                       ▼
  Cliente ─Bearer─────▶ ┌──────────────────────────────┐
                        │  API DE VENDAS (este repo)   │──▶ banco de vendas
                        │  valida o JWT localmente     │    veículos, vendas (buyer_id)
                        └──────────────────────────────┘
```

A separação vale em três níveis:

1. **Serviço.** Cadastro, login, senha e política de senha ficam no Keycloak, que tem repositório,
   pipeline e ciclo de vida próprios. A API não tem nenhuma rota de cadastro nem de login.
2. **Dados.** Os dados pessoais ficam no `identity-db`. A tabela `sales` guarda apenas `buyer_id`,
   um identificador opaco. Sem acesso ao serviço de identidade, ele não revela quem é a pessoa.
   O teste e2e verifica que a tabela de vendas não tem coluna de CPF.
3. **Rede.** No Docker Compose, a API entra na rede `vehicle-identity` apenas para buscar as chaves
   públicas. O banco de vendas fica fora dela e não alcança o banco de identidade.

A API depende só de um contrato, configurado por variáveis de ambiente:

| Variável | Valor no Compose | Para quê |
|---|---|---|
| `AUTH_ISSUER` | `http://localhost:8180/realms/vehicle-sales` | Emissor esperado no `iss` |
| `AUTH_AUDIENCE` | `vehicle-sales-api` | Audiência exigida no `aud` |
| `AUTH_JWKS_URI` | `http://keycloak:8080/realms/vehicle-sales/protocol/openid-connect/certs` | Chaves públicas para verificar a assinatura |

Trocar o Keycloak por Cognito ou Auth0 é trocar esses três valores, desde que o provedor publique
os papéis no mesmo formato. Nenhuma linha de regra de negócio muda.

---

## Modelagem do domínio

O enunciado avisa que *"nem todos os campos e funcionalidades necessárias estão descritos"*. A
lacuna central é que **a compra e a efetivação da compra são o mesmo processo de negócio,
separados no tempo**. A compra só se confirma quando a entidade de pagamento avisa que o dinheiro
entrou.

### Entidades

**`Vehicle`**: o veículo do estoque.

| Campo | Origem | Observação |
|---|---|---|
| `id`, `createdAt`, `updatedAt` | inferido | Identidade e auditoria |
| `brand`, `model`, `year`, `color`, `price` | enunciado | Dados do cadastro |
| `status` | **inferido** | `AVAILABLE` \| `RESERVED` \| `SOLD`. É o que separa as duas listagens exigidas |

**`Sale`**: a compra de um veículo.

| Campo | Origem | Observação |
|---|---|---|
| `id`, `createdAt`, `updatedAt` | inferido | Identidade e auditoria |
| `buyerId` | **inferido** | Identificador opaco do comprador (o `sub` do token). **Não é CPF nem dado pessoal** |
| `saleDate` | enunciado | Instante da compra, atribuído pelo servidor |
| `price` | **inferido** | Preço congelado no momento da compra |
| `vehicleId` | **inferido** | Qual veículo foi comprado |
| `paymentCode` | **inferido** | **Chave da integração**: o código que o webhook usa para localizar a compra |
| `status` | **inferido** | `PENDING_PAYMENT` \| `PAID` \| `CANCELLED` |

### Máquina de estados

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE: POST /vehicles (admin)
    AVAILABLE --> RESERVED: POST /vehicles/{id}/purchase (customer)<br/>cria Sale PENDING_PAYMENT<br/>e gera paymentCode
    RESERVED --> SOLD: webhook assinado<br/>status = PAID
    RESERVED --> AVAILABLE: webhook assinado<br/>status = CANCELLED
    SOLD --> [*]

    note right of AVAILABLE
        Aparece em GET /vehicles/available
    end note
    note right of RESERVED
        Não aparece em nenhuma listagem:
        já não está à venda, e ainda
        não foi vendido
    end note
    note right of SOLD
        Aparece em GET /vehicles/sold
        e não pode mais ser editado
    end note
```

### Regras de negócio implementadas

1. **Só cliente cadastrado compra.** Sem token, ou com token inválido, a resposta é **401**. Um
   token sem o papel `customer` recebe **403**, e isso inclui o operador.
2. **O comprador vem do token, nunca do corpo.** A rota de compra não aceita corpo. Ninguém
   compra em nome de outra pessoa.
3. Um veículo só pode ser comprado se estiver `AVAILABLE`. Compra concorrente do mesmo veículo
   retorna **409 Conflict**.
4. A `saleDate` é atribuída pelo servidor: a compra é um fato observado pelo sistema.
5. O webhook só é aceito com **assinatura HMAC válida e recente** (até 5 minutos). Sem assinatura,
   com assinatura errada, com corpo adulterado ou fora da janela, a resposta é **401** e nada muda.
6. O webhook é **idempotente por rejeição**. Uma compra que já saiu de `PENDING_PAYMENT` recusa nova
   notificação com **409**.
7. Pagamento cancelado **devolve o veículo ao catálogo** (`AVAILABLE`).
8. Veículo vendido **não pode ser editado** (**409**).
9. Cada cliente vê **apenas as próprias compras** em `GET /me/purchases`.
10. Validações de cadastro: preço maior que zero, ano entre 1900 e o ano seguinte ao corrente,
    marca, modelo e cor não vazios.

---

## Arquitetura

Clean Architecture com três camadas concêntricas. **Todas as setas de dependência apontam para
dentro.** O domínio não conhece ninguém; a aplicação conhece só o domínio; a infraestrutura conhece
as duas.

A autenticação é um detalhe de borda. Os guards HTTP validam o token e entregam ao caso de uso
apenas um `buyerId`. O domínio e a aplicação não sabem o que é JWT nem Keycloak.

```mermaid
flowchart TB
    subgraph INFRA["🔌 Infrastructure — detalhes substituíveis"]
        direction LR
        HTTP["HTTP<br/>Controllers, DTOs,<br/>ExceptionFilter, Swagger"]
        AUTH["Auth (borda)<br/>JwtAuthGuard, RolesGuard,<br/>JwtTokenVerifier (JWKS)"]
        HOOK["Webhook<br/>WebhookSignatureGuard (HMAC)"]
        DB["Persistence<br/>Prisma + Repositories<br/>+ Unit of Work"]
        PAY["Payment<br/>MockPaymentGatewayAdapter"]
    end

    subgraph APP["⚙️ Application — casos de uso"]
        direction LR
        UC["Use Cases<br/>CreateVehicle, UpdateVehicle, GetVehicle,<br/>ListAvailable, ListSold,<br/>PurchaseVehicle, ListMyPurchases,<br/>ProcessPaymentWebhook"]
        PORTS["Ports (interfaces)<br/>IVehicleRepository<br/>ISaleRepository<br/>IPaymentGateway<br/>IUnitOfWork"]
    end

    subgraph DOMAIN["💛 Domain — regras de negócio"]
        direction LR
        ENT["Entities<br/>Vehicle, Sale"]
        ERR["Domain Errors"]
    end

    AUTH --> HTTP
    HOOK --> HTTP
    HTTP --> UC
    DB -.implementa.-> PORTS
    PAY -.implementa.-> PORTS
    UC --> PORTS
    UC --> ENT
    ENT --> ERR
```

### Como o SOLID aparece no código

| Princípio | Aplicação concreta |
|---|---|
| **S**ingle Responsibility | Um caso de uso por arquivo, com um único `execute()`. `PurchaseVehicleUseCase` só compra; `ProcessPaymentWebhookUseCase` só reage ao pagamento. Autenticar (`JwtAuthGuard`), autorizar (`RolesGuard`) e verificar a assinatura do webhook (`WebhookSignatureGuard`) são classes separadas. |
| **O**pen/Closed | Trocar de provedor de identidade é configuração. Um novo meio de pagamento é um novo adapter de `IPaymentGateway`. Nenhuma regra de negócio existente muda. |
| **L**iskov Substitution | `InMemorySaleRepository` (testes) e `PrismaSaleRepository` (produção) são intercambiáveis sob o mesmo contrato. O verificador de token aceita qualquer fonte de chaves: remota (JWKS do Keycloak) em produção, local nos testes. |
| **I**nterface Segregation | Portas pequenas: `IPaymentGateway` expõe só `requestPayment`. O caso de uso recebe `buyerId: string`, não o token inteiro. |
| **D**ependency Inversion | Casos de uso dependem de interfaces (`src/application/ports/`). A ligação com Prisma, gateway e Keycloak acontece só nos módulos de composição. |

Detalhamento, com os trade-offs de cada decisão, em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 |
| Framework | NestJS 11 (injeção de dependência, guards, pipes, filters) |
| Linguagem | TypeScript 5.7 (modo estrito) |
| Banco de dados | PostgreSQL 16 |
| ORM | Prisma 5 |
| Identidade | Keycloak 26 (OIDC), em [repositório próprio](https://github.com/lucasreinaldo-bash/soat-vehicle-identity) |
| Validação de token | `jose` (JWT RS256, JWKS remoto com cache) |
| Documentação | OpenAPI 3 / Swagger UI, com botão **Authorize** para o token |
| Testes | Jest (unitários) + Supertest (e2e) |
| Container | Docker (multi-stage) + Docker Compose |
| Orquestração | Kubernetes (Deployment, Service, ConfigMap, Secret, PVC, HPA) |
| CI/CD | GitHub Actions |

---

## Como executar localmente

Pré-requisitos: Docker com o plugin Compose, `curl`, `jq` e `openssl`.

### 1. Suba o serviço de identidade

Ele vive em outro repositório:

```bash
git clone https://github.com/lucasreinaldo-bash/soat-vehicle-identity.git
cd soat-vehicle-identity
docker compose up -d --wait
```

O Keycloak fica em <http://localhost:8180> e cria a rede Docker `vehicle-identity`.

### 2. Suba a API

Nesta pasta:

```bash
docker compose up -d --wait
```

O comando sobe o PostgreSQL de vendas e a API. A API espera o banco ficar saudável, aplica as
migrations e sobe na porta 3000.

| O quê | Endereço |
|---|---|
| API | <http://localhost:3000> |
| Swagger | <http://localhost:3000/docs> |
| Especificação OpenAPI (JSON) | <http://localhost:3000/docs-json> |
| Health | <http://localhost:3000/health> |

Se o serviço de identidade for recriado (`docker compose down` na pasta dele), a rede
`vehicle-identity` ganha outro id. Nesse caso recrie o container da API:

```bash
docker compose up -d --force-recreate --wait api
```

Para popular o catálogo com veículos de exemplo:

```bash
npm install
DATABASE_URL="postgresql://vehicles:vehicles@localhost:5432/vehicle_sales?schema=public" npm run prisma:seed
```

Para derrubar tudo (`-v` também remove o volume do banco):

```bash
docker compose down -v
```

### Alternativa: Node local com banco em container

```bash
cp .env.example .env
npm install
docker compose up -d db
npx prisma migrate deploy
npm run start:dev
```

O `.env.example` aponta `AUTH_JWKS_URI` para `localhost:8180`, o Keycloak publicado no host.

---

## Endpoints e autorização

A API é **fechada por padrão**: toda rota exige um token válido, exceto as marcadas como públicas.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/vehicles/available` | público | Veículos à venda, do mais barato ao mais caro |
| `GET` | `/vehicles/sold` | público | Veículos vendidos, do mais barato ao mais caro |
| `GET` | `/vehicles/{id}` | público | Consulta um veículo |
| `POST` | `/vehicles` | `admin` | Cadastra um veículo |
| `PUT` | `/vehicles/{id}` | `admin` | Edita os dados de um veículo |
| `POST` | `/vehicles/{id}/purchase` | `customer` | Compra o veículo; devolve o `paymentCode` |
| `GET` | `/me/purchases` | `customer` | Compras do cliente autenticado, com o status do pagamento |
| `POST` | `/payments/webhook` | assinatura HMAC | Notificação do processador de pagamento (`PAID` ou `CANCELLED`) |
| `GET` | `/health`, `/health/ready` | público | Liveness e readiness |

No Swagger, use o botão **Authorize** e cole o token obtido no serviço de identidade.

### Respostas de segurança

| Situação | Status |
|---|---|
| Sem token, token expirado, assinatura inválida, emissor ou audiência errados | **401** |
| Token válido, mas sem o papel exigido | **403** |
| Serviço de identidade fora do ar (JWKS inacessível) | **503**. A API não confunde indisponibilidade com token inválido |
| Webhook sem assinatura, com assinatura errada ou com mais de 5 minutos | **401** |

### O webhook assinado

O processador de pagamento assina cada notificação com um segredo compartilhado
(`PAYMENT_WEBHOOK_SECRET`):

```
X-Webhook-Timestamp: <segundos desde a época Unix>
X-Webhook-Signature: sha256=<HMAC-SHA256(segredo, "<timestamp>.<corpo bruto>")>
```

A API recalcula o HMAC sobre os **bytes exatos** recebidos e compara em tempo constante
(`timingSafeEqual`). Como o timestamp entra na assinatura, uma notificação capturada não pode ser
reenviada depois da janela de 5 minutos. O script
[`scripts/simular-pagamento.sh`](scripts/simular-pagamento.sh) faz o papel do processador na
demonstração.

### Padrão de erro

Todas as falhas, inclusive as de autenticação, usam o mesmo envelope, produzido pelo
[`DomainExceptionFilter`](src/infrastructure/http/filters/domain-exception.filter.ts):

```json
{
  "statusCode": 409,
  "error": "VehicleNotAvailableError",
  "message": "Veículo abc-123 não está disponível para venda",
  "timestamp": "2026-10-30T18:32:00.000Z"
}
```

---

## Fluxo completo de ponta a ponta

```mermaid
sequenceDiagram
    actor C as Cliente
    participant KC as Keycloak<br/>(identidade)
    participant API as API de vendas
    participant PG as Processador<br/>de pagamento
    participant DB as Banco de vendas

    C->>KC: cadastro (nome, e-mail, CPF, senha)
    KC-->>C: conta criada com o papel customer
    C->>KC: login
    KC-->>C: JWT (sub, papéis, aud)

    C->>API: POST /vehicles/{id}/purchase<br/>Authorization: Bearer
    API->>API: valida o JWT pelo JWKS e exige customer
    API->>PG: solicita cobrança
    PG-->>API: paymentCode
    API->>DB: Sale(PENDING_PAYMENT, buyer_id = sub)<br/>Vehicle(RESERVED)
    API-->>C: 201 { saleId, paymentCode, status }

    Note over PG: o cliente paga (ou desiste)

    PG->>API: POST /payments/webhook<br/>X-Webhook-Signature (HMAC)
    API->>API: verifica assinatura e janela de tempo
    alt status = PAID
        API->>DB: Sale(PAID) + Vehicle(SOLD)
    else status = CANCELLED
        API->>DB: Sale(CANCELLED) + Vehicle(AVAILABLE)
    end
    API-->>PG: 200 OK
```

### Reproduzindo no terminal

Com as duas stacks no ar:

**1. Cadastre um cliente.** Abra <http://localhost:8180/realms/vehicle-sales/account>, clique em
**Cadastre-se** e preencha nome, e-mail, CPF e senha. Os passos abaixo usam
`cliente@exemplo.com` / `cliente12345`.

**2. Obtenha os tokens** do operador e do cliente:

```bash
KC=http://localhost:8180/realms/vehicle-sales/protocol/openid-connect/token
ADMIN=$(curl -s $KC -d grant_type=password -d client_id=vehicle-sales-cli -d username=admin@revenda.com -d password=admin12345 | jq -r .access_token)
CLIENTE=$(curl -s $KC -d grant_type=password -d client_id=vehicle-sales-cli -d username=cliente@exemplo.com -d password=cliente12345 | jq -r .access_token)
```

**3. O operador cadastra um veículo:**

```bash
VEHICLE_ID=$(curl -s -X POST http://localhost:3000/vehicles -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"brand":"Volkswagen","model":"Gol","year":2022,"color":"Prata","price":79990}' | jq -r .id)
curl -s http://localhost:3000/vehicles/available | jq
```

**4. O cliente compra:**

```bash
PAYMENT_CODE=$(curl -s -X POST http://localhost:3000/vehicles/$VEHICLE_ID/purchase -H "Authorization: Bearer $CLIENTE" | jq -r .paymentCode)
curl -s http://localhost:3000/me/purchases -H "Authorization: Bearer $CLIENTE" | jq
```

A compra aparece como `PENDING_PAYMENT`, e o veículo sai da lista de disponíveis.

**5. O processador de pagamento efetiva a compra:**

```bash
./scripts/simular-pagamento.sh $PAYMENT_CODE PAID
curl -s http://localhost:3000/vehicles/sold | jq
curl -s http://localhost:3000/me/purchases -H "Authorization: Bearer $CLIENTE" | jq
```

O veículo passa a constar em `/vehicles/sold`, e a compra do cliente aparece como `PAID`.

**Conferindo as proteções:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/vehicles/$VEHICLE_ID/purchase
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/vehicles/$VEHICLE_ID/purchase -H "Authorization: Bearer $ADMIN"
PAYMENT_WEBHOOK_SECRET=segredo-errado-qualquer ./scripts/simular-pagamento.sh $PAYMENT_CODE PAID
```

A compra sem token responde 401, a compra pelo operador responde 403 e o webhook com o segredo
errado responde 401.

**Conferindo o que a base de vendas guarda sobre o comprador:**

```bash
docker compose exec db psql -U vehicles -d vehicle_sales -c "select buyer_id, status from sales"
```

Aparece só o `buyer_id`, igual ao `sub` do token, e nenhum dado pessoal.

A coleção [`docs/api-requests.http`](docs/api-requests.http) traz o mesmo fluxo para a extensão
REST Client do VS Code.

---

## Como testar

### Testes unitários (não exigem banco nem Keycloak)

```bash
npm test
npm run test:cov
```

São **72 testes**. Eles cobrem:

- as entidades;
- todos os casos de uso, com repositórios em memória
  ([`in-memory-repositories.ts`](src/application/use-cases/__mocks__/in-memory-repositories.ts));
- a verificação de tokens: assinatura, emissor, audiência, expiração, algoritmo e indisponibilidade
  do JWKS;
- os guards de autenticação e de papel;
- a assinatura do webhook: ausente, inválida, adulterada e expirada.

### Testes end-to-end (exigem PostgreSQL)

```bash
docker compose up -d db
cp .env.example .env
npx prisma migrate deploy
npm run test:e2e
```

São **31 testes** sobre a API real: HTTP, guards, controller, caso de uso, Prisma e PostgreSQL. O
teste sobe um emissor JWT local que publica um JWKS por HTTP. A API o valida exatamente como valida
o Keycloak, sem depender dele.

Os cenários incluem:

- compra sem token (401) e compra pelo operador (403);
- token adulterado;
- dois clientes disputando o mesmo veículo (409);
- webhook sem assinatura, com outro segredo, com corpo adulterado e fora da janela de tempo;
- isolamento das compras entre clientes;
- a verificação de que a tabela de vendas não tem coluna de CPF.

O repositório de identidade tem testes de fumaça próprios contra o Keycloak real, que rodam no CI
dele. Entre outras coisas, eles verificam que o CPF não aparece no token.

---

## Implantação em Kubernetes

Os manifestos estão em [`k8s/`](k8s/), numerados na ordem de aplicação:

| Arquivo | Recursos | Papel |
|---|---|---|
| `00-namespace.yaml` | Namespace `vehicle-sales` | Isolamento lógico da solução |
| `01-configmap.yaml` | ConfigMap | Configuração não sensível, incluindo `AUTH_ISSUER`, `AUTH_AUDIENCE` e `AUTH_JWKS_URI` |
| `02-secret.yaml` | Secret | Senha do banco e `PAYMENT_WEBHOOK_SECRET` |
| `03-postgres.yaml` | PVC + Deployment + Service | Banco com volume persistente, só interno (ClusterIP) |
| `04-api.yaml` | Deployment + Service | API com 2 réplicas, probes, limites de recursos e NodePort |
| `05-hpa.yaml` | HorizontalPodAutoscaler | Escala de 2 a 10 réplicas por CPU e memória |

No cluster, a API busca as chaves públicas no Service do Keycloak, em outro namespace
(`keycloak.vehicle-identity.svc.cluster.local:8080`). O serviço de identidade é implantado pelo
repositório dele.

### Subindo com minikube

```bash
minikube start
minikube addons enable metrics-server
./k8s/deploy.sh
```

O script faz o build da imagem dentro do cluster, aplica os manifestos e espera o rollout. Para
acessar a API:

```bash
kubectl -n vehicle-sales port-forward svc/vehicle-sales-api-service 3000:80
```

Para inspecionar:

```bash
kubectl -n vehicle-sales get all
kubectl -n vehicle-sales logs -l app=vehicle-sales-api --tail=50
kubectl -n vehicle-sales get hpa
```

Para remover tudo: `./k8s/cleanup.sh`. As evidências de validação no cluster estão em
[`k8s/README.md`](k8s/README.md).

### Decisões relevantes dos manifestos

- **Migrations em `initContainer`.** Rodam uma vez por rollout, antes de qualquer réplica subir.
  Um segundo initContainer (`wait-for-db`) garante que o banco já aceita conexões.
- **ConfigMap × Secret.** O segredo do webhook e a senha do banco ficam no Secret. A configuração
  de autenticação é pública por natureza (emissor e endereço das chaves públicas) e fica no
  ConfigMap.
- **Probes distintas.** `/health` (liveness) não toca no banco; `/health/ready` (readiness) valida a
  conexão e tira o pod do balanceamento enquanto o banco estiver indisponível.
- **Banco como ClusterIP.** O PostgreSQL nunca é exposto para fora do cluster.

---

## Fluxo de mudanças: Pull Requests e CI

Toda mudança entra por **Pull Request**. A branch `main` é protegida, inclusive para
administradores:

- não aceita push direto;
- exige histórico linear e merge por squash;
- só aceita merge com o CI verde.

O CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) roda a cada Pull Request:

| Job | O que garante |
|---|---|
| Lint, build e testes unitários | O código compila, segue o padrão e as regras estão cobertas |
| Testes end-to-end | A API funciona contra um PostgreSQL real, com tokens e webhooks assinados |
| Build da imagem Docker | A imagem que vai para o cluster continua construível |

O histórico de PRs deste repositório mostra a evolução da Fase 3, um passo por PR.

---

## Estrutura do repositório

```
.
├── src/
│   ├── domain/                        # 💛 Regras de negócio puras (sem framework, sem I/O)
│   │   ├── vehicle/                   #    Entidade Vehicle + erros
│   │   ├── sale/                      #    Entidade Sale + erros
│   │   └── common/errors.ts           #    Hierarquia de erros de domínio
│   ├── application/                   # ⚙️ Casos de uso e contratos
│   │   ├── ports/                     #    Interfaces (repositórios, gateway, unit of work)
│   │   └── use-cases/                 #    Um caso de uso por arquivo
│   └── infrastructure/                # 🔌 Detalhes substituíveis
│       ├── http/
│       │   ├── auth/                  #    Validação de JWT, guards, decorators
│       │   ├── payment/               #    Webhook e verificação HMAC
│       │   ├── me/                    #    Área do cliente (/me/purchases)
│       │   └── vehicle/               #    Catálogo e compra
│       ├── persistence/               #    Prisma, repositórios e Unit of Work
│       └── payment/                   #    Adapter do gateway de pagamento
├── prisma/                            # Schema, migrations e seed
├── k8s/                               # Manifestos Kubernetes
├── scripts/simular-pagamento.sh       # Simula o processador de pagamento (webhook assinado)
├── test/e2e/                          # Testes end-to-end
├── docs/                              # Arquitetura e coleção de requisições
├── .github/workflows/                 # CI
├── Dockerfile                         # Build multi-stage
└── docker-compose.yml                 # Stack local da API
```

---

## Decisões de arquitetura

Resumo das escolhas não óbvias. O racional completo está em
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

1. **Identidade fora da API.** Cadastro, login e dados pessoais ficam no Keycloak. A API valida
   tokens localmente pelas chaves públicas e não chama o Keycloak a cada requisição.
2. **`buyer_id` opaco em vez de CPF.** A venda precisa saber *quem* comprou, não *os dados* de
   quem comprou. O `sub` do token resolve isso sem trazer dado pessoal para a base transacional.
3. **Seguro por padrão.** O guard de autenticação é global. Uma rota nova nasce protegida e só fica
   pública com `@Public()` explícito.
4. **Operador e cliente separados.** `admin` cadastra e edita; `customer` compra. O operador não
   recebe `customer`, então não compra pela API.
5. **Webhook autenticado por HMAC com timestamp.** O processador de pagamento não tem token OIDC.
   A assinatura do corpo prova a origem e a integridade, e o timestamp impede replay.
6. **Estado `RESERVED`.** Entre a compra e a confirmação do pagamento, o veículo não está à venda
   nem vendido.
7. **`paymentCode` como chave da integração.** Liga o processador externo à compra, sem expor ids
   internos.
8. **Gateway fora da transação.** A chamada ao gateway de pagamento acontece fora da transação, e
   a disponibilidade do veículo é revalidada dentro dela.
9. **Entidades imutáveis.** Transições retornam novas instâncias, o que deixa o fluxo de estados
   explícito.
