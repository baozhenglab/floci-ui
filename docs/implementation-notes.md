# Implementation Notes

This document tracks the current architectural direction behind the Floci UI shell.

## What Changed

- Introduced the Cloud Proxy API under `/api/clouds/*`.
- Added shared SPI contracts in `packages/api/src/cloud-spi`.
- Added the `CloudAdapterRegistry` to resolve cloud + service pairs.
- Moved the main UX toward `Console Home` and `Cloud Explorer`.
- Kept `Secrets Manager` as a dedicated AWS page during the transition.
- Narrowed the console to AWS: the Azure and GCP adapters, schemas, runtimes and
  UI surface were removed. The SPI layering was kept intact — `CloudProvider` is
  now a one-member union rather than an abstraction that was deleted.

## Adapters Currently Registered

All eight are AWS:

- Storage (S3)
- k8s (EKS)
- Database (RDS)
- DynamoDB
- Compute (EC2)
- Networking (VPC)
- Serverless (Lambda)
- API Gateway

## Current UI Surface

The frontend currently exposes:

- `Console Home`
- `Cloud Explorer / storage`
- `Cloud Explorer / k8s`
- `Cloud Explorer / database`
- `Cloud Explorer / nosql`
- `Cloud Explorer / compute`
- `Cloud Explorer / networking`
- `Cloud Explorer / apigateway`
- `Cloud Explorer / serverless`
- `/secretsmanager`

`iac` (CloudFormation) is catalogued but has no adapter, so it renders as a
disabled sidebar row carrying the server's reason.

## Active Transitional State

The codebase is in a hybrid stage:

- Unified shell and metadata-driven proxy are the default direction.
- Some AWS workflows still depend on service-specific panels inside the new shell
  (`ComputePanel`, `NetworkingPanel`, `DynamoDbTableExplorer`) because they need
  dependent selectors a flat generic form cannot express.
- `Secrets Manager` remains outside Cloud Explorer, kept visible through the
  `legacyAvailability` escape hatch in the service catalog.
- Old AWS legacy pages were intentionally removed instead of being carried forward.

## Notes On The AWS-Only Narrowing

Two things were deliberately kept rather than swept away with the providers:

- `descriptorOverride` on `CloudServiceAdapter`. No shipped adapter implements it
  now, but the hook is cloud-agnostic and `CloudProxyService` still consults it;
  `routes/clouds.test.ts` covers the mechanism through a fake adapter.
- `coming_soon` across the availability and capability unions. It is not an
  Azure/GCP artifact: `iac` has no adapter, and the AWS compute lifecycle verbs
  advertise it.

`cosmos-*` CSS class names survive in `index.css` because
`DynamoDbTableExplorer` reuses them; they are AWS styles with a misleading name.

## Next Cleanup Targets

- Move remaining dedicated AWS workflows into Cloud Explorer where practical.
- Rename the `cosmos-*` CSS classes to match their AWS-only usage.
- Redraw `docs/images/floci-unified-ui-architecture.png`, which still shows three
  provider columns.
- Continue reducing README drift whenever the visible navigation changes.
