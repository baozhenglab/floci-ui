import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {NotImplementedByRuntimeError, RuntimeUnavailableError, ValidationError} from '../cloud-spi/errors'
import {awsDynamoDbSchema} from '../cloud-spi/dynamodbSchema'
import {awsStorageSchema} from '../cloud-spi/storageSchema'
import type {CloudProvider, CloudResource, CloudServiceAdapter, CreateResourceInput, NoSqlItem} from '../cloud-spi/types'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {CloudProxyService} from '../service/CloudProxyService'
import type {RuntimeProbe} from '../service/runtimeProbe'
import {createCloudRoutes} from './clouds'

function mockAdapter(cloud: CloudProvider, overrides: Partial<CloudServiceAdapter> = {}): CloudServiceAdapter {
    return {
        cloud,
        service: 'storage',
        schema: awsStorageSchema,
        list: async () => [],
        get: async () => null,
        create: async (_input: CreateResourceInput): Promise<CloudResource> => ({
            id: 'created',
            name: 'created',
            cloud,
            service: 'storage',
            type: 'bucket',
            region: null,
            createdAt: null,
            metadata: {},
        }),
        delete: async () => {},
        listObjects: async (resourceId: string, prefix = '') => ({
            prefix,
            objects: [{
                key: `${resourceId}/object.txt`,
                name: 'object.txt',
                type: 'object',
                size: 12,
                lastModified: null,
                metadata: {},
            }],
        }),
        ...overrides,
    }
}

/**
 * Runtime probes make real HTTP calls to the emulator endpoints, so tests inject
 * stubs — otherwise status assertions depend on whether a container happens to
 * be listening, which passes locally and fails in CI.
 */
function stubProbes(overrides: Partial<Record<CloudProvider, RuntimeProbe>> = {}): Record<CloudProvider, RuntimeProbe> {
    const reachable: RuntimeProbe = async () => {}
    return {aws: reachable, ...overrides}
}

function unreachable(message: string): RuntimeProbe {
    return async () => {
        throw new RuntimeUnavailableError(message)
    }
}

function appWithRoutes(
    adapters: CloudServiceAdapter[] = [mockAdapter('aws')],
    probes: Record<CloudProvider, RuntimeProbe> = stubProbes(),
) {
    const app = new Hono()
    const registry = new CloudAdapterRegistry(adapters)
    app.route('/api/clouds', createCloudRoutes(new CloudProxyService(registry, probes)))
    return app
}

