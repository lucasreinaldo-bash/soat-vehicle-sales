# Documento de Arquitetura

Plataforma de Revenda de Veículos — Tech Challenge Fase 2 (SOAT PósTech)

Este documento detalha as decisões técnicas da solução: como Clean Architecture e SOLID foram
aplicados de forma prescritiva, por que o domínio foi modelado desta maneira, quais trade-offs foram
aceitos conscientemente e o que mudaria em um cenário de produção real.

---

## 1. Visão geral

A plataforma resolve um problema de negócio com uma característica que domina toda a arquitetura:
**a venda de um veículo não é um evento instantâneo**. Ela começa quando o comprador se compromete
e só termina quando um terceiro (o processador de pagamento) confirma o recebimento — algo que
acontece fora do nosso controle, em um momento que não podemos prever, através de uma notificação
assíncrona (webhook).

Toda a modelagem decorre dessa constatação.

---

## 2. Camadas e a regra da dependência

A solução segue Clean Architecture com três camadas. A regra é absoluta: **o código-fonte só pode
depender para dentro**.

```
┌──────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE (src/infrastructure)                         │
│  Controllers HTTP · DTOs · Swagger · ExceptionFilter         │
│  Prisma · Repositórios · Unit of Work · Payment Adapter      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  APPLICATION (src/application)                         │  │
│  │  Use Cases (orquestração) · Ports (interfaces)         │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  DOMAIN (src/domain)                             │  │  │
│  │  │  Entities: Vehicle, Sale                         │  │  │
│  │  │  Value Objects: Cpf                              │  │  │
│  │  │  Domain Errors                                   │  │  │
│  │  │  ← não importa NADA das camadas externas         │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Domain (`src/domain`)

Contém as regras que existiriam mesmo que a revenda operasse em papel: o que é um veículo válido,
quais transições de estado são permitidas, o que torna um CPF legítimo.

**O que existe aqui:** entidades (`Vehicle`, `Sale`), Value Object (`Cpf`) e a hierarquia de erros
de domínio (`NotFoundError`, `ValidationError`, `ConflictError`).

**O que NÃO existe aqui:** nenhum import de NestJS, de Express, de HTTP, de Prisma. A única
dependência externa é o tipo `Decimal` do runtime do Prisma, usado para aritmética monetária exata —
um pragmatismo consciente, discutido na seção 6.3.

Características de projeto:

- **Entidades imutáveis.** Toda transição (`reserve()`, `markAsSold()`, `update()`) retorna uma nova
  instância em vez de mutar a atual. O estado anterior continua válido e legível, o que elimina
  efeitos colaterais acidentais e torna o fluxo de estados explícito no código.
- **Construtor privado + factories nomeadas.** `Vehicle.create()` valida invariantes e é o único
  caminho para nascer um veículo novo; `Vehicle.restore()` reconstrói a partir do banco sem
  revalidar (os dados já foram validados quando entraram). Não é possível instanciar uma entidade
  em estado inválido.
- **Validação na fronteira do tipo.** `Cpf.create()` roda o algoritmo de dígitos verificadores e
  lança se falhar. Como `Sale.create()` exige um `Cpf` (não uma `string`), é **estruturalmente
  impossível** existir uma venda com CPF inválido no sistema.

### 2.2 Application (`src/application`)

Orquestra o domínio para cumprir um caso de uso. Cada caso de uso é uma classe com um único método
`execute()`, um arquivo, uma responsabilidade.

**Ports** (`src/application/ports/`) são as interfaces que a aplicação declara para o mundo externo:

| Porta | Contrato |
|---|---|
| `IVehicleRepository` | Persistir e consultar veículos |
| `ISaleRepository` | Persistir e consultar vendas |
| `IPaymentGateway` | Solicitar uma cobrança ao processador de pagamento |
| `IUnitOfWork` | Executar escritas em múltiplos agregados de forma atômica |

Essas interfaces pertencem à **camada de aplicação**, não à infraestrutura. Essa inversão é o ponto
central: quem define o contrato é quem consome, não quem implementa.

### 2.3 Infrastructure (`src/infrastructure`)

Tudo que é detalhe substituível: o fato de a entrada ser HTTP (poderia ser gRPC ou uma fila), de o
banco ser PostgreSQL via Prisma (poderia ser DynamoDB), de o pagamento ser um mock (será um provedor
real).

Os **módulos de composição** são o único lugar onde abstração e implementação se encontram:

```typescript
// src/infrastructure/persistence/persistence.module.ts
providers: [
  { provide: VEHICLE_REPOSITORY_TOKEN, useClass: PrismaVehicleRepository },
  { provide: SALE_REPOSITORY_TOKEN,    useClass: PrismaSaleRepository },
  { provide: UNIT_OF_WORK_TOKEN,       useClass: PrismaUnitOfWork },
]
```

Trocar de banco é trocar essas três linhas.

---

## 3. SOLID, com evidência no código

Princípios citados sem evidência são decoração. Abaixo, cada um com o ponto exato onde se manifesta
e o que ele compra.

### Single Responsibility Principle

Cada caso de uso tem uma razão para mudar. `SellVehicleUseCase` muda se as regras de venda mudarem;
`ProcessPaymentWebhookUseCase` muda se o protocolo de confirmação mudar. São arquivos diferentes
porque são decisões de negócio diferentes.

Os controllers não contêm regra alguma — traduzem HTTP para caso de uso e domínio para DTO. O
`DomainExceptionFilter` centraliza a tradução erro → status HTTP, de modo que nenhum controller
precisa de `try/catch`.

### Open/Closed Principle

Integrar um provedor de pagamento real significa **adicionar** uma classe:

```typescript
export class MercadoPagoAdapter implements IPaymentGateway { /* HTTP real */ }
```

e trocar o `useClass` no módulo. Nenhum caso de uso, nenhuma entidade, nenhum teste de domínio é
alterado. O mesmo vale para trocar o ORM ou adicionar um segundo canal de entrada.

### Liskov Substitution Principle

Existem duas implementações reais de cada porta de repositório: a Prisma (produção) e a em memória
(testes). Os casos de uso funcionam identicamente com ambas — os testes unitários são a prova
executável dessa substituibilidade. Se algum repositório violasse o contrato, os testes de caso de
uso passariam e os e2e quebrariam; ambos rodam.

### Interface Segregation Principle

`IPaymentGateway` tem exatamente um método. Os repositórios expõem apenas o que os casos de uso
consomem — não há um `IRepository<T>` genérico com vinte métodos dos quais se usam três. Um
adapter de pagamento não é obrigado a implementar nada que não precise.

### Dependency Inversion Principle

Nenhum arquivo em `src/application/` ou `src/domain/` importa de `src/infrastructure/`. A verificação
é mecânica:

```bash
grep -r "infrastructure" src/domain src/application   # não retorna nada
```

Os casos de uso recebem suas dependências por construtor, referenciando apenas interfaces.

---

## 4. Modelagem do domínio: as decisões

### 4.1 Por que existe o estado `RESERVED`

O enunciado pede duas listagens: veículos **à venda** e veículos **vendidos**. Existe um intervalo —
entre o comprador fechar negócio e o pagamento ser confirmado — em que o veículo não pertence a
nenhuma das duas. Ele não está mais à venda (seria vendê-lo duas vezes) e não foi vendido (o
dinheiro não entrou).

Modelar isso com um booleano `sold` produziria um sistema incorreto: ou o veículo continuaria sendo
oferecido durante o pagamento, permitindo venda em duplicidade, ou apareceria como vendido sem
nunca ter sido pago. O terceiro estado não é sofisticação — é a representação fiel do negócio.

```
AVAILABLE ──venda──> RESERVED ──webhook PAID──────> SOLD
                         │
                         └────webhook CANCELLED───> AVAILABLE
