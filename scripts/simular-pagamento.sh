#!/usr/bin/env bash
# Simula o processador de pagamento notificando a API pelo webhook, com a
# requisição assinada em HMAC-SHA256 — exatamente como um gateway real faria.
#
# Uso:
#   ./scripts/simular-pagamento.sh <paymentCode> [PAID|CANCELLED]
#
# Variáveis opcionais:
#   API_URL                 padrão http://localhost:3000
#   PAYMENT_WEBHOOK_SECRET  padrão segredo-webhook-desenvolvimento (o do compose)
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Uso: $0 <paymentCode> [PAID|CANCELLED]" >&2
  exit 1
fi

CODIGO="$1"
STATUS="${2:-PAID}"
API="${API_URL:-http://localhost:3000}"
SEGREDO="${PAYMENT_WEBHOOK_SECRET:-segredo-webhook-desenvolvimento}"

case "$STATUS" in
  PAID|CANCELLED) ;;
  *) echo "Status deve ser PAID ou CANCELLED" >&2; exit 1 ;;
esac

# O corpo assinado precisa ser byte a byte o corpo enviado.
CORPO=$(printf '{"paymentCode":"%s","status":"%s"}' "$CODIGO" "$STATUS")
TIMESTAMP=$(date +%s)
ASSINATURA=$(printf '%s.%s' "$TIMESTAMP" "$CORPO" | openssl dgst -sha256 -hmac "$SEGREDO" -hex | sed 's/^.* //')

echo "→ Notificando $STATUS para $CODIGO (assinatura HMAC, timestamp $TIMESTAMP)" >&2
curl -sS -X POST "$API/payments/webhook" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $TIMESTAMP" \
  -H "X-Webhook-Signature: sha256=$ASSINATURA" \
  -d "$CORPO"
echo