describe('cloud schema routes', () => {
    test('returns AWS storage schema', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.service).toBe('storage')
        expect(body.fields[0].name).toBe('bucketName')
    })

    test('returns AWS DynamoDB schema for the nosql service', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'nosql',
            schema: awsDynamoDbSchema,
        })])
        const res = await app.request('/api/clouds/aws/services/nosql/schema')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.service).toBe('nosql')
        expect(body.displayName).toBe('DynamoDB')
    })

    // Previously a static schema was served for any known service even with no
    // adapter behind it, so the UI rendered a table that then 501'd on every call.
    test('does not serve a schema for a service with no registered adapter', async () => {
        const app = appWithRoutes([mockAdapter('aws')])

        for (const path of [
            '/api/clouds/aws/services/k8s/schema',
            '/api/clouds/aws/services/database/schema',
            '/api/clouds/aws/services/compute/schema',
            '/api/clouds/aws/services/iac/schema',
        ]) {
            const res = await app.request(path)
            expect(res.status).toBe(404)
            expect((await res.json()).error).toBe('Schema not available')
        }
    })

    test('rejects a service slug that is not in the catalog', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/queue/schema')

        expect(res.status).toBe(404)
        expect((await res.json()).error).toBe('Unknown cloud or service')
    })

    test('returns AWS cloud status', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.adapterRegistered).toBe(true)
        expect(body.runtime).toBe('reachable')
    })

    // Runtime health is probed independently of adapter registration, so an
    // unreachable runtime is reported even when nothing is registered.
    test('returns runtime status without a registered adapter', async () => {
        const app = appWithRoutes(
            [],
            stubProbes({aws: unreachable('Cannot reach Floci core at http://localhost:4566')}),
        )
        const res = await app.request('/api/clouds/aws/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.cloud).toBe('aws')
        expect(body.adapterRegistered).toBe(false)
        expect(body.runtime).toBe('unavailable')
        expect(body.endpoint).toBe('http://localhost:4566')
        expect(body.error).toContain('Cannot reach Floci core')
    })

    test('cloud status reflects the runtime probe, not one adapter listing', async () => {
        // Previously a cloud whose storage adapter could list reported "reachable"
        // no matter what state the runtime was actually in.
        const app = appWithRoutes(
            [mockAdapter('aws')],
            stubProbes({aws: unreachable('Cannot reach Floci core at http://localhost:4566')}),
        )
        const body = await (await app.request('/api/clouds/aws/status')).json()

        expect(body.runtime).toBe('unavailable')
        expect(body.adapterRegistered).toBe(true)
    })

    test('lists storage objects through the cloud adapter', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/resources/demo/objects')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.objects).toHaveLength(1)
        expect(body.objects[0].name).toBe('object.txt')
    })

    test('lists DynamoDB records through the nosql adapter', async () => {
        const app = appWithRoutes([mockAdapter('aws', {
            service: 'nosql',
            schema: awsDynamoDbSchema,
            listNoSqlItems: async (resourceId: string): Promise<NoSqlItem[]> => [{
                id: '{"pk":"item-1"}',
                key: {pk: 'item-1'},
                document: {pk: 'item-1', name: 'First item', table: resourceId},
            }],
        })])

        const res = await app.request('/api/clouds/aws/services/nosql/resources/orders/items')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body[0].key).toEqual({pk: 'item-1'})
        expect(body[0].document.table).toBe('orders')
    })

    test('normalizes runtime unavailable errors', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                list: async () => {
                    throw new RuntimeUnavailableError('Cannot reach Floci at http://localhost:4566: connection refused')
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources')
        const body = await res.json()

        expect(res.status).toBe(503)
        expect(body.code).toBe('runtime_unavailable')
        expect(body.message).toBe('Runtime unavailable')
        expect(body.detail).toContain('connection refused')
    })

    test('normalizes not implemented runtime errors', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                create: async () => {
                    throw new NotImplementedByRuntimeError('S3 request failed: HTTP 501')
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources', {
            method: 'POST',
            body: JSON.stringify({bucketName: 'demo'}),
        })
        const body = await res.json()

        expect(res.status).toBe(501)
        expect(body.code).toBe('operation_not_implemented')
        expect(body.message).toBe('Operation is not implemented by the selected runtime')
    })

    test('reports a missing adapter as unsupported rather than a runtime failure', async () => {
        const res = await appWithRoutes([mockAdapter('aws')]).request('/api/clouds/aws/services/compute/resources')
        const body = await res.json()

        expect(res.status).toBe(501)
        expect(body.code).toBe('operation_not_supported')
        expect(body.detail).toContain('No adapter registered for aws/compute')
    })

    test('maps a validation error to 400 with the adapter message intact', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                create: async () => {
                    throw new ValidationError('bucketName is required')
                },
            }),
        ])
        const res = await app.request('/api/clouds/aws/services/storage/resources', {
            method: 'POST',
            body: JSON.stringify({}),
        })
        const body = await res.json()

        expect(res.status).toBe(400)
        expect(body.code).toBe('invalid_request')
        expect(body.message).toBe('bucketName is required')
    })

    // Before typed errors these AWS SDK failures all collapsed into a blanket 502.
    const sdkCases: Array<{name: string; status: number; code: string}> = [
        {name: 'BucketAlreadyOwnedByYou', status: 409, code: 'resource_conflict'},
        {name: 'AccessDenied', status: 403, code: 'access_denied'},
        {name: 'ValidationException', status: 400, code: 'invalid_request'},
        {name: 'ThrottlingException', status: 429, code: 'rate_limited'},
        {name: 'NoSuchBucket', status: 404, code: 'resource_not_found'},
    ]

    for (const sdkCase of sdkCases) {
        test(`maps the AWS SDK ${sdkCase.name} error to ${sdkCase.status}`, async () => {
            const app = appWithRoutes([
                mockAdapter('aws', {
                    create: async () => {
                        const err = new Error(`${sdkCase.name} raised by the runtime`)
                        err.name = sdkCase.name
                        Object.assign(err, {$metadata: {httpStatusCode: 500}, $fault: 'client'})
                        throw err
                    },
                }),
            ])
            const res = await app.request('/api/clouds/aws/services/storage/resources', {
                method: 'POST',
                body: JSON.stringify({name: 'demo'}),
            })
            const body = await res.json()

            expect(res.status).toBe(sdkCase.status)
            expect(body.code).toBe(sdkCase.code)
            expect(body.detail ?? body.message).toContain(sdkCase.name)
        })
    }
})

