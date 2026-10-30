#!/usr/bin/env bash
# Verificação pós-deploy no cluster, executada pelo pipeline de CD.
#
# Só leitura: confirma que a versão publicada responde e que valida tokens
# REAIS do Keycloak publicado no namespace vehicle-identity, sem criar dados
# no catálogo a cada deploy.
set -euo pipefail

ESPERADA="${1:?uso: $0 <imagem esperada>}"
NS_API="vehicle-sales"
NS_ID="vehicle-identity"
P_API=13000
P_KC=18180

ok=0; falhas=0
passou(){ echo "  ✓ $1"; ok=$((ok+1)); }
falhou(){ echo "  ✗ $1"; falhas=$((falhas+1)); }
confere(){ [ "$2" = "$3" ] && passou "$1" || falhou "$1 (obtido '$2', esperado '$3')"; }
status_de(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }

kubectl -n "$NS_API" port-forward svc/vehicle-sales-api-service "$P_API:80" >/dev/null 2>&1 &
PF1=$!
kubectl -n "$NS_ID" port-forward svc/keycloak "$P_KC:8080" >/dev/null 2>&1 &
PF2=$!
trap 'kill $PF1 $PF2 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  [ "$(status_de "http://localhost:$P_API/health")" = "200" ] && [ "$(status_de "http://localhost:$P_KC/realms/vehicle-sales")" = "200" ] && break
  sleep 1
done
API="http://localhost:$P_API"

echo "== Versão publicada"
IMG=$(kubectl -n "$NS_API" get deploy vehicle-sales-api -o jsonpath='{.spec.template.spec.containers[0].image}')
confere "Deployment usa a imagem do commit" "$IMG" "$ESPERADA"
PRONTAS=$(kubectl -n "$NS_API" get deploy vehicle-sales-api -o jsonpath='{.status.updatedReplicas}/{.status.readyReplicas}/{.spec.replicas}')
R=$(kubectl -n "$NS_API" get deploy vehicle-sales-api -o jsonpath='{.spec.replicas}')
confere "todas as réplicas atualizadas e prontas" "$PRONTAS" "$R/$R/$R"

echo "== Saúde"
confere "liveness" "$(status_de "$API/health")" "200"
confere "readiness (banco acessível)" "$(status_de "$API/health/ready")" "200"
confere "catálogo público" "$(status_de "$API/vehicles/available")" "200"

echo "== Integração com o serviço de identidade"
T=$(curl -s -X POST "http://localhost:$P_KC/realms/vehicle-sales/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=vehicle-sales-cli \
  -d username=admin@revenda.com -d password=admin12345 | jq -r '.access_token // empty')
[ -n "$T" ] && passou "token real emitido pelo Keycloak do cluster" || falhou "Keycloak não emitiu token"
confere "rota protegida sem token" "$(status_de -X POST "$API/vehicles/00000000-0000-0000-0000-000000000000/purchase")" "401"
# 403, e não 401: a API buscou as chaves no Keycloak, validou assinatura,
# emissor e audiência, e só então recusou pelo papel.
confere "token real validado pela API (operador sem papel customer)" \
  "$(status_de -X POST "$API/vehicles/00000000-0000-0000-0000-000000000000/purchase" -H "Authorization: Bearer $T")" "403"

echo
echo "Resultado: $ok aprovados, $falhas falhas"
[ "$falhas" -eq 0 ]
