/**
 * Copy the Workers PBKDF2 patch over Payload 3.90.0's password hasher before
 * `next build` bundles it into the Worker.
 *
 * Skip when a newer Payload already embeds iteration counts (payloadcms/payload#18276).
 * Fail when the installed hasher is neither the known 3.90.0 file nor that upstream fix.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const payloadPackageJson = path.join(root, 'node_modules/payload/package.json')
const target = path.join(
  root,
  'node_modules/payload/dist/auth/strategies/local/generatePasswordSaltHash.js',
)
const replacement = path.join(
  root,
  'scripts/payload-workers-pbkdf2/generatePasswordSaltHash.js',
)

const upstreamMarkers = ['isCloudflareWorkersRuntime', 'cloudflareWorkersMaxPBKDF2Iterations']

function installedSource() {
  return fs.readFileSync(target, 'utf8')
}

function hasUpstreamFix(source) {
  return upstreamMarkers.some((marker) => source.includes(marker))
}

if (!fs.existsSync(payloadPackageJson) || !fs.existsSync(target)) {
  console.error(
    'payload is not installed. Run npm ci before building so the Workers PBKDF2 patch can be applied.',
  )
  process.exit(1)
}

const payloadVersion = JSON.parse(fs.readFileSync(payloadPackageJson, 'utf8')).version
const source = installedSource()

if (hasUpstreamFix(source)) {
  console.log(
    `Payload ${payloadVersion} already caps PBKDF2 iterations for Workers. Skipping the local patch.`,
  )
  process.exit(0)
}

const alreadyPatched = source.includes('PAYLOAD_WORKERS_PBKDF2_PATCH')
const isStock390 =
  payloadVersion === '3.90.0' && source.includes("const currentPasswordHashPrefix = 'pbkdf2-sha256-v1:'")

if (!alreadyPatched && !isStock390) {
  console.error(
    `Refusing to patch Payload ${payloadVersion} password hashing. Expected 3.90.0's pbkdf2-sha256-v1 hasher, or an upstream Workers cap.`,
  )
  process.exit(1)
}

fs.copyFileSync(replacement, target)
const patched = installedSource()
if (!patched.includes('PAYLOAD_WORKERS_PBKDF2_PATCH') || !patched.includes('pbkdf2-sha256-v2-i')) {
  console.error('Workers PBKDF2 patch did not land in payload/dist.')
  process.exit(1)
}

console.log(
  'Patched Payload 3.90.0 password hashing so Cloudflare Workers can register and log in the first user.',
)