describe('service descriptors', () => {
    test('every descriptor carries nav metadata', async () => {
        for (const cloud of ['aws']) {
            const res = await appWithRoutes().request(`/api/clouds/${cloud}/services`)
            const body = await res.json()

            expect(res.status).toBe(200)
            expect(body.length).toBeGreaterThan(0)
            for (const descriptor of body) {
                expect(descriptor.cloud).toBe(cloud)
                expect(typeof descriptor.route).toBe('string')
                expect(descriptor.route.length).toBeGreaterThan(0)
                expect(typeof descriptor.iconKey).toBe('string')
                expect(typeof descriptor.group).toBe('string')
                expect(typeof descriptor.order).toBe('number')
                expect(descriptor.displayName.length).toBeGreaterThan(0)
            }
        }
    })

    test('every unavailable service explains itself', async () => {
        for (const cloud of ['aws']) {
            const body = await (await appWithRoutes().request(`/api/clouds/${cloud}/services`)).json()
            const unexplained = body.filter(
                (d: {availability: string; reason?: string}) => d.availability === 'coming_soon' && !d.reason,
            )
            expect(unexplained).toEqual([])
        }
    })

    test('availability follows adapter registration rather than a hardcoded list', async () => {
        const withK8s = await (await appWithRoutes([
            mockAdapter('aws', {service: 'k8s'}),
        ]).request('/api/clouds/aws/services')).json()
        const withoutK8s = await (await appWithRoutes([mockAdapter('aws')]).request('/api/clouds/aws/services')).json()

        const find = (body: Array<{service: string; reason?: string}>, service: string) =>
            body.find((d) => d.service === service)

        expect(find(withK8s, 'k8s')).toMatchObject({availability: 'available'})
        expect(find(withoutK8s, 'k8s')).toMatchObject({availability: 'coming_soon'})
        expect(find(withoutK8s, 'k8s')?.reason).toContain('AWS')
    })

    // No shipped adapter overrides its descriptor any more, so this fake adapter
    // is the only remaining coverage of the mechanism. Keep it: CloudProxyService
    // still consults descriptorOverride when deriving availability.
    test('an adapter can report coming_soon when its runtime does not implement it', async () => {
        const app = appWithRoutes([
            mockAdapter('aws', {
                service: 'serverless',
                descriptorOverride: () => ({
                    availability: 'coming_soon',
                    reason: 'The runtime returns 501 NotImplemented for this endpoint.',
                }),
            }),
        ])
        const body = await (await app.request('/api/clouds/aws/services')).json()
        const serverless = body.find((d: {service: string}) => d.service === 'serverless')

        expect(serverless.availability).toBe('coming_soon')
        expect(serverless.reason).toContain('501')
    })

    // legacyAvailability is what keeps this page visible: there is no secrets
    // adapter to derive availability from, unlike every other catalogued service.
    test('keeps the legacy Secrets Manager page available through legacyAvailability', async () => {
        const body = await (await appWithRoutes().request('/api/clouds/aws/services')).json()
        const find = (service: string) => body.find((d: {service: string}) => d.service === service)

        expect(find('secrets')).toMatchObject({availability: 'available', route: '/secretsmanager'})
        // iac has neither an adapter nor a legacy escape hatch, so it stays hidden.
        expect(find('iac')).toMatchObject({availability: 'coming_soon'})
    })
})

