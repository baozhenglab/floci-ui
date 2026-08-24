<p align="center">
  <img src="docs/images/floci-black.svg#gh-light-mode-only" alt="Floci UI" width="460" />
  <img src="docs/images/floci-white.svg#gh-dark-mode-only" alt="Floci UI" width="460" />
</p>

<p align="center">
  <strong>Any Cloud. Locally.</strong><br />
  A local-first, cloud-aware runtime console for Floci and compatible local cloud emulators.
</p>

<p align="center">
  <a href="https://github.com/floci-io/floci-ui/releases/latest"><img src="https://img.shields.io/github/v/release/floci-io/floci-ui?label=latest%20release&color=blue" alt="Latest Release"></a>
  <a href="https://github.com/floci-io/floci-ui/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/floci-io/floci-ui/ci.yml?branch=main&label=ci" alt="CI Status"></a>
  <a href="https://hub.docker.com/r/floci/floci-ui"><img src="https://img.shields.io/docker/pulls/floci/floci-ui?label=docker%20pulls" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/floci/floci-ui"><img src="https://img.shields.io/docker/image-size/floci/floci-ui/latest?label=image%20size" alt="Docker Image Size"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
</p>

<p align="center">
  <img src="docs/images/floci-ui-console.png" alt="Floci UI console" width="900" />
</p>

Floci UI is the web console for the Floci ecosystem. The current app is centered on a unified `Cloud Explorer` and a cloud-aware `Console Home`. It renders only real data returned by local runtimes and explicit placeholders for work that is not wired yet.

No fake resources, no demo rows, and no mock operational data are shown in normal mode.

## Quick Start

AWS-only stack:

```bash
docker compose up
```

Then open the session URL the API prints on boot — it looks like:

```text
  floci-api: authentication enforced with a token generated for this boot.

  Open the console with:
      http://localhost:4500/api/session?token=3b14b200dd6a483ea098152dcc40a090
```

