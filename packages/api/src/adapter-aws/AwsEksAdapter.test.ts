import {describe, expect, test} from 'bun:test'
import {ValidationError} from '../cloud-spi/errors'
import {AwsEksAdapter} from './AwsEksAdapter'
import type {CreateEksClusterInput, EksCluster} from '../services/eks'

/**
 * Covers the create/delete paths added when EKS stopped being read-only.
 *
 * Subnet existence is deliberately not validated here: the runtime answers
 * InvalidParameterException for an unknown id, and duplicating that check would
 * mean keeping a second, always-stale idea of which subnets exist.
 */

const CA = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t'

function cluster(overrides: Partial<EksCluster> = {}): EksCluster {
    return {
        name: 'demo',
        arn: 'arn:aws:eks:us-east-1:000000000000:cluster/demo',
        status: 'CREATING',
        version: '1.30',
        tags: {},
        ...overrides,
    }
}

function activeCluster(overrides: Partial<EksCluster> = {}): EksCluster {
    return cluster({
        status: 'ACTIVE',
        endpoint: 'https://localhost:6509',
        certificateAuthority: {data: CA},
        ...overrides,
    })
}

function adapter() {
    const created: CreateEksClusterInput[] = []
    const deleted: string[] = []
    const svc = {
        listClusters: async () => [cluster()],
        describeCluster: async (name: string) => cluster({name}),
        createCluster: async (input: CreateEksClusterInput) => {
            created.push(input)
            return cluster({name: input.name, version: input.version ?? '1.29'})
        },
        deleteCluster: async (name: string) => {
            deleted.push(name)
            return cluster({name, status: 'DELETING'})
        },
    }
    return {adapter: new AwsEksAdapter(svc), created, deleted}
}

const VALID = {name: 'demo', subnetIds: 'subnet-default-a, subnet-default-b'}

describe('AwsEksAdapter.create', () => {
    test('splits the comma-separated subnet list', async () => {
        const {adapter: a, created} = adapter()
        await a.create({values: VALID})
        expect(created[0].subnetIds).toEqual(['subnet-default-a', 'subnet-default-b'])
    })

    test('tolerates ragged spacing and trailing commas', async () => {
        const {adapter: a, created} = adapter()
        await a.create({values: {...VALID, subnetIds: ' subnet-a ,,  subnet-b ,'}})
        expect(created[0].subnetIds).toEqual(['subnet-a', 'subnet-b'])
    })

    test('drops duplicate subnet ids', async () => {
        const {adapter: a, created} = adapter()
        await a.create({values: {...VALID, subnetIds: 'subnet-a, subnet-a, subnet-b'}})
        expect(created[0].subnetIds).toEqual(['subnet-a', 'subnet-b'])
    })

    test('accepts a single subnet', async () => {
        const {adapter: a, created} = adapter()
        await a.create({values: {...VALID, subnetIds: 'subnet-a'}})
        expect(created[0].subnetIds).toEqual(['subnet-a'])
    })

    // Both are optional: the runtime supplies its own default version and
    // accepts a cluster with no role.
    test('omits an unset version and roleArn rather than sending empty strings', async () => {
        const {adapter: a, created} = adapter()
        await a.create({values: {...VALID, version: '', roleArn: '   '}})
        expect(created[0].version).toBeUndefined()
        expect(created[0].roleArn).toBeUndefined()
    })

    test('passes a supplied version and roleArn through', async () => {
        const {adapter: a, created} = adapter()
        await a.create({
            values: {...VALID, version: '1.31', roleArn: 'arn:aws:iam::000000000000:role/eksRole'},
        })
        expect(created[0].version).toBe('1.31')
        expect(created[0].roleArn).toBe('arn:aws:iam::000000000000:role/eksRole')
    })

    test('returns the normalized resource', async () => {
        const {adapter: a} = adapter()
        const resource = await a.create({values: VALID})
        expect(resource).toMatchObject({
            id: 'demo',
            name: 'demo',
            cloud: 'aws',
            service: 'k8s',
            type: 'cluster',
            status: 'CREATING',
        })
    })

    test('trims the cluster name', async () => {
        const {adapter: a, created} = adapter()
        await a.create({values: {...VALID, name: '  demo  '}})
        expect(created[0].name).toBe('demo')
    })
})