describe('per-service status', () => {
    test('reports a reachable service with a latency measurement', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/storage/status')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body).toMatchObject({
            cloud: 'aws',
            service: 'storage',
            adapterRegistered: true,
            runtime: 'reachable',
            error: null,
            errorCode: null,
        })
        expect(body.latencyMs).toBeGreaterThanOrEqual(0)
    })

    test('reports coming_soon for a service with no adapter', async () => {
        const res = await appWithRoutes([mockAdapter('aws')]).request('/api/clouds/aws/services/iac/status')
        const body = await res.json()

        expect(body).toMatchObject({runtime: 'coming_soon', adapterRegistered: false, latencyMs: null})
    })

    test('distinguishes a runtime that does not implement a service from one that is down', async () => {
        // This is the whole point of errorCode: one service answering 501 is not
        // the same as the runtime being offline, and the UI must not conflate them.
        // The two mocks must differ by service — the registry keys on cloud:service.
        const app = appWithRoutes([
            mockAdapter('aws', {
                service: 'serverless',
                list: async () => {
                    throw new NotImplementedByRuntimeError('HTTP 501 /functions')
                },
            }),
            mockAdapter('aws', {
                service: 'storage',
                list: async () => {
                    throw new RuntimeUnavailableError('Cannot reach Floci core')
                },
            }),
        ])

        const notImplemented = await (await app.request('/api/clouds/aws/services/serverless/status')).json()
        expect(notImplemented.runtime).toBe('unavailable')
        expect(notImplemented.errorCode).toBe('operation_not_implemented')

        const down = await (await app.request('/api/clouds/aws/services/storage/status')).json()
        expect(down.errorCode).toBe('runtime_unavailable')
    })

    test('prefers an adapter health() override to list()', async () => {
        let listCalls = 0
        let healthCalls = 0
        const app = appWithRoutes([
            mockAdapter('aws', {
                list: async () => {
                    listCalls += 1
                    return []
                },
                health: async () => {
                    healthCalls += 1
                },
            }),
        ])

        await app.request('/api/clouds/aws/services/storage/status')
        expect(healthCalls).toBe(1)
        expect(listCalls).toBe(0)
    })

    test('omits per-service detail from the cloud status by default', async () => {
        const body = await (await appWithRoutes().request('/api/clouds/aws/status')).json()
        expect(body.services).toBeUndefined()
    })

    test('includes per-service detail only when asked', async () => {
        const body = await (await appWithRoutes().request('/api/clouds/aws/status?services=all')).json()

        expect(Array.isArray(body.services)).toBe(true)
        expect(body.services[0]).toMatchObject({cloud: 'aws', service: 'storage'})
    })

    test('caches probes so a polling sidebar does not fan out per request', async () => {
        let probes = 0
        const app = appWithRoutes([
            mockAdapter('aws', {
                list: async () => {
                    probes += 1
                    return []
                },
            }),
        ])

        for (let i = 0; i < 5; i += 1) {
            await app.request('/api/clouds/aws/services/storage/status')
        }
        expect(probes).toBe(1)
    })

    test('rejects an unknown service slug', async () => {
        const res = await appWithRoutes().request('/api/clouds/aws/services/queue/status')
        expect(res.status).toBe(404)
    })
})
