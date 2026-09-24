# Plataforma de Revenda de Veículos — Tech Challenge Fase 2 (SOAT PósTech)

API REST para uma plataforma de revenda de veículos automotores: cadastro e edição de veículos,
venda com confirmação assíncrona de pagamento via webhook, e listagens do catálogo ordenadas por
preço. Implementada em **NestJS + TypeScript + PostgreSQL**, seguindo **Clean Architecture** e os
princípios **SOLID**, com empacotamento em **Docker** e publicação em **Kubernetes**.

---

## Sumário

- [Requisitos atendidos](#requisitos-atendidos)
- [Modelagem do domínio](#modelagem-do-domínio)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Como executar localmente](#como-executar-localmente)
- [Documentação da API (OpenAPI/Swagger)](#documentação-da-api-openapiswagger)
- [Endpoints](#endpoints)
- [Fluxo completo de ponta a ponta](#fluxo-completo-de-ponta-a-ponta)
- [Como testar](#como-testar)
- [Implantação em Kubernetes](#implantação-em-kubernetes)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Decisões de arquitetura](#decisões-de-arquitetura)

---

## Requisitos atendidos

| # | Requisito do enunciado | Onde está implementado |
|---|---|---|
| 1 | Cadastrar um veículo para venda (marca, modelo, ano, cor, preço) | `POST /vehicles` — [`CreateVehicleUseCase`](src/application/use-cases/vehicle/create-vehicle.usecase.ts) |
| 2 | Editar os dados do veículo | `PUT /vehicles/{id}` — [`UpdateVehicleUseCase`](src/application/use-cases/vehicle/update-vehicle.usecase.ts) |
| 3 | Efetuar a venda de um veículo (CPF do comprador, data da venda) | `POST /vehicles/{id}/sale` — [`SellVehicleUseCase`](src/application/use-cases/sale/sell-vehicle.usecase.ts) |
| 4 | Listagem de veículos à venda, ordenada por preço (crescente) | `GET /vehicles/available` — [`ListAvailableVehiclesUseCase`](src/application/use-cases/vehicle/list-available-vehicles.usecase.ts) |
| 5 | Listagem de veículos vendidos, ordenada por preço (crescente) | `GET /vehicles/sold` — [`ListSoldVehiclesUseCase`](src/application/use-cases/vehicle/list-sold-vehicles.usecase.ts) |
| 6 | Webhook de pagamento (efetuado/cancelado a partir do código do pagamento) | `POST /payments/webhook` — [`ProcessPaymentWebhookUseCase`](src/application/use-cases/sale/process-payment-webhook.usecase.ts) |
| 7 | Documentação OpenAPI/Swagger | `GET /docs` — configurado em [`main.ts`](src/main.ts) |
| 8 | SOLID e Clean Architecture de forma prescritiva | [Arquitetura](#arquitetura) e [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 9 | Manifestos Kubernetes (deployment, configmap, secrets, services) | [`k8s/`](k8s/) |
| 10 | Dockerfile e `docker compose up` | [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml) |

---

## Modelagem do domínio

O enunciado avisa que *"nem todos os campos e funcionalidades necessárias estão descritos"*. A
lacuna central é: **"efetuar a venda" e "webhook de pagamento" são o mesmo processo de negócio,
separados no tempo.** Uma venda não pode ser considerada concluída no instante em que é registrada
— ela só se confirma quando a entidade de pagamento avisa que o dinheiro entrou. Foi essa leitura
que guiou toda a modelagem.

### Entidades

**`Vehicle`** — o veículo do estoque.

| Campo | Origem | Observação |
|---|---|---|
| `id`, `createdAt`, `updatedAt` | inferido | Identidade e auditoria |
| `brand`, `model`, `year`, `color`, `price` | enunciado | Dados do cadastro |
| `status` | **inferido** | `AVAILABLE` \| `RESERVED` \| `SOLD` — é o que permite separar as duas listagens exigidas |

**`Sale`** — o registro de venda de um veículo.

| Campo | Origem | Observação |
|---|---|---|
| `id`, `createdAt`, `updatedAt` | inferido | Identidade e auditoria |
| `buyerCpf` | enunciado | CPF de quem comprou, validado por Value Object |
| `saleDate` | enunciado | Data da venda, atribuída pelo sistema no ato do registro |
| `price` | **inferido** | Preço congelado no momento da venda (o preço de tabela pode mudar depois) |
| `vehicleId` | **inferido** | Qual veículo foi vendido |
| `paymentCode` | **inferido** | **Chave da integração**: é o "código do pagamento" que o webhook usa para localizar a venda |
| `status` | **inferido** | `PENDING_PAYMENT` \| `PAID` \| `CANCELLED` |

### Máquina de estados

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE: POST /vehicles (cadastro)
    AVAILABLE --> RESERVED: POST /vehicles/{id}/sale<br/>(cria Sale PENDING_PAYMENT<br/>e gera paymentCode)
    RESERVED --> SOLD: POST /payments/webhook<br/>status = PAID
    RESERVED --> AVAILABLE: POST /payments/webhook<br/>status = CANCELLED
    SOLD --> [*]

    note right of AVAILABLE
        Aparece em GET /vehicles/available
    end note
    note right of RESERVED
        Não aparece em nenhuma das
        duas listagens: já não está
        à venda, e ainda não foi vendido
    end note
    note right of SOLD
        Aparece em GET /vehicles/sold
        e não pode mais ser editado
    end note
```

### Regras de negócio implementadas

1. Um veículo só pode ser vendido se estiver `AVAILABLE` — venda concorrente do mesmo veículo
   retorna **409 Conflict**.
2. O CPF do comprador é validado (formato + dígitos verificadores) antes de qualquer escrita;
   CPF inválido retorna **400** e **não cria venda nem reserva o veículo**.
3. A `saleDate` é atribuída pelo servidor, nunca recebida do cliente — evita adulteração de data e
   mantém a trilha de auditoria consistente.
4. O webhook é **idempotente por rejeição**: uma venda que já saiu de `PENDING_PAYMENT` recusa nova
   notificação com **409**, protegendo contra reentrega do processador de pagamento.
5. Pagamento cancelado **devolve o veículo ao catálogo** — ele volta a `AVAILABLE` e pode ser
   vendido de novo.
6. Veículo já vendido **não pode ser editado** (**409**) — preserva a integridade do histórico.
7. Validações de cadastro: preço maior que zero, ano entre 1900 e o ano seguinte ao corrente,
   marca/modelo/cor não vazios.

---

## Arquitetura

Clean Architecture com três camadas concêntricas. **A regra da dependência é absoluta: todas as
setas apontam para dentro.** O domínio não conhece ninguém; a aplicação conhece só o domínio; a
infraestrutura conhece as duas, e ninguém conhece a infraestrutura.

```mermaid
flowchart TB
    subgraph INFRA["🔌 Infrastructure — detalhes substituíveis"]
        direction LR
        HTTP["HTTP<br/>Controllers, DTOs,<br/>ExceptionFilter, Swagger"]
        DB["Persistence<br/>Prisma + Repositories"]
        PAY["Payment<br/>MockPaymentGatewayAdapter"]
    end

    subgraph APP["⚙️ Application — casos de uso"]
        direction LR
        UC["Use Cases<br/>CreateVehicle, UpdateVehicle,<br/>ListAvailable, ListSold,<br/>SellVehicle, ProcessPaymentWebhook"]
        PORTS["Ports (interfaces)<br/>IVehicleRepository<br/>ISaleRepository<br/>IPaymentGateway<br/>IUnitOfWork"]
    end

    subgraph DOMAIN["💛 Domain — regras de negócio"]
        direction LR
        ENT["Entities<br/>Vehicle, Sale"]
        VO["Value Objects<br/>Cpf"]
        ERR["Domain Errors"]
    end

    HTTP --> UC
    DB -.implementa.-> PORTS
    PAY -.implementa.-> PORTS
    UC --> PORTS
    UC --> ENT
    ENT --> VO
    ENT --> ERR
```

### Como o SOLID aparece no código

| Princípio | Aplicação concreta |
|---|---|
| **S**ingle Responsibility | Um caso de uso por arquivo, com um único método `execute()`. `SellVehicleUseCase` só vende; `ProcessPaymentWebhookUseCase` só reage ao pagamento. Controllers apenas traduzem HTTP ↔ caso de uso. |
| **O**pen/Closed | Um novo meio de pagamento é um novo adapter de `IPaymentGateway`; um novo banco é um novo repositório. Nenhuma regra de negócio existente é alterada. |
| **L**iskov Substitution | `InMemoryVehicleRepository` (testes) e `PrismaVehicleRepository` (produção) são intercambiáveis sob o mesmo contrato — os testes de caso de uso provam isso na prática. |
| **I**nterface Segregation | Portas pequenas e específicas: `IPaymentGateway` expõe só `requestPayment`; os repositórios expõem só os métodos que os casos de uso realmente consomem. |
| **D**ependency Inversion | Casos de uso dependem de **interfaces** (`src/application/ports/`), nunca de Prisma ou HTTP. A ligação com as implementações concretas acontece só nos módulos de composição ([`persistence.module.ts`](src/infrastructure/persistence/persistence.module.ts), [`payment-gateway.module.ts`](src/infrastructure/payment/payment-gateway.module.ts)). |

Detalhamento completo, com os trade-offs de cada decisão, em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 |
| Framework | NestJS 11 (injeção de dependência, módulos, pipes, filters) |
| Linguagem | TypeScript 5.7 (modo estrito) |
| Banco de dados | PostgreSQL 16 |
| ORM | Prisma 5 |
| Documentação | OpenAPI 3 / Swagger UI (`@nestjs/swagger`) |
| Validação | `class-validator` + `ValidationPipe` global |
| Testes | Jest (unitários) + Supertest (e2e) |
| Container | Docker (multi-stage) + Docker Compose |
| Orquestração | Kubernetes (Deployment, Service, ConfigMap, Secret, PVC, HPA) |

---

## Como executar localmente

### Opção 1 — Docker Compose (recomendado)

Pré-requisito: Docker com o plugin Compose.

```bash
docker compose up
```

Isso sobe **toda a solução** com um único comando: o PostgreSQL, e a API (que espera o banco ficar
saudável, aplica as migrations automaticamente e sobe na porta 3000).

- API: <http://localhost:3000>
- Swagger: <http://localhost:3000/docs>
- Health: <http://localhost:3000/health>

Para popular o catálogo com veículos de exemplo (executado a partir do host, com as dependências de
desenvolvimento instaladas):

```bash
npm install
DATABASE_URL="postgresql://vehicles:vehicles@localhost:5432/vehicle_sales?schema=public" \
  npm run prisma:seed
```

Para derrubar tudo (`-v` também remove o volume do banco):

```bash
docker compose down -v
```

### Opção 2 — Node local com banco em container

```bash
cp .env.example .env
npm install
docker compose up -d db          # sobe só o PostgreSQL
npx prisma migrate deploy        # aplica as migrations
npm run start:dev                # API em modo watch
```

---

## Documentação da API (OpenAPI/Swagger)

Com a aplicação no ar, a documentação interativa fica em **<http://localhost:3000/docs>**, e a
especificação OpenAPI em formato JSON em **<http://localhost:3000/docs-json>** — é esse arquivo que
o time de frontend pode importar no Insomnia/Postman ou usar para gerar um client tipado.

Todos os endpoints documentam parâmetros, corpo da requisição, exemplos e **todos os códigos de
resposta possíveis** (200/201, 400, 404, 409).

---

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/vehicles` | Cadastra um veículo para venda |
| `GET` | `/vehicles/available` | Lista veículos à venda, do mais barato ao mais caro |
| `GET` | `/vehicles/sold` | Lista veículos vendidos, do mais barato ao mais caro |
| `GET` | `/vehicles/{id}` | Consulta um veículo (usado pelo frontend para carregar a tela de edição) |
| `PUT` | `/vehicles/{id}` | Edita os dados de um veículo |
| `POST` | `/vehicles/{id}/sale` | Efetua a venda: registra o CPF do comprador e a data, e gera o código de pagamento |
| `POST` | `/payments/webhook` | Webhook do processador de pagamento (pagamento efetuado ou cancelado) |
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (valida conexão com o banco) |

### Padrão de erro

Todas as falhas retornam o mesmo envelope, produzido pelo
[`DomainExceptionFilter`](src/infrastructure/http/filters/domain-exception.filter.ts):

```json
{
  "statusCode": 409,
  "error": "VehicleNotAvailableError",
  "message": "Veículo abc-123 não está disponível para venda",
  "timestamp": "2026-09-10T18:32:00.000Z"
}
```

---

## Fluxo completo de ponta a ponta

Sequência de uma venda bem-sucedida:

```mermaid
sequenceDiagram
    participant F as Frontend
    participant API as API
    participant PG as Processador<br/>de pagamento
    participant DB as PostgreSQL

    F->>API: POST /vehicles/{id}/sale { buyerCpf }
    API->>API: valida CPF e disponibilidade
    API->>PG: solicita cobrança
    PG-->>API: paymentCode
    API->>DB: Sale(PENDING_PAYMENT) + Vehicle(RESERVED)
    API-->>F: 201 { saleId, paymentCode, saleDate }

    Note over PG: cliente paga (ou desiste)

    PG->>API: POST /payments/webhook { paymentCode, status }
    alt status = PAID
        API->>DB: Sale(PAID) + Vehicle(SOLD)
    else status = CANCELLED
        API->>DB: Sale(CANCELLED) + Vehicle(AVAILABLE)
    end
    API-->>PG: 200 OK
```

Reproduzindo via `curl`:

```bash
# 1. Cadastrar um veículo
VEHICLE_ID=$(curl -s -X POST http://localhost:3000/vehicles \
  -H 'Content-Type: application/json' \
  -d '{"brand":"Volkswagen","model":"Gol","year":2022,"color":"Prata","price":79990}' \
  | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

# 2. Conferir que ele aparece na lista de veículos à venda
curl -s http://localhost:3000/vehicles/available

# 3. Efetuar a venda (guardando o código do pagamento)
PAYMENT_CODE=$(curl -s -X POST http://localhost:3000/vehicles/$VEHICLE_ID/sale \
  -H 'Content-Type: application/json' \
  -d '{"buyerCpf":"529.982.247-25"}' \
  | sed -n 's/.*"paymentCode":"\([^"]*\)".*/\1/p')

# 4. O processador de pagamento confirma o pagamento pelo webhook
curl -s -X POST http://localhost:3000/payments/webhook \
  -H 'Content-Type: application/json' \
  -d "{\"paymentCode\":\"$PAYMENT_CODE\",\"status\":\"PAID\"}"

# 5. O veículo agora está na lista de vendidos
curl -s http://localhost:3000/vehicles/sold
```

Trocando `PAID` por `CANCELLED` no passo 4, o veículo reaparece em `/vehicles/available`.

---

## Como testar

### Testes unitários (não exigem banco)

```bash
npm test           # executa a suíte
npm run test:cov   # com relatório de cobertura
```

Cobrem as entidades de domínio, o Value Object `Cpf` e todos os casos de uso, usando repositórios
fake em memória ([`in-memory-repositories.ts`](src/application/use-cases/__mocks__/in-memory-repositories.ts))
— a prova prática de que a camada de aplicação não depende de banco, de rede nem do framework.

### Testes end-to-end (exigem PostgreSQL)

```bash
docker compose up -d db
cp .env.example .env
npx prisma migrate deploy
npm run test:e2e
```

Exercitam a API real de ponta a ponta (HTTP → controller → caso de uso → Prisma → PostgreSQL),
incluindo o fluxo completo de venda com confirmação e com cancelamento de pagamento.

---

## Implantação em Kubernetes

Os manifestos estão em [`k8s/`](k8s/), numerados na ordem de aplicação:

| Arquivo | Recursos | Papel |
|---|---|---|
| `00-namespace.yaml` | Namespace | Isolamento lógico da solução |
| `01-configmap.yaml` | ConfigMap | Configuração não sensível (host/porta/base/usuário, `NODE_ENV`, `PORT`) |
| `02-secret.yaml` | Secret | Senha do banco |
| `03-postgres.yaml` | PVC + Deployment + Service | Banco com volume persistente, exposto apenas internamente (ClusterIP) |
| `04-api.yaml` | Deployment + Service | API com 2 réplicas, probes, limites de recursos e NodePort |
| `05-hpa.yaml` | HorizontalPodAutoscaler | Escala de 2 a 10 réplicas por CPU/memória |

### Subindo com minikube

```bash
minikube start
minikube addons enable metrics-server   # necessário para o HPA

./k8s/deploy.sh                         # build da imagem + apply + espera o rollout
```

Ou manualmente:

```bash
eval $(minikube docker-env)             # builda direto no daemon do cluster
docker build -t vehicle-sales-api:latest .
kubectl apply -f k8s/
kubectl -n vehicle-sales rollout status deployment/vehicle-sales-api
```

Acessando a API:

```bash
kubectl -n vehicle-sales port-forward svc/vehicle-sales-api-service 3000:80
# Swagger em http://localhost:3000/docs
```

Verificando o estado da solução:

```bash
kubectl -n vehicle-sales get all
kubectl -n vehicle-sales get configmap,secret
kubectl -n vehicle-sales logs -l app=vehicle-sales-api --tail=50
kubectl -n vehicle-sales get hpa
```

Para remover tudo: `./k8s/cleanup.sh`.

A solução foi verificada em um cluster minikube real: rollout de todas as réplicas, migrations
aplicadas pelo initContainer, fluxo de negócio completo através do Service, persistência dos dados
após a destruição do pod do PostgreSQL, HPA coletando métricas de CPU e memória, e **445 requisições
sem nenhuma falha durante um rolling update completo**. As evidências e o método de medição estão em
[`k8s/README.md`](k8s/README.md#validação-executada-no-cluster).

### Decisões relevantes dos manifestos

- **Migrations em `initContainer`**: rodam uma vez por rollout, antes de qualquer réplica subir, em
  vez de em cada réplica — elimina a disputa pelo schema na inicialização. Um segundo initContainer
  (`wait-for-db`) garante que o banco já aceita conexões.
- **Separação ConfigMap × Secret**: nenhum dado sensível no ConfigMap; a `DATABASE_URL` é montada em
  runtime a partir da composição das duas fontes.
- **Probes distintas**: `/health` (liveness) não toca no banco — reiniciar o pod não resolveria uma
  queda do PostgreSQL; `/health/ready` (readiness) valida a conexão e tira o pod do balanceamento
  enquanto o banco estiver indisponível.
- **Banco como ClusterIP**: o PostgreSQL nunca é exposto para fora do cluster.

---

## Estrutura do repositório

```
.
├── src/
│   ├── domain/                        # 💛 Regras de negócio puras (sem framework, sem I/O)
│   │   ├── vehicle/                   #    Entidade Vehicle + erros
│   │   ├── sale/                      #    Entidade Sale + erros
│   │   ├── shared/value-objects/      #    Value Object Cpf
│   │   └── common/errors.ts           #    Hierarquia de erros de domínio
│   ├── application/                   # ⚙️ Casos de uso e contratos
│   │   ├── ports/                     #    Interfaces (repositórios, gateway, unit of work)
│   │   └── use-cases/                 #    Um caso de uso por arquivo
│   └── infrastructure/                # 🔌 Detalhes substituíveis
│       ├── http/                      #    Controllers, DTOs, filtro de exceções, Swagger
│       ├── persistence/               #    Prisma, repositórios e Unit of Work
│       └── payment/                   #    Adapter do gateway de pagamento
├── prisma/                            # Schema, migrations e seed
├── k8s/                               # Manifestos Kubernetes
├── test/e2e/                          # Testes end-to-end
├── docs/ARCHITECTURE.md               # Documento de arquitetura detalhado
├── Dockerfile                         # Build multi-stage da aplicação
└── docker-compose.yml                 # Stack local completa
```

---

## Decisões de arquitetura

Resumo das escolhas não óbvias (o racional completo está em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

1. **Estado `RESERVED` intermediário.** Sem ele, seria impossível responder corretamente às duas
   listagens durante o intervalo entre a venda e a confirmação do pagamento: o veículo não está mais
   à venda, mas também ainda não foi vendido.
2. **`paymentCode` como chave da integração.** O enunciado pede que o webhook opere *"a partir do
   código do pagamento"*. Esse código é gerado pelo gateway e guardado na venda com índice único —
   é ele que liga o mundo externo ao agregado interno, sem expor ids internos ao parceiro.
3. **Gateway de pagamento atrás de uma porta.** `IPaymentGateway` isola o provedor; hoje há um
   adapter mock, amanhã um adapter HTTP real, sem tocar em regra de negócio.
4. **CPF como Value Object.** Validação de dígitos verificadores acontece na construção: é
   impossível existir um `Sale` com CPF inválido no sistema.
5. **Entidades imutáveis.** Transições retornam novas instâncias, o que torna o fluxo de estados
   explícito e livre de efeitos colaterais acidentais.
6. **Listagem de vendidos sem o CPF do comprador.** Dado pessoal (LGPD) não é exposto em endpoint de
   catálogo; ele só aparece na resposta da própria operação de venda.
7. **`saleDate` definida pelo servidor.** Data de venda é fato do sistema, não entrada do cliente.
8. **Webhook idempotente por rejeição.** Reentrega de notificação não corrompe o estado da venda.
