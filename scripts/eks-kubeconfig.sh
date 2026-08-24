#!/bin/sh
# Write a kubeconfig for a Floci-emulated EKS cluster.
#
# The console has a "Download kubeconfig" button in the cluster inspector; this
# is the same thing for a terminal, and needs no console auth because it reads
# the runtime's EKS API directly.
#
# Everything comes from DescribeCluster: the endpoint and the cluster CA. The
# bearer token is not a secret — the cluster's authentication-token-webhook
# points back at the runtime, which accepts any `k8s-aws-v1.` token and maps it
# to `floci:aws-iam` in `system:masters`. Real EKS would require an
# `aws eks get-token` credential here; the runtime has no equivalent.
#
#   Usage: scripts/eks-kubeconfig.sh <cluster-name> [output-path]
#
#   scripts/eks-kubeconfig.sh fms
#   export KUBECONFIG=~/.floci/eks-fms.kubeconfig
#   kubectl get nodes

set -eu

CLUSTER="${1:-}"
if [ -z "$CLUSTER" ]; then
    echo "usage: $0 <cluster-name> [output-path]" >&2
    exit 64
fi

ENDPOINT="${FLOCI_ENDPOINT:-http://localhost:4566}"
OUT="${2:-${HOME}/.floci/eks-${CLUSTER}.kubeconfig}"

# The runtime does not verify the signature, but it does require the header.
AUTH='Authorization: AWS4-HMAC-SHA256 Credential=test/00000000/us-east-1/eks/aws4_request, SignedHeaders=host, Signature=x'

BODY="$(curl -sS -H "$AUTH" "${ENDPOINT}/clusters/${CLUSTER}")" || {
    echo "Could not reach the Floci runtime at ${ENDPOINT}." >&2
    exit 1
}

mkdir -p "$(dirname "$OUT")"

# python3 rather than jq: it is already required to run this repo's tooling, and
# it lets the not-yet-ACTIVE case fail with a useful message.
printf '%s' "$BODY" | CLUSTER="$CLUSTER" python3 -c '
import base64, json, os, sys

cluster = json.load(sys.stdin).get("cluster")
name = os.environ["CLUSTER"]
if not cluster:
    sys.exit(f"No cluster named {name}.")

endpoint = cluster.get("endpoint")
ca = (cluster.get("certificateAuthority") or {}).get("data")
if not endpoint or not ca:
    status = cluster.get("status") or "not ready"
    sys.exit(
        f"Cluster {name} is {status} and has not published its endpoint and CA "
        "yet — wait for ACTIVE."
    )

token = "k8s-aws-v1." + base64.urlsafe_b64encode(b"floci-local-eks").decode().rstrip("=")
print(f"""apiVersion: v1
kind: Config
current-context: {name}
clusters:
  - name: {name}
    cluster:
        server: {endpoint}
        certificate-authority-data: {ca}
users:
  - name: {name}
    user:
        token: {token}
contexts:
  - name: {name}
    context:
        cluster: {name}
        user: {name}""")
' > "$OUT"

chmod 600 "$OUT"
echo "Wrote ${OUT}"
echo
echo "  export KUBECONFIG=${OUT}"
echo "  kubectl get nodes"
