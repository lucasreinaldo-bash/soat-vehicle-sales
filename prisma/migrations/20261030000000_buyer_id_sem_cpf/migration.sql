-- Fase 3: o comprador passa a ser identificado pelo id opaco do serviço de
-- identidade (o `sub` do token). O CPF sai da base transacional de vendas:
-- dados de clientes ficam apartados, no serviço de identidade.

-- 1. Nova coluna, ainda opcional, para poder preencher as linhas existentes.
ALTER TABLE "sales" ADD COLUMN "buyer_id" TEXT;

-- 2. Vendas da Fase 2 foram registradas por CPF, sem conta no serviço de
--    identidade: não há como associá-las a um cliente. Recebem um marcador
--    explícito de origem, em vez de um valor inventado.
UPDATE "sales" SET "buyer_id" = 'legado-fase-2:' || "id";

-- 3. A partir daqui, toda compra tem comprador.
ALTER TABLE "sales" ALTER COLUMN "buyer_id" SET NOT NULL;

-- 4. Remove o dado pessoal da base de vendas.
ALTER TABLE "sales" DROP COLUMN "buyer_cpf";

-- 5. "Minhas compras" filtra por comprador.
CREATE INDEX "sales_buyer_id_idx" ON "sales"("buyer_id");
