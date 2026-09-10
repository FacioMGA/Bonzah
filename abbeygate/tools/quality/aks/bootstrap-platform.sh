#!/usr/bin/env bash
set -euo pipefail

# Bootstrap shared AKS platform components:
# - namespaces
# - metrics-server
# - cert-manager
# - external-dns (optional)
# - KEDA
# - Key Vault CSI + workload identity
#
# Required env:
#   RESOURCE_GROUP
#   AKS_CLUSTER_NAME
# Optional:
#   INSTALL_EXTERNAL_DNS=true|false (default false)

: "${RESOURCE_GROUP:?Missing RESOURCE_GROUP}"
: "${AKS_CLUSTER_NAME:?Missing AKS_CLUSTER_NAME}"

INSTALL_EXTERNAL_DNS="${INSTALL_EXTERNAL_DNS:-false}"

echo "Fetching AKS credentials"
az aks get-credentials --resource-group "${RESOURCE_GROUP}" --name "${AKS_CLUSTER_NAME}" --overwrite-existing

echo "Creating namespaces"
kubectl create namespace platform-system --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace faciomga-prod --dry-run=client -o yaml | kubectl apply -f -

echo "Installing metrics-server"
if kubectl get deployment metrics-server -n kube-system >/dev/null 2>&1; then
  echo "metrics-server already present in kube-system; skipping Helm install."
else
  helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ >/dev/null
  helm repo update >/dev/null
  helm upgrade --install metrics-server metrics-server/metrics-server \
    --namespace kube-system \
    --set args[0]=--kubelet-insecure-tls
fi

echo "Installing cert-manager"
helm repo add jetstack https://charts.jetstack.io >/dev/null
helm repo update >/dev/null
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true

if [[ "${INSTALL_EXTERNAL_DNS}" == "true" ]]; then
  echo "Installing external-dns"
  helm repo add external-dns https://kubernetes-sigs.github.io/external-dns >/dev/null
  helm repo update >/dev/null
  helm upgrade --install external-dns external-dns/external-dns \
    --namespace platform-system
fi

echo "Installing KEDA"
helm repo add kedacore https://kedacore.github.io/charts >/dev/null
helm repo update >/dev/null
helm upgrade --install keda kedacore/keda \
  --namespace keda \
  --create-namespace

echo "Installing Azure Key Vault CSI driver and provider"
helm repo add csi-secrets-store-provider-azure https://azure.github.io/secrets-store-csi-driver-provider-azure/charts >/dev/null
helm repo update >/dev/null
helm upgrade --install csi csi-secrets-store-provider-azure/csi-secrets-store-provider-azure \
  --namespace kube-system

echo "Platform bootstrap complete."
