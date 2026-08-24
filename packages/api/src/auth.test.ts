import {describe, expect, test} from 'bun:test'
import {Hono} from 'hono'
import {
    authBanner,
    createAuthMiddleware,
    resolveAuthConfig,
    safeEqual,
    TOKEN_COOKIE,
    TOKEN_HEADER,
    type AuthConfig,
} from './auth'

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

function enforced(token = TOKEN): AuthConfig {
    return {mode: 'enforced', token, generated: false}
}

function gatedApp(config: AuthConfig) {
    const app = new Hono()
    app.use('/api/*', createAuthMiddleware(config, {isPublic: (path) => path === '/api/health'}))
    app.get('/api/health', (c) => c.json({status: 'ok'}))
    app.get('/api/clouds', (c) => c.json({gated: true}))
    app.delete('/api/clouds', (c) => c.json({deleted: true}))
    return app
}

describe('resolveAuthConfig', () => {
    test('an explicit FLOCI_UI_AUTH=off disables the gate', () => {
        const config = resolveAuthConfig({FLOCI_UI_AUTH: 'off'}, () => 'unused')
        expect(config.mode).toBe('disabled')
        expect(config.generated).toBe(false)
    })

    test('opting out is case- and whitespace-insensitive', () => {
        expect(resolveAuthConfig({FLOCI_UI_AUTH: '  OFF '}, () => 'unused').mode).toBe('disabled')
    })

    test('a configured token is used verbatim and not reported as generated', () => {
        const config = resolveAuthConfig({FLOCI_UI_TOKEN: TOKEN}, () => 'generated')
        expect(config).toEqual({mode: 'enforced', token: TOKEN, generated: false})
    })

    test('a surrounding-whitespace token is trimmed rather than rejected', () => {
        expect(resolveAuthConfig({FLOCI_UI_TOKEN: `  ${TOKEN}  `}, () => 'generated').token).toBe(TOKEN)
    })

    // The default posture must be closed: a missing token generates one instead
    // of silently leaving every route open.
    test('a missing token generates one and stays enforced', () => {
        const config = resolveAuthConfig({}, () => 'generated-token')
        expect(config).toEqual({mode: 'enforced', token: 'generated-token', generated: true})
    })

    test('a blank token generates one rather than disabling the gate', () => {
        expect(resolveAuthConfig({FLOCI_UI_TOKEN: '   '}, () => 'generated-token').generated).toBe(true)
    })

    test('any FLOCI_UI_AUTH value other than off still enforces', () => {
        expect(resolveAuthConfig({FLOCI_UI_AUTH: 'on', FLOCI_UI_TOKEN: TOKEN}, () => 'x').mode).toBe('enforced')
    })

    test('the default token factory produces a non-trivial secret', () => {
        const a = resolveAuthConfig({})
        const b = resolveAuthConfig({})
        expect(a.token.length).toBeGreaterThanOrEqual(32)
        expect(a.token).not.toBe(b.token)
    })
})

describe('safeEqual', () => {
    test('accepts an exact match', () => {
        expect(safeEqual(TOKEN, TOKEN)).toBe(true)
    })

    test('rejects a length mismatch', () => {
        expect(safeEqual(TOKEN, `${TOKEN}x`)).toBe(false)
    })

    test('rejects an equal-length mismatch in the last position', () => {
        expect(safeEqual('abcd', 'abce')).toBe(false)
    })

    test('rejects an equal-length mismatch in the first position', () => {
        expect(safeEqual('abcd', 'zbcd')).toBe(false)
    })

    test('treats the empty string as equal only to itself', () => {
        expect(safeEqual('', '')).toBe(true)
        expect(safeEqual('', 'a')).toBe(false)
    })
})

