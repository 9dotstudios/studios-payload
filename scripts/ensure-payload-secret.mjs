/**
 * Ensure the Worker has a PAYLOAD_SECRET runtime secret.
 * Does not print the secret. Skips when one is already configured.
 * Workers Builds supplies Wrangler credentials; local runs need `wrangler login`.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const workerName = 'studios-payload'

function wrangler(args, options = {}) {
  return execFileSync('wrangler', args, {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url),
    ...options,
  })
}

function secretNames() {
  const raw = wrangler(['secret', 'list', '--name', workerName])
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1) {
    throw new Error('wrangler secret list did not return JSON')
  }
  const parsed = JSON.parse(raw.slice(start, end + 1))
  if (!Array.isArray(parsed)) return []
  return parsed.map((entry) => entry?.name).filter(Boolean)
}

let names = []
try {
  names = secretNames()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    `Could not list Worker secrets for ${workerName}. Set PAYLOAD_SECRET with \`wrangler secret put PAYLOAD_SECRET\` (generate one with \`openssl rand -hex 32\`).`,
  )
  console.error(message.split('\n')[0])
  process.exit(1)
}

if (names.includes('PAYLOAD_SECRET')) {
  console.log(`PAYLOAD_SECRET is already set on ${workerName}.`)
  process.exit(0)
}

const secret = `${randomBytes(32).toString('hex')}\n`
try {
  wrangler(['secret', 'put', 'PAYLOAD_SECRET', '--name', workerName], {
    input: secret,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    'Failed to set PAYLOAD_SECRET. Create it in the Cloudflare dashboard (Workers → studios-payload → Settings → Variables and Secrets) or run `wrangler secret put PAYLOAD_SECRET`.',
  )
  console.error(message.split('\n')[0])
  process.exit(1)
}

console.log(
  `Set a new PAYLOAD_SECRET on ${workerName}. The value was not printed. Create the first admin user at /admin.`,
)
