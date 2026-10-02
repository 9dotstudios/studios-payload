// default open-next.config.ts file created by @opennextjs/cloudflare
import { defineCloudflareConfig } from '@opennextjs/cloudflare/config'

/**
 * `npm run build` is `opennextjs-cloudflare build`.
 * Point the adapter at `next build` directly so it does not call `npm run build` again.
 * Matches the with-cloudflare-d1 template (`next build --webpack`).
 */
const cloudflareConfig = defineCloudflareConfig({})

export default {
  ...cloudflareConfig,
  buildCommand:
    'cross-env NODE_OPTIONS="--no-deprecation --max-old-space-size=8000" next build --webpack',
}
