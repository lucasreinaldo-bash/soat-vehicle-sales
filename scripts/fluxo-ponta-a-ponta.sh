#!/usr/bin/env bash
# Teste de contrato e de ponta a ponta contra o serviço de identidade REAL
# (Keycloak), sem nenhum dublê: cadastro do cliente, cadastro do veículo,
# compra e efetivação da compra pelo webhook assinado.
#
# Uso: ./scripts/fluxo-ponta-a-ponta.sh   (com as duas stacks no ar)
#
# Variáveis opcionais:
#   API_URL                 padrão http://localhost:3000
#   KC_URL                  padrão http://localhost:8180
#   KC_ADMIN_USER           padrão admin
#   KC_ADMIN_PASSWORD       padrão admin
#   PAYMENT_WEBHOOK_SECRET  padrão segredo-webhook-desenvolvimento
set -euo pipefail

API="${API_URL:-http://localhost:3000}"
KC="${KC_URL:-http://localhost:8180}"
REALM="vehicle-sales"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ok=0; falhas=0
passou(){ echo "  ✓ $1"; ok=$((ok+1)); }
falhou(){ echo "  ✗ $1"; falhas=$((falhas+1)); }
confere(){ [ "$2" = "$3" ] && passou "$1" || falhou "$1 (obtido '$2', esperado '$3')"; }
status_de(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
token_de(){ curl -s -X POST "$KC/realms/$REALM/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=vehicle-sales-cli \
  --data-urlencode "username=$1" --data-urlencode "password=$2" | jq -r '.access_token // empty'; }
sub_de(){ python3 -c 'import sys,json,base64
p=sys.argv[1].split(".")[1]; p+="="*(-len(p)%4)
print(json.loads(base64.urlsafe_b64decode(p))["sub"])' "$1"; }

echo "== 1. Cadastro do cliente no serviço de identidade"
MT=$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli \
  --data-urlencode "username=${KC_ADMIN_USER:-admin}" \
  --data-urlencode "password=${KC_ADMIN_PASSWORD:-admin}" | jq -r .access_token)
EMAIL="comprador.$(date +%s)$RANDOM@teste.com"
COD=$(status_de -X POST "$KC/admin/realms/$REALM/users" -H "Authorization: Bearer $MT" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$EMAIL\",\"email\":\"$EMAIL\",\"firstName\":\"Ana\",\"lastName\":\"Costa\",\"enabled\":true,\"emailVerified\":true,\"attributes\":{\"cpf\":[\"52998224725\"]},\"credentials\":[{\"type\":\"password\",\"value\":\"senha12345\",\"temporary\":false}]}")
confere "cliente cadastrado" "$COD" "201"

ADMIN=$(token_de "admin@revenda.com" "admin12345")
CLIENTE=$(token_de "$EMAIL" "senha12345")
[ -n "$ADMIN" ] && [ -n "$CLIENTE" ] && passou "tokens do operador e do cliente emitidos" || { falhou "tokens não emitidos"; exit 1; }

echo "== 2. Operador cadastra um veículo"
V=$(curl -s -X POST "$API/vehicles" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"brand":"Chevrolet","model":"Onix","year":2023,"color":"Branco","price":89900}')
VID=$(echo "$V" | jq -r '.id // empty')
confere "veículo cadastrado como AVAILABLE" "$(echo "$V" | jq -r .status)" "AVAILABLE"
confere "cliente não cadastra veículo" "$(status_de -X POST "$API/vehicles" -H "Authorization: Bearer $CLIENTE" -H 'Content-Type: application/json' -d '{"brand":"X","model":"Y","year":2020,"color":"Z","price":1}')" "403"
echo "$(curl -s "$API/vehicles/available")" | jq -e --arg id "$VID" 'map(.id) | index($id)' >/dev/null \
  && passou "veículo aparece na lista de à venda" || falhou "veículo ausente da lista de à venda"

echo "== 3. Compra"
confere "compra sem token" "$(status_de -X POST "$API/vehicles/$VID/purchase")" "401"
confere "compra pelo operador (sem papel customer)" "$(status_de -X POST "$API/vehicles/$VID/purchase" -H "Authorization: Bearer $ADMIN")" "403"
C=$(curl -s -X POST "$API/vehicles/$VID/purchase" -H "Authorization: Bearer $CLIENTE")
PC=$(echo "$C" | jq -r '.paymentCode // empty')
confere "compra do cliente aguardando pagamento" "$(echo "$C" | jq -r .status)" "PENDING_PAYMENT"
confere "veículo reservado" "$(curl -s "$API/vehicles/$VID" | jq -r .status)" "RESERVED"
echo "$C" | jq -e 'tostring | test("52998224725|cpf"; "i") | not' >/dev/null \
  && passou "resposta da compra sem dado pessoal" || falhou "resposta da compra traz dado pessoal"

echo "== 4. Efetivação da compra (webhook assinado)"
COD=$(PAYMENT_WEBHOOK_SECRET=segredo-que-nao-e-o-da-api "$DIR/simular-pagamento.sh" "$PC" PAID 2>/dev/null | jq -r .statusCode)
confere "webhook com segredo errado é recusado" "$COD" "401"
confere "pagamento confirmado" "$("$DIR/simular-pagamento.sh" "$PC" PAID 2>/dev/null | jq -r .status)" "PAID"
confere "veículo vendido" "$(curl -s "$API/vehicles/$VID" | jq -r .status)" "SOLD"
curl -s "$API/vehicles/sold" | jq -e --arg id "$VID" 'map(.id) | index($id)' >/dev/null \
  && passou "veículo aparece na lista de vendidos" || falhou "veículo ausente da lista de vendidos"

echo "== 5. Área do cliente"
M=$(curl -s "$API/me/purchases" -H "Authorization: Bearer $CLIENTE")
confere "cliente vê a própria compra como PAID" "$(echo "$M" | jq -r --arg id "$VID" 'map(select(.vehicle.id==$id))[0].status')" "PAID"
confere "operador não acessa a área do cliente" "$(status_de "$API/me/purchases" -H "Authorization: Bearer $ADMIN")" "403"

echo
echo "Comprador no token (sub): $(sub_de "$CLIENTE")"
echo "Resultado: $ok aprovados, $falhas falhas"
[ "$falhas" -eq 0 ]
