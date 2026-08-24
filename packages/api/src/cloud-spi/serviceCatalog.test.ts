import {describe, expect, test} from 'bun:test'
import {
    SERVICE_CATALOG,
    SERVICE_CATALOG_ENTRIES,
    SERVICE_GROUP_ORDER,
    SERVICE_TYPES,
    catalogEntry,
    displayNameFor,
    isServiceType,
    routeFor,
} from './serviceCatalog'

describe('SERVICE_CATALOG', () => {
    test('every entry carries the metadata the nav needs', () => {
        for (const entry of SERVICE_CATALOG_ENTRIES) {
            expect(entry.displayName.length).toBeGreaterThan(0)
            expect(entry.iconKey.length).toBeGreaterThan(0)
            expect(SERVICE_GROUP_ORDER).toContain(entry.group)
            expect(Number.isFinite(entry.order)).toBe(true)
            expect(routeFor(entry).length).toBeGreaterThan(0)
        }
    })

    test('exposes one entry per catalog key', () => {
        expect(SERVICE_CATALOG_ENTRIES).toHaveLength(Object.keys(SERVICE_CATALOG).length)
        expect(new Set(SERVICE_TYPES).size).toBe(SERVICE_TYPES.length)
    })

    test('registers the iac category under the Provisioning group', () => {
        expect(SERVICE_GROUP_ORDER).toContain('Provisioning')
        const iac = catalogEntry('iac')!
        expect(iac.group).toBe('Provisioning')
        expect(isServiceType('iac')).toBe(true)
        expect(displayNameFor(iac)).toBe('CloudFormation')
    })

    test('orders entries by group then in-group order', () => {
        const positions = SERVICE_CATALOG_ENTRIES.map((entry) => [
            SERVICE_GROUP_ORDER.indexOf(entry.group),
            entry.order,
        ])

        for (let i = 1; i < positions.length; i += 1) {
            const [prevGroup, prevOrder] = positions[i - 1]!
            const [group, order] = positions[i]!
            expect(prevGroup < group || (prevGroup === group && prevOrder <= order)).toBe(true)
        }
    })

    test('routes default to the slug and stay absolute for legacy pages', () => {
        expect(routeFor(catalogEntry('storage')!)).toBe('storage')
        // Secrets Manager still lives outside Cloud Explorer.
        expect(routeFor(catalogEntry('secrets')!)).toBe('/secretsmanager')
    })

    // Pins the labels the sidebar actually renders. These were per-cloud overrides
    // until AWS became the only cloud; promoting the AWS value into `displayName`
    // is the step a careless removal skips, silently relabelling three nav rows.
    test('exposes the AWS-facing service labels', () => {
        expect(displayNameFor(catalogEntry('k8s')!)).toBe('EKS')
        expect(displayNameFor(catalogEntry('nosql')!)).toBe('DynamoDB')
        expect(displayNameFor(catalogEntry('iac')!)).toBe('CloudFormation')
        expect(displayNameFor(catalogEntry('storage')!)).toBe('Storage')
        expect(displayNameFor(catalogEntry('secrets')!)).toBe('Secrets Manager')
    })

    // legacyAvailability is the only thing keeping the Secrets Manager nav entry
    // from going coming_soon: there is no secrets adapter to derive it from.
    test('keeps the legacy Secrets Manager availability escape hatch', () => {
        expect(catalogEntry('secrets')!.legacyAvailability?.aws).toBe('available')
    })
})

describe('isServiceType', () => {
    test('accepts every catalog key', () => {
        for (const service of SERVICE_TYPES) {
            expect(isServiceType(service)).toBe(true)
        }
    })

    test('rejects unknown slugs so routes 404 instead of failing later', () => {
        for (const slug of ['queue', 'stroage', '', 'constructor', '__proto__', 'toString']) {
            expect(isServiceType(slug)).toBe(false)
        }
    })

    test('catalogEntry returns undefined for an unknown slug', () => {
        expect(catalogEntry('queue')).toBeUndefined()
    })
})