```

### 4.2 Por que o `paymentCode` vive na venda

O enunciado especifica que o webhook identifica o pagamento *"a partir do código do pagamento"*.
Esse código é gerado pelo gateway e persistido na `Sale` com índice único. Consequências:

- O parceiro externo nunca conhece nossos identificadores internos — acoplamento mínimo.
- A busca do webhook (`findByPaymentCode`) é O(log n) por índice, não uma varredura.
- A unicidade é garantida pelo banco, não por convenção.

### 4.3 Por que o pagamento cancelado devolve o veículo ao catálogo

Um pagamento recusado não é o fim do veículo — é o fim daquela tentativa de venda. O veículo volta a
`AVAILABLE` e pode ser vendido para outra pessoa; a `Sale` cancelada permanece no banco como
registro histórico. Há um teste explícito para esse ciclo completo (venda → cancelamento → nova
venda → confirmação).

### 4.4 Por que a data da venda não vem do cliente

O enunciado lista "data da venda" como dado da venda. A implementação a atribui no servidor
(`Sale.create()` usa o instante corrente) em vez de aceitá-la no corpo da requisição. Uma data de
venda é um **fato observado pelo sistema**, não uma preferência do chamador; aceitá-la de fora
abriria espaço para inconsistências e adulteração, sem nenhum ganho funcional.

### 4.5 Por que o preço é copiado para a venda

`Sale.price` guarda o preço no instante da venda. O preço de tabela do veículo pode ser editado
depois (e um veículo cuja venda foi cancelada frequentemente é reprecificado). Sem essa cópia, o
histórico financeiro mudaria retroativamente a cada edição de catálogo.

### 4.6 Por que a listagem de vendidos não expõe o CPF

CPF é dado pessoal sob a LGPD. Um endpoint de catálogo — consumido por qualquer tela pública de
"veículos vendidos" — não tem propósito legítimo para expor o CPF do comprador. Ele é retornado
apenas na resposta da própria operação de venda, para quem a executou.

---

## 5. Consistência transacional

Tanto a venda quanto o webhook alteram **dois agregados** (`Sale` e `Vehicle`) na mesma operação de
negócio. Sem atomicidade, uma falha entre as duas escritas deixaria o sistema em estado
inconsistente — por exemplo, uma venda registrada com o veículo ainda anunciado como disponível.

A solução é o padrão **Unit of Work**, declarado como porta na camada de aplicação e implementado
sobre `prisma.$transaction`:

```typescript
return this.unitOfWork.execute(async ({ vehicles, sales }) => {
  const current = await vehicles.findById(input.vehicleId);
  if (!current?.isAvailable()) throw new VehicleNotAvailableError(input.vehicleId);

  const savedSale = await sales.save(sale);
  await vehicles.update(current.reserve());
  return { sale: savedSale, paymentCode };
});
```

Duas decisões de ordenação merecem destaque:

1. **A chamada ao gateway de pagamento acontece fora da transação.** Manter uma transação aberta
   durante I/O de rede prenderia conexões e locks do banco por tempo indeterminado, refém da
   latência de um terceiro. É um dos erros mais comuns nesse tipo de integração.
2. **A disponibilidade do veículo é revalidada dentro da transação.** Entre a leitura inicial e a
   escrita, outra requisição pode ter reservado o mesmo veículo. A revalidação fecha essa janela.

**Limite conhecido:** com o nível de isolamento padrão do PostgreSQL (Read Committed), a
revalidação reduz drasticamente, mas não elimina teoricamente, a janela de corrida sob altíssima
concorrência. A evolução natural seria um `SELECT ... FOR UPDATE` na leitura do veículo dentro da
transação, ou uma coluna de versão para bloqueio otimista. Para a escala deste desafio, a
revalidação transacional é proporcional ao problema — e está documentada em vez de escondida.

---

## 6. Trade-offs assumidos

### 6.1 NestJS na camada de aplicação

Os casos de uso carregam decorators `@Injectable()` e `@Inject()`, o que é um acoplamento ao
framework em uma camada que, em uma leitura purista de Clean Architecture, deveria ser agnóstica.

**Por que foi aceito:** o acoplamento é puramente declarativo — metadados que o Nest lê para montar
o grafo de dependências. Os casos de uso continuam instanciáveis com `new` e testáveis sem
framework algum, como os testes unitários demonstram (nenhum deles inicializa um módulo Nest). A
alternativa — uma fábrica manual de injeção — adicionaria código de infraestrutura sem ganho
prático de isolamento.

### 6.2 Um agregado, um repositório

`Vehicle` e `Sale` são agregados distintos, cada um com seu repositório, ligados por `vehicleId` em
vez de uma referência de objeto. Isso mantém os agregados pequenos e as transições de estado
independentes, ao custo de exigir o Unit of Work quando os dois precisam mudar juntos — um custo
que vale a granularidade.

### 6.3 `Decimal` do Prisma no domínio

Valores monetários exigem aritmética decimal exata (`0.1 + 0.2 !== 0.3` em ponto flutuante). Usar o
`Decimal` do runtime do Prisma introduz um import de biblioteca externa no domínio. A alternativa
canônica seria um Value Object `Money` próprio, encapsulando a biblioteca.

**Por que foi aceito:** é uma dependência de *tipo de dado*, não de infraestrutura — não carrega
conexão, I/O nem estado. Se um dia essa escolha incomodar, introduzir `Money` é uma refatoração
local e mecânica, porque o tipo já está confinado às entidades.

### 6.4 Gateway de pagamento mock

Não há um provedor real de pagamento no escopo do desafio. O `MockPaymentGatewayAdapter` gera um
código de cobrança e não faz I/O. O que importa arquiteturalmente é que ele está **atrás de uma
porta**: o mock e um adapter real são intercambiáveis sem que uma linha de regra de negócio mude.

### 6.5 Webhook sem autenticação

O endpoint `POST /payments/webhook` está aberto. Em produção isso seria inaceitável: um webhook de
pagamento precisa de verificação de assinatura HMAC do corpo da requisição, validação de origem e
proteção contra replay por timestamp. Foi deixado fora porque o enunciado não define um contrato de
autenticação com a entidade de pagamento, e inventar um seria adivinhar. O ponto de extensão é
óbvio: um `Guard` do Nest aplicado ao controller, sem tocar no caso de uso.

---

## 7. Estratégia de testes

| Nível | Escopo | Dependências externas | Onde |
|---|---|---|---|
| Unitário — domínio | Invariantes das entidades, algoritmo do CPF, transições de estado | Nenhuma | `src/domain/**/*.spec.ts` |
| Unitário — aplicação | Orquestração dos casos de uso, regras de conflito, ordenação | Repositórios fake em memória | `src/application/**/*.spec.ts` |
| End-to-end | Fluxo real HTTP → controller → caso de uso → Prisma → PostgreSQL | PostgreSQL | `test/e2e/` |

A pirâmide é intencional: a base cobre as regras de negócio (rápida, sem I/O, executável em
qualquer máquina sem setup) e o topo confirma que a fiação entre as camadas está correta. Cenários
cobertos nos e2e incluem o fluxo completo de venda com confirmação, com cancelamento e recolocação
no catálogo, tentativa de venda duplicada, CPF inválido, reprocessamento de webhook e edição de
veículo vendido.

---

## 8. Decisões de infraestrutura

### 8.1 Imagem Docker

Build **multi-stage**: o primeiro estágio compila o TypeScript e gera o client do Prisma; o segundo
recebe apenas `dist/`, `node_modules` de produção (após `npm prune --omit=dev`) e o schema. O
resultado é uma imagem menor, sem toolchain de build, executando como usuário **não-root**.

### 8.2 Migrations

No Docker Compose, o `CMD` da imagem roda `prisma migrate deploy` antes de subir a API — um único
container, sem disputa.

No Kubernetes, com múltiplas réplicas, isso seria uma corrida: N pods aplicando o mesmo schema
simultaneamente. A solução é um **initContainer** `run-migrations`, que executa uma vez por rollout
antes de qualquer réplica iniciar, precedido de um initContainer `wait-for-db` que aguarda o
PostgreSQL aceitar conexões.

### 8.3 Probes com propósitos distintos

- `/health` (**liveness**) responde sem tocar no banco. Se o PostgreSQL cair, reiniciar os pods da
  API não resolve nada — só multiplica o dano. Liveness deve detectar processo travado, não
  dependência indisponível.
- `/health/ready` (**readiness**) executa `SELECT 1`. Sem banco, o pod sai do balanceamento do
  Service e para de receber tráfego, voltando sozinho quando o banco retornar.

Essa distinção é frequentemente ignorada, e o resultado é um cluster em crash-loop durante
incidentes de banco.

### 8.4 ConfigMap e Secret

Configuração não sensível (host, porta, nome do banco, usuário, `NODE_ENV`) fica no **ConfigMap**; a
senha fica no **Secret**. A `DATABASE_URL` é composta em runtime a partir das duas fontes, para que
a senha nunca apareça em um manifesto de configuração.

O `Secret` está versionado no repositório **apenas para reprodutibilidade da avaliação** — o próprio
arquivo documenta que, em produção, o correto é Sealed Secrets, External Secrets Operator ou um
cofre gerenciado.

---

## 9. Evolução natural

Ordenado por retorno sobre esforço, caso a plataforma fosse para produção:

1. **Autenticação e autorização** — JWT/OIDC separando o público (catálogo) do operador da revenda
   (cadastro, edição, venda).
2. **Assinatura HMAC no webhook** — verificação de origem, conforme seção 6.5.
3. **Adapter de pagamento real** — substituição do mock, com retry, timeout e circuit breaker.
4. **Bloqueio pessimista ou otimista na reserva** — conforme seção 5.
5. **Observabilidade** — logging estruturado com correlation id, métricas Prometheus e tracing
   distribuído, especialmente no salto assíncrono entre venda e webhook.
6. **Paginação nas listagens** — o catálogo cresce; `GET /vehicles/available` precisará de
   paginação por cursor.
7. **Outbox pattern** — se a confirmação de venda passar a disparar efeitos externos (e-mail,
   emissão de nota fiscal), publicar eventos de forma transacionalmente consistente com a escrita.