describe('auth middleware', () => {
    test('rejects a gated route with no credential', async () => {
        const res = await gatedApp(enforced()).request('/api/clouds')
        expect(res.status).toBe(401)
    })

    test('the 401 mirrors the CloudErrorBody wire shape', async () => {
        const res = await gatedApp(enforced()).request('/api/clouds')
        const body = await res.json()
        expect(body.error).toBe('Unauthorized')
        expect(body.code).toBe('unauthorized')
        expect(body.message).toBe('Unauthorized')
        expect(typeof body.detail).toBe('string')
    })

    test('rejects a wrong token', async () => {
        const res = await gatedApp(enforced()).request('/api/clouds', {
            headers: {[TOKEN_HEADER]: 'not-the-token-not-the-token-xxxx'},
        })
        expect(res.status).toBe(401)
    })

    // Table-driven so a new credential channel cannot be added with only an
    // accept test: each channel must also reject a wrong value of the same
    // length (defeats a short-circuit compare) and of a different length.
    const channels: Array<{
        name: string
        request: (value: string) => [string, RequestInit]
    }> = [
        {
            name: 'the dedicated header',
            request: (value) => ['/api/clouds', {headers: {[TOKEN_HEADER]: value}}],
        },
        {
            name: 'an Authorization bearer token',
            request: (value) => ['/api/clouds', {headers: {authorization: `Bearer ${value}`}}],
        },
        {
            name: 'a lowercase bearer scheme',
            request: (value) => ['/api/clouds', {headers: {authorization: `bearer ${value}`}}],
        },
        {
            name: 'the session cookie',
            request: (value) => ['/api/clouds', {headers: {cookie: `${TOKEN_COOKIE}=${value}`}}],
        },
        {
            // Direct links (object downloads) cannot set headers.
            name: 'a query-parameter token',
            request: (value) => [`/api/clouds?token=${value}`, {}],
        },
    ]

    const sameLengthWrong = 'z'.repeat(TOKEN.length)

    for (const channel of channels) {
        test(`accepts the correct token via ${channel.name}`, async () => {
            const [path, init] = channel.request(TOKEN)
            expect((await gatedApp(enforced()).request(path, init)).status).toBe(200)
        })

        test(`rejects an equal-length wrong token via ${channel.name}`, async () => {
            const [path, init] = channel.request(sameLengthWrong)
            expect((await gatedApp(enforced()).request(path, init)).status).toBe(401)
        })

        test(`rejects a different-length wrong token via ${channel.name}`, async () => {
            const [path, init] = channel.request('short')
            expect((await gatedApp(enforced()).request(path, init)).status).toBe(401)
        })
    }

    test('accepts a good credential even when another channel presents a stale one', async () => {
        const res = await gatedApp(enforced()).request('/api/clouds', {
            headers: {cookie: `${TOKEN_COOKIE}=stale`, [TOKEN_HEADER]: TOKEN},
        })
        expect(res.status).toBe(200)
    })

    test('rejects when every presented channel is wrong', async () => {
        const res = await gatedApp(enforced()).request('/api/clouds?token=alsowrong', {
            headers: {cookie: `${TOKEN_COOKIE}=stale`, [TOKEN_HEADER]: 'nope'},
        })
        expect(res.status).toBe(401)
    })

    test('gates destructive methods too', async () => {
        const app = gatedApp(enforced())
        expect((await app.request('/api/clouds', {method: 'DELETE'})).status).toBe(401)
        const ok = await app.request('/api/clouds', {
            method: 'DELETE',
            headers: {[TOKEN_HEADER]: TOKEN},
        })
        expect(ok.status).toBe(200)
    })

    test('leaves the liveness probe reachable without a credential', async () => {
        const res = await gatedApp(enforced()).request('/api/health')
        expect(res.status).toBe(200)
    })

    // Preflight never carries credentials; CORS decides whether the origin may
    // talk to us at all.
    test('lets the CORS preflight through', async () => {
        const res = await gatedApp(enforced()).request('/api/clouds', {method: 'OPTIONS'})
        expect(res.status).not.toBe(401)
    })

    test('disabled mode lets every request through', async () => {
        const app = gatedApp({mode: 'disabled', token: '', generated: false})
        expect((await app.request('/api/clouds')).status).toBe(200)
        expect((await app.request('/api/clouds', {method: 'DELETE'})).status).toBe(200)
    })

    test('an empty configured token cannot be satisfied by an absent credential', async () => {
        // Guards the failure mode where `mode: 'enforced'` pairs with an empty
        // token and a credential-less request compares equal to it.
        const res = await gatedApp(enforced('')).request('/api/clouds')
        expect(res.status).toBe(401)
    })

    test('gates every route by default when no public matcher is supplied', async () => {
        const app = new Hono()
        app.use('/api/*', createAuthMiddleware(enforced()))
        app.get('/api/health', (c) => c.json({status: 'ok'}))
        expect((await app.request('/api/health')).status).toBe(401)
    })
})

describe('authBanner', () => {
    test('warns loudly when auth is disabled', () => {
        const banner = authBanner({mode: 'disabled', token: '', generated: false}, 'http://localhost:4500')
        expect(banner).toContain('DISABLED')
    })

    test('prints a one-click session URL for a generated token', () => {
        const banner = authBanner({mode: 'enforced', token: TOKEN, generated: true}, 'http://localhost:4500')
        expect(banner).toContain(`http://localhost:4500/api/session?token=${TOKEN}`)
    })

    test('never discloses a token the operator configured themselves', () => {
        const banner = authBanner(enforced(), 'http://localhost:4500')
        expect(banner).not.toContain(TOKEN)
    })
})
