/**
 * Composes the HTTP app: CORS, logging, the auth gate, the route tree and the
 * static SPA handlers.
 *
 * Kept separate from index.ts so tests can build an app with an explicit auth
 * config and drive it through `app.request(...)`, without index.ts's boot-time
 * side effects (env resolution, token generation, the console banner).
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { setCookie } from "hono/cookie";
import { logger } from "hono/logger";
import eks from "./routes/eks";
import rds from "./routes/rds";
import ec2 from "./routes/ec2";
import secretsmanager from "./routes/secretsmanager";
import clouds from "./routes/clouds";
import {
  createAuthMiddleware,
  isAuthorized,
  TOKEN_COOKIE,
  TOKEN_QUERY,
  type AuthConfig,
} from "./auth";

/**
 * `/api/health` keeps container and CI probes working without a credential, and
 * `/api/session` is the token-exchange endpoint itself — it validates the token
 * it is handed, so gating it would make the cookie unobtainable.
 */
export const PUBLIC_API_PATHS = new Set(["/api/health", "/api/session"]);

/**
 * The session URL carries the token as a query parameter, and hono's logger
 * prints the request path verbatim — which would put a live credential into
 * stdout, `docker compose logs`, and CI job output. Mask it at the log boundary.
 */
export function redactTokenQuery(message: string): string {
  return message.replace(
    new RegExp(`([?&]${TOKEN_QUERY}=)[^&\\s]+`, "gi"),
    "$1<redacted>",
  );
}

export interface CreateAppOptions {
  auth: AuthConfig;
  allowedOrigins: readonly string[];
  /** Disabled in tests to keep the suite output readable. */
  requestLogging?: boolean;
  /** Disabled in tests: there is no ./public to serve. */
  serveSpa?: boolean;
}

export function createApp({
  auth,
  allowedOrigins,
  requestLogging = true,
  serveSpa = true,
}: CreateAppOptions) {
  const app = new Hono();

  // ─── CORS ───────────────────────────────────────────────────────────────────
  // Allow-list every route, not just Secrets Manager. This server drives real
  // cloud SDKs with server-side credentials, so no route should answer an
  // arbitrary cross-origin caller. The default is the frontend's dev origin;
  // production serves the SPA from this same origin, where requests are
  // same-origin and unaffected.
  //
  // A single CORS middleware handles every path: stacking two `cors()` calls
  // would either short-circuit the OPTIONS preflight in the wrong handler or let
  // the later one overwrite `Access-Control-Allow-Origin` on real requests.
  //
  // CORS restricts *browsers*, never `curl` — the auth gate is what actually
  // protects these endpoints.
  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  );

  if (requestLogging) {
    app.use("*", logger((message, ...rest) => {
      console.log(redactTokenQuery(message), ...rest.map(String).map(redactTokenQuery));
    }));
  }

  app.use(
    "/api/*",
    createAuthMiddleware(auth, {
      isPublic: (path) => PUBLIC_API_PATHS.has(path),
      allowedOrigins,
    }),
  );

  app.get("/api/health", (c) => c.json({ status: "ok", auth: auth.mode }));

  // Exchange a valid token for an httpOnly cookie, then hand the operator the
  // console. The redirect is what makes the printed URL a one-click entry point.
  app.get("/api/session", (c) => {
    if (!isAuthorized(c, auth)) {
      return c.json(
        {
          error: "Unauthorized",
          code: "unauthorized",
          message: "Unauthorized",
          detail: `Append ?${TOKEN_QUERY}=<token> using the token printed in the API server log.`,
        },
        401,
      );
    }

    if (auth.mode === "enforced") {
      setCookie(c, TOKEN_COOKIE, auth.token, {
        httpOnly: true,
        // Lax still blocks cross-site POSTs but survives the top-level
        // navigation this endpoint exists to serve.
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return c.redirect("/");
  });

  app.route("/api/eks", eks);
  app.route("/api/rds", rds);
  app.route("/api/ec2", ec2);
  app.route("/api/secretsmanager", secretsmanager);
  app.route("/api/clouds", clouds);

  if (serveSpa) {
    // Serve static frontend files when public/ directory is present (production).
    // These sit below the auth gate, so nothing secret may be built into the
    // bundle — the SPA authenticates with the /api/session cookie instead.
    app.use("*", serveStatic({ root: "./public" }));
    app.get("*", serveStatic({ path: "./public/index.html" }));
  }

  return app;
}
