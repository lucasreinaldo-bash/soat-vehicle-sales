#!/usr/bin/env bash
# Sobe a solução completa em um cluster Kubernetes local (minikube/kind/Docker Desktop).
set -euo pipefail

NAMESPACE="vehicle-sales"
IMAGE="vehicle-sales-api:latest"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/4 Construindo a imagem da API (${IMAGE})"
if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
  # Constrói direto no daemon do minikube: dispensa registry e `imagePullPolicy: Always`.
  echo "    (usando o daemon Docker do minikube)"
  eval "$(minikube docker-env)"
fi
docker build -t "${IMAGE}" "${ROOT_DIR}"

echo "==> 2/4 Aplicando os manifestos"
kubectl apply -f "${ROOT_DIR}/k8s/00-namespace.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/01-configmap.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/02-secret.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/03-postgres.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/04-api.yaml"
kubectl apply -f "${ROOT_DIR}/k8s/05-hpa.yaml" || echo "    (HPA ignorado: metrics-server indisponível)"

echo "==> 3/4 Aguardando o PostgreSQL ficar pronto"
kubectl -n "${NAMESPACE}" rollout status deployment/postgres --timeout=180s

echo "==> 4/4 Aguardando a API ficar pronta"
kubectl -n "${NAMESPACE}" rollout status deployment/vehicle-sales-api --timeout=240s

echo
kubectl -n "${NAMESPACE}" get all
echo
echo "API publicada. Para acessar:"
echo "  kubectl -n ${NAMESPACE} port-forward svc/vehicle-sales-api-service 3000:80"
echo "  Swagger: http://localhost:3000/docs"
