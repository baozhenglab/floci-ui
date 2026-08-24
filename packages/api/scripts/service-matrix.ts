/**
 * Print the service-coverage matrix as markdown, derived from the service
 * catalog and the adapter registry.
 *
 * The README table used to be hand-maintained and drifted from the code. Paste
 * this output into the README whenever navigation changes:
 *
 *     bun run scripts/service-matrix.ts
 *
 * Reads the registry only — no runtime calls — so it works offline.
 */

import {createCloudAdapterRegistry} from '../src/cloudProxy'
import {SERVICE_CATALOG_ENTRIES, displayNameFor} from '../src/cloud-spi/serviceCatalog'

const registry = createCloudAdapterRegistry()

function cell(service: string): string {
    const entry = SERVICE_CATALOG_ENTRIES.find((candidate) => candidate.service === service)
    if (entry?.legacyAvailability?.aws === 'available') return 'Yes (legacy page)'

    const adapter = registry.get('aws', service as never)
    if (!adapter) return 'No'

    const override = adapter.descriptorOverride?.()
    if (override?.availability === 'coming_soon') return 'Runtime gap'

    return `Yes (${adapter.schema().actions.join(', ')})`
}

const rows = SERVICE_CATALOG_ENTRIES.map(
    (entry) => `| ${entry.group} | ${displayNameFor(entry)} | ${cell(entry.service)} |`,
)

console.log('| Group | Service | AWS |')
console.log('|---|---|---|')
console.log(rows.join('\n'))

const runtimeGaps = SERVICE_CATALOG_ENTRIES.flatMap((entry) => {
    const override = registry.get('aws', entry.service as never)?.descriptorOverride?.()
    return override?.reason ? [`- ${displayNameFor(entry)}: ${override.reason}`] : []
})

if (runtimeGaps.length > 0) {
    console.log('\nRuntime gaps:\n')
    console.log(runtimeGaps.join('\n'))
}
