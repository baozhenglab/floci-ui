/**
 * Session-token auth for the console API.
 *
 * This server holds real cloud credentials and exposes destructive operations
 * (terminate, delete, force-delete secrets) on a generic contract, so `/api/*`
 * is deny-by-default. Without a gate, any page open in the same browser could
 * drive those endpoints via the local port.
 *
 * The token model is deliberately Jupyter-shaped: a token is read from
 * `FLOCI_UI_TOKEN` when supplied, otherwise generated per boot and printed with
 * a ready-to-open URL. `GET /api/session?token=…` exchanges it for an httpOnly
 * cookie so the SPA authenticates for the rest of the session with no build-time
 * configuration — in dev the Vite proxy makes `/api` same-origin, and in
 * production the API serves the SPA itself, so one cookie covers both.
 *
 * Auth is a transport concern rather than an adapter failure, so the 401 mirrors
 * the `CloudErrorBody` wire shape without joining the `CloudErrorCode` union.
 */

import type {Context, MiddlewareHandler, Next} from 'hono'
import {getCookie} from 'hono/cookie'

export const TOKEN_HEADER = 'x-floci-ui-token'
export const TOKEN_COOKIE = 'floci_ui_token'
/** Query fallback, mirroring the account header's own fallback in routes/clouds.ts. */
export const TOKEN_QUERY = 'token'

export type AuthMode = 'enforced' | 'disabled'

export interface AuthConfig {
    mode: AuthMode
    token: string
    /** True when no token was configured and one was minted for this boot. */
    generated: boolean
}

export interface AuthEnv {
    FLOCI_UI_TOKEN?: string
    FLOCI_UI_AUTH?: string
    /** Present so `process.env` is assignable; TS rejects an all-optional target. */
    [key: string]: string | undefined
}

/**
 * Resolve the auth configuration from the environment.
 *
 * `FLOCI_UI_AUTH=off` is an explicit, documented opt-out for throwaway
 * sandboxes. It has to be spelled out — an empty or missing `FLOCI_UI_TOKEN`
 * generates a token instead of silently disabling the gate, so the default
 * posture is always closed.
 */
export function resolveAuthConfig(
    env: AuthEnv = process.env,
    generateToken: () => string = defaultTokenFactory,
): AuthConfig {
    if ((env.FLOCI_UI_AUTH ?? '').trim().toLowerCase() === 'off') {
        return {mode: 'disabled', token: '', generated: false}
    }

    const configured = (env.FLOCI_UI_TOKEN ?? '').trim()
    if (configured) return {mode: 'enforced', token: configured, generated: false}

    return {mode: 'enforced', token: generateToken(), generated: true}
}

function defaultTokenFactory(): string {
    return crypto.randomUUID().replace(/-/g, '')
}

/**
 * Compare without an early exit so a wrong guess costs the same regardless of
 * how many leading characters matched. Length is not treated as secret.
 */
export function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

/**
 * Collect every credential the request presents.
 *
 * All of them are returned rather than the highest-priority one: a stale cookie
 * from an earlier boot must not shadow a fresh `?token=`, or the printed session
 * URL could never re-authenticate a browser that already holds a dead cookie.
 */
export function presentedTokens(c: Context): string[] {
    const found: string[] = []

    const header = c.req.header(TOKEN_HEADER)
    if (header) found.push(header.trim())

    const authorization = c.req.header('authorization')
    if (authorization) {
        const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
        if (match) found.push(match[1].trim())
    }

    const cookie = getCookie(c, TOKEN_COOKIE)
    if (cookie) found.push(cookie.trim())

    // Direct links (object downloads, shared URLs) cannot set headers.
    const query = c.req.query(TOKEN_QUERY)
    if (query) found.push(query.trim())

    return found
}

