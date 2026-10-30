# Documento de Arquitetura

Plataforma de Revenda de Veículos — Tech Challenge Fase 3 (SOAT PósTech)

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

A Fase 3 acrescenta uma segunda força: **só pessoas cadastradas compram, e os dados delas não
pertencem a este serviço**. Cadastro e autenticação foram para um serviço de identidade apartado
(Keycloak, repositório `soat-vehicle-identity`). Esta API passou a ser apenas consumidora de tokens.
A seção 5 detalha essa fronteira.

---

## 2. Camadas e a regra da dependência

A solução segue Clean Architecture com três camadas. A regra é absoluta: **o código-fonte só pode
depender para dentro**.

```
┌──────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE (src/infrastructure)                         │
│  Controllers HTTP · DTOs · Swagger · ExceptionFilter         │
│  Guards: JWT (JWKS) · papéis · assinatura HMAC do webhook    │
│  Prisma · Repositórios · Unit of Work · Payment Adapter      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  APPLICATION (src/application)                         │  │
│  │  Use Cases (orquestração) · Ports (interfaces)         │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  DOMAIN (src/domain)                             │  │  │
│  │  │  Entities: Vehicle, Sale                         │  │  │
│  │  │  Domain Errors                                   │  │  │
│  │  │  ← não importa NADA das camadas externas         │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Domain (`src/domain`)

Contém as regras que existiriam mesmo que a revenda operasse em papel: o que é um veículo válido,
quais transições de estado são permitidas, quando uma venda pode ser confirmada.

**O que existe aqui:** entidades (`Vehicle`, `Sale`) e a hierarquia de erros
de domínio (`NotFoundError`, `ValidationError`, `ConflictError`).

**O que NÃO existe aqui:** nenhum import de NestJS, de Express, de HTTP, de Prisma. A única
dependência externa é o tipo `Decimal` do runtime do Prisma, usado para aritmética monetária exata —
um pragmatismo consciente, discutido na seção 7.3.

Características de projeto:

- **Entidades imutáveis.** Toda transição (`reserve()`, `markAsSold()`, `update()`) retorna uma nova
  instância em vez de mutar a atual. O estado anterior continua válido e legível, o que elimina
  efeitos colaterais acidentais e torna o fluxo de estados explícito no código.
- **Construtor privado + factories nomeadas.** `Vehicle.create()` valida invariantes e é o único
  caminho para nascer um veículo novo; `Vehicle.restore()` reconstrói a partir do banco sem
  revalidar (os dados já foram validados quando entraram). Não é possível instanciar uma entidade
  em estado inválido.
- **Comprador opaco.** `Sale.create()` recebe um `buyerId` e recusa valor vazio
  (`InvalidBuyerError`). O domínio não sabe de onde o identificador vem, nem que é o `sub` de um
  JWT. Na Fase 2 havia um Value Object `Cpf`; ele foi removido junto com o dado pessoal.

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

Cada caso de uso tem uma razão para mudar. `PurchaseVehicleUseCase` muda se as regras de compra mudarem;
`ProcessPaymentWebhookUseCase` muda se o protocolo de confirmação mudar. São arquivos diferentes
porque são decisões de negócio diferentes.

O mesmo vale na borda: `JwtAuthGuard` autentica, `RolesGuard` autoriza e `WebhookSignatureGuard`
verifica a origem do webhook. Cada um pode mudar sem tocar nos outros.

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

### 4.4 Por que a data da compra não vem do cliente

`Sale.create()` usa o instante corrente. Na Fase 2 a data podia ser informada pelo operador, para
lançar vendas fechadas na loja física. Na Fase 3 quem compra é o próprio cliente, pela internet, e
a data da compra é um **fato observado pelo sistema**. Aceitá-la do cliente só abriria espaço para
adulteração.

### 4.5 Por que o preço é copiado para a venda

`Sale.price` guarda o preço no instante da venda. O preço de tabela do veículo pode ser editado
depois (e um veículo cuja venda foi cancelada frequentemente é reprecificado). Sem essa cópia, o
histórico financeiro mudaria retroativamente a cada edição de catálogo.

### 4.6 Por que a venda guarda só o `buyerId`

A venda precisa responder *quem comprou*, não *quais são os dados de quem comprou*. O `sub` do
token é estável, único por pessoa e não carrega significado fora do serviço de identidade. Com
ele, a API resolve tudo o que precisa: vincular a compra ao comprador e listar as compras de cada
cliente.

Guardar o CPF aqui criaria uma segunda cópia de dado pessoal sob a LGPD, com duas fontes da
verdade e dois lugares para proteger. A migration
`20261030000000_buyer_id_sem_cpf` removeu a coluna `buyer_cpf`. As vendas da Fase 2 receberam um
`buyer_id` marcado como legado (`legado-fase-2:<id da venda>`), porque não têm conta no serviço de
identidade.

---

## 5. Identidade apartada e autorização

### 5.1 A fronteira

O enunciado pede que cadastro e autorização do comprador fiquem num serviço **totalmente
apartado**, com os dados do cliente separados dos dados transacionais. A fronteira escolhida:

| Fica no serviço de identidade | Fica nesta API |
|---|---|
| Nome, e-mail, CPF, senha | Veículos, vendas, `buyer_id` |
| Tela de cadastro e login | Validação do token |
| Política de senha, bloqueio por força bruta | Regras de compra |
| Emissão e assinatura de tokens | Autorização por papel |

A API não consulta o Keycloak a cada requisição. Ela baixa as chaves públicas (JWKS), mantém em
cache por até 10 minutos (padrão do `jose`) e valida cada token localmente. Uma queda curta do
Keycloak não derruba as compras de quem já tem token. Quando o cache expira e o JWKS não responde,
a API devolve **503**, não 401: indisponibilidade não é culpa de quem chamou.

### 5.2 Por que Keycloak, e não um serviço próprio

Autenticação é uma área em que erros custam caro: armazenamento de senha, força bruta,
recuperação de conta, rotação de chaves. O Keycloak entrega isso pronto, com OIDC padrão. O
enunciado admite Keycloak, Cognito, Auth0 ou serviço próprio. A API depende apenas do contrato OIDC
(emissor, audiência, JWKS e o formato dos papéis), então trocar de provedor é configuração.

### 5.3 O que a API verifica em cada token

`JwtTokenVerifier` usa a biblioteca `jose` e exige:

- assinatura RS256 válida, por uma chave do JWKS do emissor;
- `iss` igual a `AUTH_ISSUER`, para recusar tokens de outro realm;
- `aud` contendo `AUTH_AUDIENCE`, para recusar tokens emitidos para outra aplicação;
- `exp` no futuro.

O algoritmo é fixado: um token com `alg: none` ou HS256 é recusado. Isso fecha o ataque clássico
de confusão de algoritmo.

### 5.4 Seguro por padrão

`JwtAuthGuard` é registrado como guard **global** (`APP_GUARD`). Toda rota nasce protegida; ficar
pública exige o decorator `@Public()` explícito. O risco que isso elimina é o de esquecer de
proteger uma rota nova. Errar para o lado do 401 é seguro; errar para o lado do acesso aberto, não.

`RolesGuard` roda em seguida e compara `@Roles(...)` com `realm_access.roles` do token.

### 5.5 Dois papéis, separados nos dois sentidos

`admin` cadastra e edita veículos. `customer` compra. O papel `customer` vem do papel padrão do
realm, então todo cliente que se cadastra o recebe automaticamente.

O operador **não** tem `customer`. O Keycloak expande papéis compostos dentro do token, e o papel
padrão inclui `customer`. Se o operador o herdasse, conseguiria comprar pela API. O realm importa o
operador só com `admin`, e o teste de fumaça do repositório de identidade verifica isso.

### 5.6 O caso de uso não sabe o que é um token

O controller extrai o usuário com `@CurrentUser()` e chama
`PurchaseVehicleUseCase.execute({ vehicleId, buyerId })`. O caso de uso recebe uma `string`. Trocar
JWT por sessão, mTLS ou qualquer outra coisa não altera a camada de aplicação.

---

## 6. Consistência transacional

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

## 7. Trade-offs assumidos

### 7.1 NestJS na camada de aplicação

Os casos de uso carregam decorators `@Injectable()` e `@Inject()`, o que é um acoplamento ao
framework em uma camada que, em uma leitura purista de Clean Architecture, deveria ser agnóstica.

**Por que foi aceito:** o acoplamento é puramente declarativo — metadados que o Nest lê para montar
o grafo de dependências. Os casos de uso continuam instanciáveis com `new` e testáveis sem
framework algum, como os testes unitários demonstram (nenhum deles inicializa um módulo Nest). A
alternativa — uma fábrica manual de injeção — adicionaria código de infraestrutura sem ganho
prático de isolamento.

### 7.2 Um agregado, um repositório

`Vehicle` e `Sale` são agregados distintos, cada um com seu repositório, ligados por `vehicleId` em
vez de uma referência de objeto. Isso mantém os agregados pequenos e as transições de estado
independentes, ao custo de exigir o Unit of Work quando os dois precisam mudar juntos — um custo
que vale a granularidade.

### 7.3 `Decimal` do Prisma no domínio

Valores monetários exigem aritmética decimal exata (`0.1 + 0.2 !== 0.3` em ponto flutuante). Usar o
`Decimal` do runtime do Prisma introduz um import de biblioteca externa no domínio. A alternativa
canônica seria um Value Object `Money` próprio, encapsulando a biblioteca.

**Por que foi aceito:** é uma dependência de *tipo de dado*, não de infraestrutura — não carrega
conexão, I/O nem estado. Se um dia essa escolha incomodar, introduzir `Money` é uma refatoração
local e mecânica, porque o tipo já está confinado às entidades.

### 7.4 Gateway de pagamento mock

Não há um provedor real de pagamento no escopo do desafio. O `MockPaymentGatewayAdapter` gera um
código de cobrança e não faz I/O. O que importa arquiteturalmente é que ele está **atrás de uma
porta**: o mock e um adapter real são intercambiáveis sem que uma linha de regra de negócio mude.

### 7.5 Webhook assinado com HMAC, não com JWT

O processador de pagamento é um sistema externo, sem conta no Keycloak. O padrão de mercado para
webhooks (Stripe, Mercado Pago, GitHub) é a assinatura do corpo com um segredo compartilhado, e foi
o adotado. Na Fase 2 o webhook estava aberto; a Fase 3 fechou essa lacuna.

- A assinatura é `HMAC-SHA256(segredo, "<timestamp>.<corpo bruto>")`, enviada em
  `X-Webhook-Signature`, com o timestamp em `X-Webhook-Timestamp`.
- A API verifica sobre os **bytes recebidos** (`rawBody`), não sobre o JSON reserializado. Uma
  diferença de espaço ou de ordem de campos quebraria a assinatura.
- A comparação usa `timingSafeEqual`, para não vazar a assinatura por tempo de resposta.
- Notificações com mais de 5 minutos são recusadas. Como o timestamp está dentro da assinatura,
  não dá para trocá-lo sem invalidá-la.
- A API não sobe sem `PAYMENT_WEBHOOK_SECRET` com pelo menos 16 caracteres.

O limite assumido: dentro da janela de 5 minutos, uma notificação capturada poderia ser reenviada.
O efeito é nulo, porque o webhook é idempotente por rejeição (409 na segunda vez).

---

## 8. Estratégia de testes

| Nível | Escopo | Dependências externas | Onde |
|---|---|---|---|
| Unitário — domínio | Invariantes das entidades e transições de estado | Nenhuma | `src/domain/**/*.spec.ts` |
| Unitário — borda | Verificação de token (assinatura, emissor, audiência, expiração, algoritmo, JWKS fora do ar), guards de papel, assinatura do webhook | Nenhuma (JWKS local) | `src/infrastructure/http/**/*.spec.ts` |
| Unitário — aplicação | Orquestração dos casos de uso, regras de conflito, ordenação | Repositórios fake em memória | `src/application/**/*.spec.ts` |
| End-to-end | Fluxo real HTTP → guards → controller → caso de uso → Prisma → PostgreSQL | PostgreSQL e um emissor JWT local | `test/e2e/` |
| Fumaça da identidade | Realm, papéis, cadastro, conteúdo do token | Keycloak real | repositório `soat-vehicle-identity` |

A pirâmide é intencional: a base cobre as regras de negócio (rápida, sem I/O, executável em
qualquer máquina sem setup) e o topo confirma que a fiação entre as camadas está correta. Cenários
cobertos nos e2e incluem:

- o fluxo completo de compra, com confirmação e com cancelamento;
- compra sem token, com token adulterado e pelo operador;
- disputa entre dois clientes pelo mesmo veículo;
- webhook sem assinatura, com segredo errado, com corpo adulterado e antigo;
- isolamento de `/me/purchases` entre clientes;
- a ausência de coluna de CPF na tabela de vendas.

As proteções foram conferidas também por **mutação**: desligar cada verificação no código fez os
testes correspondentes falharem.

---

## 9. Decisões de infraestrutura

### 9.1 Imagem Docker

Build **multi-stage**: o primeiro estágio compila o TypeScript e gera o client do Prisma; o segundo
recebe apenas `dist/`, `node_modules` de produção (após `npm prune --omit=dev`) e o schema. O
resultado é uma imagem menor, sem toolchain de build, executando como usuário **não-root**.

### 9.2 Migrations

No Docker Compose, o `CMD` da imagem roda `prisma migrate deploy` antes de subir a API — um único
container, sem disputa.

No Kubernetes, com múltiplas réplicas, isso seria uma corrida: N pods aplicando o mesmo schema
simultaneamente. A solução é um **initContainer** `run-migrations`, que executa uma vez por rollout
antes de qualquer réplica iniciar, precedido de um initContainer `wait-for-db` que aguarda o
PostgreSQL aceitar conexões.

### 9.3 Probes com propósitos distintos

- `/health` (**liveness**) responde sem tocar no banco. Se o PostgreSQL cair, reiniciar os pods da
  API não resolve nada — só multiplica o dano. Liveness deve detectar processo travado, não
  dependência indisponível.
- `/health/ready` (**readiness**) executa `SELECT 1`. Sem banco, o pod sai do balanceamento do
  Service e para de receber tráfego, voltando sozinho quando o banco retornar.

Essa distinção é frequentemente ignorada, e o resultado é um cluster em crash-loop durante
incidentes de banco.

### 9.4 ConfigMap e Secret

Configuração não sensível (host, porta, nome do banco, usuário, `NODE_ENV`, emissor e endereço do
JWKS) fica no **ConfigMap**; a senha do banco e o segredo do webhook ficam no **Secret**. A `DATABASE_URL` é composta em runtime a partir das duas fontes, para que
a senha nunca apareça em um manifesto de configuração.

O `Secret` está versionado no repositório **apenas para reprodutibilidade da avaliação** — o próprio
arquivo documenta que, em produção, o correto é Sealed Secrets, External Secrets Operator ou um
cofre gerenciado.

---

## 10. Evolução natural

Ordenado por retorno sobre esforço, caso a plataforma fosse para produção:

1. ~~Autenticação e autorização~~ e ~~assinatura HMAC no webhook~~: entregues na Fase 3
   (seções 5 e 7.5).
2. **Rotação do segredo do webhook** — aceitar dois segredos durante a troca.
3. **Adapter de pagamento real** — substituição do mock, com retry, timeout e circuit breaker.
4. **Bloqueio pessimista ou otimista na reserva** — conforme seção 6.
5. **Observabilidade** — logging estruturado com correlation id, métricas Prometheus e tracing
   distribuído, especialmente no salto assíncrono entre venda e webhook.
6. **Paginação nas listagens** — o catálogo cresce; `GET /vehicles/available` precisará de
   paginação por cursor.
7. **Outbox pattern** — se a confirmação de venda passar a disparar efeitos externos (e-mail,
   emissão de nota fiscal), publicar eventos de forma transacionalmente consistente com a escrita.