describe('AwsEksAdapter.create validation', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['a missing name', {...VALID, name: ''}],
        ['a name starting with a hyphen', {...VALID, name: '-demo'}],
        ['a name with a space', {...VALID, name: 'demo cluster'}],
        ['a name with a dot', {...VALID, name: 'demo.cluster'}],
        ['a name over 100 characters', {...VALID, name: `a${'b'.repeat(100)}`}],
        ['missing subnet ids', {...VALID, subnetIds: ''}],
        ['a subnet field of only commas and spaces', {...VALID, subnetIds: ' , , '}],
    ]

    for (const [label, values] of cases) {
        test(`rejects ${label}`, async () => {
            const {adapter: a, created} = adapter()
            await expect(a.create({values})).rejects.toBeInstanceOf(ValidationError)
            expect(created).toHaveLength(0)
        })
    }
})

describe('AwsEksAdapter.delete', () => {
    test('deletes the named cluster', async () => {
        const {adapter: a, deleted} = adapter()
        await a.delete('demo')
        expect(deleted).toEqual(['demo'])
    })

    test('trims the identifier', async () => {
        const {adapter: a, deleted} = adapter()
        await a.delete('  demo  ')
        expect(deleted).toEqual(['demo'])
    })

    test('rejects an empty identifier before calling the runtime', async () => {
        const {adapter: a, deleted} = adapter()
        await expect(a.delete('  ')).rejects.toBeInstanceOf(ValidationError)
        expect(deleted).toHaveLength(0)
    })
})

describe('AwsEksAdapter.kubeconfig', () => {
    function withCluster(c: EksCluster) {
        return new AwsEksAdapter({
            listClusters: async () => [c],
            describeCluster: async () => c,
            createCluster: async () => c,
            deleteCluster: async () => c,
        })
    }

    test('names the file after the cluster', async () => {
        const file = await withCluster(activeCluster()).kubeconfig('demo')
        expect(file.filename).toBe('demo.kubeconfig')
    })

    test('carries the endpoint and CA straight from DescribeCluster', async () => {
        const file = await withCluster(activeCluster()).kubeconfig('demo')
        expect(file.content).toContain('server: https://localhost:6509')
        expect(file.content).toContain(`certificate-authority-data: ${CA}`)
    })

    // The runtime's token webhook keys off this prefix and ignores the payload,
    // so the prefix is the part that must not drift.
    test('emits a k8s-aws-v1 bearer token', async () => {
        const file = await withCluster(activeCluster()).kubeconfig('demo')
        expect(file.content).toMatch(/token: k8s-aws-v1\.[A-Za-z0-9_-]+/)
    })

    test('produces a single-context config wired to itself', async () => {
        const file = await withCluster(activeCluster()).kubeconfig('demo')
        expect(file.content).toContain('current-context: demo')
        expect(file.content).toContain('        cluster: demo')
        expect(file.content).toContain('        user: demo')
        expect(file.content.startsWith('apiVersion: v1')).toBe(true)
        expect(file.content.endsWith('\n')).toBe(true)
    })

    // A cluster reports CREATING before it publishes either value, and a config
    // missing them fails at kubectl with a far less obvious message.
    test('refuses a cluster with no endpoint yet', async () => {
        const pending = withCluster(cluster({certificateAuthority: {data: CA}}))
        await expect(pending.kubeconfig('demo')).rejects.toBeInstanceOf(ValidationError)
    })

    test('refuses a cluster that has not published its CA yet', async () => {
        const pending = withCluster(cluster({endpoint: 'https://localhost:6509'}))
        await expect(pending.kubeconfig('demo')).rejects.toBeInstanceOf(ValidationError)
    })

    test('refuses an empty cluster name', async () => {
        await expect(withCluster(activeCluster()).kubeconfig('  ')).rejects.toBeInstanceOf(ValidationError)
    })
})

describe('AwsEksAdapter schema', () => {
    test('advertises the full CRUD set it implements', () => {
        const {adapter: a} = adapter()
        expect(a.schema().actions).toEqual(['list', 'inspect', 'create', 'delete'])
    })

    test('only the name and subnet list are required', () => {
        const {adapter: a} = adapter()
        const required = a.schema().fields.filter((f) => f.required).map((f) => f.name)
        expect(required).toEqual(['name', 'subnetIds'])
    })

    // A direct API call must not get past what the form enforces.
    test('the schema pattern and the adapter check agree', () => {
        const {adapter: a} = adapter()
        const field = a.schema().fields.find((f) => f.name === 'name')
        const pattern = new RegExp(field!.validation!.pattern!)

        for (const good of ['demo', 'demo-1', 'Demo_2', '9lives']) expect(pattern.test(good)).toBe(true)
        for (const bad of ['-demo', 'demo cluster', 'demo.cluster', '']) expect(pattern.test(bad)).toBe(false)
    })
})
