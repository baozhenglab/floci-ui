import {ValidationError} from '../cloud-spi/errors'
import {awsEksSchema} from '../cloud-spi/eksSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    KubeconfigFile,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {eksService, type EksCluster} from '../services/eks'

type EksServiceShape = Pick<typeof eksService, 'listClusters' | 'describeCluster' | 'createCluster' | 'deleteCluster'>

export class AwsEksAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'k8s' as const

    constructor(private readonly eks: EksServiceShape = eksService) {}

    schema(): ServiceSchema {
        return awsEksSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const clusters = await this.eks.listClusters()
        return filterBySearch(clusters.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return toResource(await this.eks.describeCluster(id))
        } catch (error) {
            if (hasHttpStatus(error, 404)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (!NAME_PATTERN.test(name)) {
            throw new ValidationError('Use a valid EKS cluster name: start alphanumeric, then letters, numbers, hyphens, or underscores.')
        }

        // The runtime validates these against real subnets and answers
        // InvalidParameterException for an unknown id, so only the shape is
        // checked here — existence is the runtime's call to make.
        const subnetIds = idList(input.values.subnetIds)
        if (subnetIds.length === 0) {
            throw new ValidationError('subnetIds is required: give one or more existing subnet IDs, separated by commas')
        }

        return toResource(await this.eks.createCluster({
            name,
            subnetIds,
            roleArn: optionalString(input.values.roleArn),
            version: optionalString(input.values.version),
        }))
    }

    async delete(id: string): Promise<void> {
        await this.eks.deleteCluster(requiredString(id, 'id'))
    }

    /**
     * Builds the kubeconfig from DescribeCluster alone — endpoint plus CA — with a
     * `k8s-aws-v1.` bearer token.
     *
     * The runtime points the cluster's authentication-token-webhook at itself and
     * accepts any token carrying that prefix, mapping it to `floci:aws-iam` in
     * `system:masters`. The token is therefore a protocol marker rather than a
     * secret, which is why one can be emitted here instead of requiring an
     * `aws eks get-token` exec credential the runtime has no equivalent for.
     */
    async kubeconfig(id: string): Promise<KubeconfigFile> {
        const name = requiredString(id, 'id')
        const cluster = await this.eks.describeCluster(name)

        const endpoint = cluster.endpoint
        if (!endpoint) {
            throw new ValidationError(`Cluster ${name} has no endpoint yet — wait for it to become ACTIVE.`)
        }

        const ca = cluster.certificateAuthority?.data
        if (!ca) {
            throw new ValidationError(`Cluster ${name} has not published its certificate authority yet.`)
        }

        return {filename: `${name}.kubeconfig`, content: kubeconfigYaml(name, endpoint, ca)}
    }
}

function toResource(cluster: EksCluster): CloudResource {
    return {
        id: cluster.name,
        name: cluster.name,
        cloud: 'aws',
        service: 'k8s',
        type: 'cluster',
        region: null,
        createdAt: cluster.createdAt ?? null,
        status: cluster.status ?? null,
        version: cluster.version ?? null,
        metadata: {
            arn: cluster.arn,
            endpoint: cluster.endpoint,
            roleArn: cluster.roleArn,
            platformVersion: cluster.platformVersion,
            nodegroupCount: cluster.nodegroupCount ?? 0,
            fargateProfileCount: cluster.fargateProfileCount ?? 0,
            resourcesVpcConfig: cluster.resourcesVpcConfig,
            tags: Object.entries(cluster.tags).map(([key, value]) => ({key, value})),
        },
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function hasHttpStatus(error: unknown, status: number): boolean {
    if (typeof error !== 'object' || error === null) return false
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === status
}

/** Mirrors the pattern the schema advertises, so both reject the same inputs. */
const NAME_PATTERN = /^[0-9A-Za-z][A-Za-z0-9_-]{0,99}$/

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ValidationError(`${field} is required`)
    }
    return value.trim()
}

function optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
}

/** Splits the comma-separated form field, dropping blanks and duplicates. */
function idList(value: unknown): string[] {
    if (typeof value !== 'string') return []
    return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))]
}

/** Marks the token as EKS-shaped; the runtime's webhook does not verify it. */
const EKS_TOKEN_PREFIX = 'k8s-aws-v1.'

function eksStyleToken(): string {
    // Real EKS carries a presigned STS GetCallerIdentity URL here. The runtime
    // ignores the payload, so a stable, obviously-inert marker is used rather
    // than a forged signature that would imply verification happens.
    const payload = Buffer.from('floci-local-eks').toString('base64url')
    return `${EKS_TOKEN_PREFIX}${payload}`
}

function kubeconfigYaml(name: string, endpoint: string, certificateAuthorityData: string): string {
    // Names are constrained by NAME_PATTERN and the other two values are a URL
    // and base64, so none of them need YAML quoting or escaping.
    return [
        'apiVersion: v1',
        'kind: Config',
        `current-context: ${name}`,
        'clusters:',
        `  - name: ${name}`,
        '    cluster:',
        `        server: ${endpoint}`,
        `        certificate-authority-data: ${certificateAuthorityData}`,
        'users:',
        `  - name: ${name}`,
        '    user:',
        `        token: ${eksStyleToken()}`,
        'contexts:',
        `  - name: ${name}`,
        '    context:',
        `        cluster: ${name}`,
        `        user: ${name}`,
        '',
    ].join('\n')
}