export function isAuthorized(c: Context, config: AuthConfig): boolean {
    if (config.mode === 'disabled') return true
    const token = config.token
    // Compare against all of them so presenting one good credential is enough.
    // `some` short-circuits, but each individual comparison is constant-time.
    return presentedTokens(c).some((presented) => safeEqual(presented, token))
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Cookie auth needs its own CSRF defence: cookies are not isolated by port, so
 * a page served from any other localhost port shares this origin's cookie jar.
 * CORS blocks preflighted cross-origin calls, but a "simple" cross-origin POST
 * is sent (and executed) before the browser withholds the response.
 *
 * Browsers always attach `Origin` to an unsafe-method request, so requiring it
 * to be allow-listed rejects the attacker page while leaving non-browser callers
 * — which send no `Origin` and carry no ambient cookie — unaffected.
 */
export function originAllowed(c: Context, allowedOrigins: readonly string[]): boolean {
    if (SAFE_METHODS.has(c.req.method)) return true
    const origin = c.req.header('origin')
    if (!origin) return true
    return allowedOrigins.includes(origin)
}

export interface AuthMiddlewareOptions {
    /**
     * Paths that must stay reachable without a credential: the liveness probe
     * and the token-exchange endpoint itself. Everything else is gated.
     */
    isPublic?: (path: string, method: string) => boolean
    /**
     * Origins permitted to send unsafe-method requests. Shares the CORS
     * allow-list so the two cannot drift apart.
     */
    allowedOrigins?: readonly string[]
}

const UNAUTHORIZED_BODY = {
    error: 'Unauthorized',
    code: 'unauthorized',
    message: 'Unauthorized',
    detail:
        'This console API requires a session token. Open the URL printed in the ' +
        'API server log, or send the token as the x-floci-ui-token header.',
} as const

const FORBIDDEN_ORIGIN_BODY = {
    error: 'Forbidden',
    code: 'origin_not_allowed',
    message: 'Forbidden',
    detail:
        'This origin may not send state-changing requests. Add it to ' +
        'CORS_ALLOWED_ORIGINS if it is a trusted console origin.',
} as const

export function createAuthMiddleware(
    config: AuthConfig,
    options: AuthMiddlewareOptions = {},
): MiddlewareHandler {
    const isPublic = options.isPublic ?? (() => false)
    const allowedOrigins = options.allowedOrigins ?? []

    return async (c: Context, next: Next) => {
        // Preflight carries no credentials by design; the CORS middleware
        // already decides whether the origin may talk to us at all.
        if (c.req.method === 'OPTIONS') return next()

        // Checked before the credential so a cross-origin page cannot use an
        // ambient cookie, and cannot probe token validity either.
        if (!originAllowed(c, allowedOrigins)) return c.json(FORBIDDEN_ORIGIN_BODY, 403)

        if (isPublic(c.req.path, c.req.method)) return next()
        if (isAuthorized(c, config)) return next()
        return c.json(UNAUTHORIZED_BODY, 401)
    }
}

/**
 * The banner is the only place the generated token is disclosed, so it prints
 * the frontend origin rather than the API port: that URL sets the cookie and
 * lands the operator on a working console in one step.
 */
export function authBanner(config: AuthConfig, frontendOrigin: string): string {
    if (config.mode === 'disabled') {
        return [
            '',
            '  ⚠  floci-api: authentication is DISABLED (FLOCI_UI_AUTH=off).',
            '     Every /api route is open to any process and page on this machine.',
            '',
        ].join('\n')
    }

    if (!config.generated) {
        return [
            '',
            '  floci-api: authentication enforced using FLOCI_UI_TOKEN.',
            '',
        ].join('\n')
    }

    const url = `${frontendOrigin}/api/session?${TOKEN_QUERY}=${config.token}`
    return [
        '',
        '  floci-api: authentication enforced with a token generated for this boot.',
        '',
        '  Open the console with:',
        `      ${url}`,
        '',
        `  Or set a stable token:  FLOCI_UI_TOKEN=<your-token>`,
        '',
    ].join('\n')
}
