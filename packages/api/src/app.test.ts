import {describe, expect, test} from 'bun:test'
import {createApp, PUBLIC_API_PATHS, redactTokenQuery} from './app'
import {TOKEN_COOKIE, TOKEN_HEADER, type AuthConfig} from './auth'

/**
 * Covers the composed app rather than the middleware in isolation: the gate is
 * only as good as its wiring, and a mis-scoped `app.use` or a missing entry in
 * the public-path set is invisible to a unit test of the middleware alone.
 */

const TOKEN = 'app-test-token-0123456789abcdef'
const ORIGIN = 'http://localhost:4500'

function app(auth: Partial<AuthConfig> = {}) {
    return createApp({
        auth: {mode: 'enforced', token: TOKEN, generated: false, ...auth},
        allowedOrigins: [ORIGIN],
        requestLogging: false,
        serveSpa: false,
    })
}

const authed = {[TOKEN_HEADER]: TOKEN}

describe('gated surface', () => {
    // Every credential-bearing router must sit behind the gate, including the
    // legacy hand-written ones that predate the cloud SPI.
    const gated = [
        '/api/clouds',
        '/api/clouds/aws/status',
        '/api/ec2/instances',
        '/api/eks/clusters',
        '/api/rds/instances',
        '/api/secretsmanager/secrets',
        '/api/secretsmanager/secret/value?id=x',
    ]

    for (const path of gated) {
        test(`401 without a credential: ${path}`, async () => {
            expect((await app().request(path)).status).toBe(401)
        })
    }

    test('a destructive generic-contract call is gated', async () => {
        const res = await app().request('/api/clouds/aws/services/storage/resources/bucket', {
            method: 'DELETE',
            headers: {origin: ORIGIN},
        })
        expect(res.status).toBe(401)
    })

    test('an unknown /api path is gated rather than falling through', async () => {
        expect((await app().request('/api/not-a-route')).status).toBe(401)
    })
})

describe('public surface', () => {
    test('health answers without a credential', async () => {
        const res = await app().request('/api/health')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({status: 'ok', auth: 'enforced'})
    })

    test('health does not disclose the token', async () => {
        const body = await (await app().request('/api/health')).text()
        expect(body).not.toContain(TOKEN)
    })

    test('the public set is exactly health and session', () => {
        expect([...PUBLIC_API_PATHS].sort()).toEqual(['/api/health', '/api/session'])
    })
})

describe('session exchange', () => {
    test('rejects a wrong token without setting a cookie', async () => {
        const res = await app().request('/api/session?token=wrong')
        expect(res.status).toBe(401)
        expect(res.headers.get('set-cookie')).toBeNull()
    })

    test('rejects a missing token', async () => {
        expect((await app().request('/api/session')).status).toBe(401)
    })

    test('mints an httpOnly, path-scoped cookie and redirects to the console', async () => {
        const res = await app().request(`/api/session?token=${TOKEN}`)
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('/')
        const cookie = res.headers.get('set-cookie') ?? ''
        expect(cookie).toContain(`${TOKEN_COOKIE}=${TOKEN}`)
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Path=/')
        expect(cookie).toContain('SameSite=Lax')
    })

    test('the minted cookie then authenticates a gated route', async () => {
        const minted = await app().request(`/api/session?token=${TOKEN}`)
        const cookie = (minted.headers.get('set-cookie') ?? '').split(';')[0]
        const res = await app().request('/api/clouds', {headers: {cookie}})
        expect(res.status).toBe(200)
    })

    // Regression: a cookie left over from an earlier boot must not shadow the
    // fresh token in the printed URL, or the operator is locked out for good.
    test('a stale cookie does not block re-authentication via the query token', async () => {
        const stale = `${TOKEN_COOKIE}=stale-token-from-a-previous-boot`
        const res = await app().request(`/api/session?token=${TOKEN}`, {headers: {cookie: stale}})
        expect(res.status).toBe(302)
    })

    test('a stale cookie does not block a gated route when a good token is also presented', async () => {
        const stale = `${TOKEN_COOKIE}=stale-token-from-a-previous-boot`
        const res = await app().request('/api/clouds', {headers: {cookie: stale, ...authed}})
        expect(res.status).toBe(200)
    })
})

describe('cross-origin state change', () => {
    test('rejects an unsafe method from an unlisted origin even with a valid token', async () => {
        const res = await app().request('/api/clouds/aws/services/storage/resources/b', {
            method: 'DELETE',
            headers: {origin: 'http://localhost:9999', ...authed},
        })
        expect(res.status).toBe(403)
    })

    test('the rejection names the origin problem rather than the credential', async () => {
        const res = await app().request('/api/ec2/instances', {
            method: 'POST',
            headers: {origin: 'http://evil.example', ...authed},
        })
        expect(res.status).toBe(403)
        expect((await res.json()).code).toBe('origin_not_allowed')
    })

    test('allows an unsafe method from the allow-listed origin', async () => {
        const res = await app().request('/api/clouds/aws/services/storage/resources/b', {
            method: 'DELETE',
            headers: {origin: ORIGIN, ...authed},
        })
        expect(res.status).not.toBe(403)
    })

    // curl and other non-browser callers send no Origin and carry no ambient
    // cookie, so they must stay usable.
    test('allows an unsafe method with no Origin header', async () => {
        const res = await app().request('/api/clouds/aws/services/storage/resources/b', {
            method: 'DELETE',
            headers: authed,
        })
        expect(res.status).not.toBe(403)
    })

    test('a safe method from an unlisted origin is not origin-blocked', async () => {
        const res = await app().request('/api/clouds', {
            headers: {origin: 'http://localhost:9999', ...authed},
        })
        expect(res.status).toBe(200)
    })

    test('an unlisted origin cannot probe token validity through the origin check', async () => {
        const withToken = await app().request('/api/ec2/instances', {
            method: 'POST',
            headers: {origin: 'http://evil.example', ...authed},
        })
        const withoutToken = await app().request('/api/ec2/instances', {
            method: 'POST',
            headers: {origin: 'http://evil.example'},
        })
        expect(withToken.status).toBe(withoutToken.status)
    })
})

describe('disabled mode', () => {
    test('opens the gate but still sets no cookie on session', async () => {
        const disabled = app({mode: 'disabled', token: ''})
        expect((await disabled.request('/api/clouds')).status).toBe(200)
        const res = await disabled.request('/api/session')
        expect(res.status).toBe(302)
        expect(res.headers.get('set-cookie')).toBeNull()
    })
})

describe('redactTokenQuery', () => {
    test('masks the token in a logged request line', () => {
        expect(redactTokenQuery('<-- GET /api/session?token=abc123')).toBe(
            '<-- GET /api/session?token=<redacted>',
        )
    })

    test('masks a token that is not the first query parameter', () => {
        expect(redactTokenQuery('GET /api/x?key=a&token=abc123&b=2')).toBe(
            'GET /api/x?key=a&token=<redacted>&b=2',
        )
    })

    test('leaves lines without a token untouched', () => {
        expect(redactTokenQuery('--> GET /api/clouds 200 1ms')).toBe('--> GET /api/clouds 200 1ms')
    })

    test('does not mask an unrelated parameter that merely ends in token', () => {
        expect(redactTokenQuery('GET /api/x?account_token=keepme')).toBe(
            'GET /api/x?account_token=keepme',
        )
    })
})