Find it with `docker compose logs floci-api`. Opening that URL sets an httpOnly
session cookie and lands you on the console at
[http://localhost:4500](http://localhost:4500).

To skip the log lookup, pin a token instead:

```bash
FLOCI_UI_TOKEN=my-local-token docker compose up
# then open http://localhost:4500/api/session?token=my-local-token
```

## Authentication

`/api/*` is deny-by-default. The API drives real cloud SDKs with server-side
credentials and exposes destructive operations, so it does not answer
unauthenticated callers.

- **Token** — `FLOCI_UI_TOKEN` if set, otherwise generated per boot and printed.
- **Browser** — `GET /api/session?token=<token>` sets an httpOnly, `SameSite=Lax`
  cookie scoped to `/`. The SPA needs no other configuration; nothing is baked
  into the bundle, because the API serves that bundle from below the gate.
- **Scripts** — send `x-floci-ui-token: <token>`, `Authorization: Bearer <token>`,
  or `?token=<token>` for direct links.
- **Ungated** — only `GET /api/health` and `GET /api/session`.
- **Origins** — `CORS_ALLOWED_ORIGINS` (default `http://localhost:4500`) is both
  the CORS allow-list and the set of origins permitted to send state-changing
  requests, so another page on a different localhost port cannot ride your cookie.
- **Opt out** — `FLOCI_UI_AUTH=off` disables the gate entirely. Sandboxes only;
  the boot banner warns when it is set.

Authenticate on the same hostname you browse: a cookie set for `localhost` is not
sent to `127.0.0.1`.

## What The UI Actually Exposes Today

The sidebar and Console Home are rendered from `GET /api/clouds/:cloud/services`,
so this table is derived from the service catalog and the adapter registry rather
than maintained by hand. Regenerate it after any change to either:

```bash
cd packages/api && bun run scripts/service-matrix.ts
```

| Group | Service | AWS |
|---|---|---|
| Compute | Compute | Yes (list, inspect, create, delete) |
| Compute | EKS | Yes (list, inspect, create, delete) |
| Compute | Serverless | Yes (list, create, inspect, delete) |
| Storage | Storage | Yes (list, create, delete, inspect) |
| Databases | Database | Yes (list, inspect, create, delete) |
| Databases | DynamoDB | Yes (list, create, delete, inspect) |
| Networking | Networking | Yes (list) |
| Integration | API Gateway | Yes (list, create, delete, inspect) |
| Provisioning | CloudFormation | No |
| Security | Secrets Manager | Yes (legacy page) |

Services marked `No` render as a disabled sidebar row whose tooltip carries the
server-supplied reason. Adding one is a catalog row in
`packages/api/src/cloud-spi/serviceCatalog.ts` plus an adapter — no frontend change.

## Current Capability Snapshot

<details>
<summary><strong>Storage</strong></summary>

Cloud Explorer storage is the most complete unified category today.

- AWS S3 buckets are normalized as `storage` resources with type `bucket`.
- Shared resource table, shared inspector, runtime status strip, and schema-driven create/delete flows.
- Object browser with prefix navigation.
- Upload, download, delete, copy, and create-folder-prefix actions.
- Size and last-modified metadata are shown when returned by the runtime.

Current gaps:

- No bulk multi-select actions yet.
- No tag/policy/version management in the unified view.
- Folder creation is prefix-based, not a real filesystem directory.

</details>

<details>
<summary><strong>k8s Engine</strong></summary>

Through the unified shell.

- EKS clusters can be listed, inspected, created, and deleted.
- Cluster creation takes a name plus existing subnet IDs; the Kubernetes version and cluster role ARN are optional.
- Cluster metadata, node groups, and related details are surfaced when returned by Floci AWS Core.

- **Download kubeconfig** in the cluster inspector, so `kubectl` works against a
  created cluster. The same file from a terminal:

  ```bash
  scripts/eks-kubeconfig.sh <cluster-name>
  export KUBECONFIG=~/.floci/eks-<cluster-name>.kubeconfig
  kubectl get nodes
  ```

Floci backs each cluster with its own k3s container (`floci-eks-<name>`) and
publishes the API server on a per-cluster host port. The kubeconfig is built from
DescribeCluster alone — endpoint plus cluster CA — with a `k8s-aws-v1.` bearer
token. That token is not a secret: the cluster's authentication-token-webhook
points back at the runtime, which accepts any token with that prefix and maps it
to `floci:aws-iam` in `system:masters`. Real EKS would need an
`aws eks get-token` credential; the runtime has no equivalent.

Two things worth knowing:

- The `version` the EKS API reports is metadata, not the running version. Ask
  `kubectl version` — the runtime launches one fixed k3s image
  (`floci.services.eks.default-image`) regardless of the version chosen at
  create time.
- A cluster reports `CREATING` before it publishes its endpoint and CA, so the
  download fails with an explicit message until it reaches `ACTIVE`.

Current gaps:

- Node groups and Fargate profiles are managed from the cluster inspector through
  the legacy `/api/eks/*` routes, not the generic Cloud Explorer contract.
- Cluster updates (version upgrades, VPC/logging config) are not exposed.

</details>

<details>
<summary><strong>Database</strong></summary>

- AWS RDS: list, inspect, create, and delete. Connection details and snapshots in the inspector.
- AWS DynamoDB is exposed separately under the `nosql` category, with a table list and a read-only item browser.

Current gaps:

- RDS lifecycle actions (start/stop/reboot) are not wired yet.
- DynamoDB has no scan/query workflow and no partition/sort key modelling in the UI.

</details>

<details>
<summary><strong>Compute</strong></summary>

AWS only, through the unified shell plus AWS-specific panels where the workflow is too rich for a flat generic form.

- List EC2 instances and AMIs as normalized resources.
- Launch instances.
- Start, stop, reboot, and terminate instances.
- Create AMIs.
- Edit tags.
- View console output.

Current gaps:

- Compute creation still uses an AWS-specific panel because it needs dependent selectors.

</details>

<details>
<summary><strong>Networking</strong></summary>

AWS only, through the unified shell plus an AWS-specific networking panel.

- VPC list and inspect through the unified resource table.
- VPC creation and delete, the VPC wizard, subnets, security groups, internet
  gateways, NAT gateways, route tables, and Elastic IP workflows — all in the
  Networking panel.

Current gaps:

- Create and delete are advertised as `partial` in the unified schema and are
  handled by the Networking panel, because they need dependent selectors that a
  flat generic form cannot express.

</details>

<details>
<summary><strong>API Gateway</strong></summary>

AWS only, through the generic apigateway service category.

- List and inspect REST APIs.
- Create and delete REST APIs.

Current gaps:

- Resources, methods, deployments, and stages are not yet exposed.

</details>

<details>
<summary><strong>Serverless</strong></summary>

AWS Lambda, through the unified shell.

- List, create, inspect, and delete functions.
- AWS Lambda invoke is wired, including the tailed execution log and handler errors.
- Lambda creation packages inline code into a real deployment archive.
- The navigation entry appears for any cloud with a registered adapter.

Current gaps:

- Old AWS Lambda page is gone; all future work should stay in the unified model.

</details>

<details>
<summary><strong>Secrets Manager</strong></summary>

This is the only dedicated AWS page still outside Cloud Explorer.

- List secrets.
- Inspect metadata.
- Reveal current value on demand.
- Create secrets.
- Update values.
- Delete secrets, including force delete.

Current gaps:

- Not migrated into the Cloud Explorer contract yet.

</details>

## Product Direction

Floci UI is a metadata-driven console: the shell renders whatever the server's service catalog and schemas describe, so a service is added on the server and nothing changes in the frontend.

The guiding rules are:

- The UI does not know clouds.
- The proxy does not know internal implementations.
- The SPI defines the contracts.
- The adapters perform the translation.
- The runtimes execute the real behavior.

## Architecture

![Floci Unified UI Architecture](docs/images/floci-unified-ui-architecture.png)

Short implementation notes live in [docs/implementation-notes.md](docs/implementation-notes.md).

## Project Structure

```text
packages/
  api/
    src/
      cloud-spi/
      registry/
      adapter-aws/
      routes/
      service/
  frontend/
    src/
      api/
      components/
      features/
      pages/
```

High-level runtime flow:

```text
Browser
  -> frontend (React/Vite)
  -> /api/clouds/*
  -> Cloud Adapter Registry
  -> provider adapter
  -> local runtime
```

## Setup

### Docker Compose

Default compose stack:

- `floci-ui` on `http://localhost:4500`
- `floci-api` on `http://localhost:4501`
- `floci` on `http://localhost:4566`

Start AWS-only:

```bash
docker compose up
```

Convenience targets:

```bash
make up
make down
make logs
```

### Manual Local Development

Prerequisites:

- Node.js 20+
- pnpm 9+
- Bun
- A running Floci core runtime

Install dependencies:

```bash
pnpm install
```

Configure the API environment:

```bash
cp .env.example packages/api/.env
```

Important: the API runs from `packages/api` and loads environment variables from `packages/api/.env`.

Start Floci AWS Core with Docker:

```bash
docker run -d --name floci \
  -p 4566:4566 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e FLOCI_DEFAULT_REGION=us-east-1 \
  -u root \
  floci/floci:latest
```

Or from a local clone:

```bash
git clone https://github.com/floci-io/floci.git ../floci
cd ../floci
./mvnw clean quarkus:dev
```

Optional local runtimes:


Start the UI stack:

```bash
pnpm dev
```

That starts:

- frontend on `http://localhost:4500`
- API on `http://localhost:4501`

Split commands:

```bash
pnpm dev:api
pnpm dev:web
```

## Environment

Default API environment values:

```bash
FLOCI_UI_TOKEN=            # empty -> generated per boot and printed
FLOCI_UI_AUTH=             # "off" disables the gate (sandboxes only)
CORS_ALLOWED_ORIGINS=http://localhost:4500
FLOCI_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
PORT=4501
```

The app only renders real data returned by local runtimes; there is no mock mode.

## Verification

```bash
pnpm lint
pnpm type-check
pnpm test        # bun test (api) + vitest (frontend)
pnpm build
```

## Troubleshooting

### `http proxy error` or `ECONNREFUSED` on `/api/*`

The frontend is up, but the API is not reachable on `http://localhost:4501`.

Check:

```bash
pnpm dev:api
curl -H "x-floci-ui-token: $FLOCI_UI_TOKEN" http://localhost:4501/api/clouds
```

### `EADDRINUSE` on port `4501`

Another API process is already running. Stop it first or kill the process holding port `4501`.

### Runtime shows `Not connected` or `Runtime unavailable`

Check the runtime directly:

```bash
curl http://localhost:4566/_floci/health
curl http://localhost:4577/_floci/health
curl -H "x-floci-ui-token: $FLOCI_UI_TOKEN" http://localhost:4501/api/clouds/aws/status
```

### A single service shows as unavailable while the cloud is connected

Cloud status reflects the runtime; each service is probed separately. Ask which
service is failing and why:

```bash
curl -H "x-floci-ui-token: $FLOCI_UI_TOKEN" "http://localhost:4501/api/clouds/aws/status?services=all"
curl -H "x-floci-ui-token: $FLOCI_UI_TOKEN" http://localhost:4501/api/clouds/aws/services/serverless/status
```

`errorCode` distinguishes the cases: `operation_not_implemented` means the local
runtime does not implement that service, `runtime_unavailable` means it cannot be
reached, and `operation_not_supported` means no adapter is registered.

### Credentials or endpoint mismatch

For AWS local development, keep API credentials aligned with the runtime:

```bash
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## Contributing

When adding new UI surface:

- Prefer the Cloud Explorer and Cloud Proxy model over new legacy pages.
- Reuse the SPI contracts before creating provider-specific response shapes.
- Keep placeholders explicit instead of inventing fake data.
- Update this README when the visible UI surface changes.

## License

[MIT](LICENSE) — part of the [Floci](https://floci.io) ecosystem.
