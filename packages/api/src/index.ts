import "dotenv/config";
import { createApp } from "./app";
import { authBanner, resolveAuthConfig } from "./auth";

// Browser origins allowed to call the API cross-origin, and — for unsafe methods
// — the only origins permitted to send state-changing requests at all.
const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:4500"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const auth = resolveAuthConfig();

const app = createApp({ auth, allowedOrigins });

const port = Number(process.env.PORT ?? 4501);

console.log(authBanner(auth, allowedOrigins[0] ?? `http://localhost:${port}`));

export default { port, fetch: app.fetch };
