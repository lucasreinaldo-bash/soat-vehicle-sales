#!/usr/bin/env bash
# Remove toda a solução do cluster (o Namespace leva junto todos os recursos).
set -euo pipefail

kubectl delete namespace vehicle-sales --ignore-not-found
echo "Namespace vehicle-sales removido."
