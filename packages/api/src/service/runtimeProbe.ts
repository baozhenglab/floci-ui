import {RuntimeUnavailableError} from '../cloud-spi/errors'
import type {CloudProvider} from '../cloud-spi/types'

/**
 * Liveness probes per runtime.
 *
 * Cloud status used to be inferred from whether the *storage* adapter could list,
 * which meant a cloud whose storage worked reported "reachable" no matter what
 * else was broken, and a cloud with no storage adapter reported "coming_soon"
 * even when its runtime was up. These probe the runtime itself.
 */
export type RuntimeProbe = () => Promise<void>

export const runtimeProbes: Record<CloudProvider, RuntimeProbe> = {
    aws: () => probeHttp(`${awsEndpoint()}/_floci/health`, 'Floci core'),
}

/**
 * Returns a string rather than `string | null`: every registered cloud has an
 * endpoint. `CloudStatus.endpoint` stays nullable because the field is also
 * populated for a service with no adapter behind it.
 */
export function endpointFor(_cloud: CloudProvider): string {
    return awsEndpoint()
}

export function awsEndpoint(): string {
    return process.env.FLOCI_ENDPOINT ?? 'http://localhost:4566'
}

async function probeHttp(endpoint: string, label: string): Promise<void> {
    let res: Response
    try {
        res = await globalThis.fetch(endpoint, {method: 'GET'})
    } catch (error) {
        throw new RuntimeUnavailableError(`Cannot reach ${label} at ${endpoint}`, {cause: error})
    }
    if (res.status >= 500) {
        throw new RuntimeUnavailableError(`${label} at ${endpoint} returned HTTP ${res.status}`)
    }
}
