/**
 * Prove the patched hasher survives the Workers PBKDF2 cap and still verifies.
 * Simulates `NotSupportedError: iteration counts above 100000 are not supported`.
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hasherURL = pathToFileURL(
  path.join(root, 'node_modules/payload/dist/auth/strategies/local/generatePasswordSaltHash.js'),
).href
const authenticateURL = pathToFileURL(
  path.join(root, 'node_modules/payload/dist/auth/strategies/local/authenticate.js'),
).href

const originalPbkdf2 = crypto.pbkdf2
const workersError = (iterations) => {
  const err = new Error(
    `Pbkdf2 failed: iteration counts above 100000 are not supported (requested ${iterations}).`,
  )
  err.name = 'NotSupportedError'
  return err
}

function installWorkersCap() {
  crypto.pbkdf2 = (password, salt, iterations, keyLength, digest, callback) => {
    if (iterations > 100000) {
      callback(workersError(iterations))
      return
    }
    return originalPbkdf2(password, salt, iterations, keyLength, digest, callback)
  }
}

const { generatePasswordSaltHash, getPasswordHashParameters, isCurrentPasswordHash } =
  await import(hasherURL)
const { authenticateLocalStrategy } = await import(authenticateURL)

const v1 = getPasswordHashParameters('pbkdf2-sha256-v1:abcdef')
if (v1.iterations !== 600000 || v1.keyLength !== 32 || v1.hash !== 'abcdef') {
  throw new Error(`v1 parameters were rewritten: ${JSON.stringify(v1)}`)
}

installWorkersCap()

const password = 'temp-probe-password'
const { hash, salt } = await generatePasswordSaltHash({
  collection: { slug: 'users' },
  isPasswordAuthenticated: true,
  password,
  req: {},
})

if (!/^pbkdf2-sha256-v2-i100000-l32:[0-9a-f]{64}$/.test(hash)) {
  throw new Error(`Workers hash was not capped at 100000 iterations: ${hash}`)
}
if (!isCurrentPasswordHash(hash)) {
  throw new Error('Workers hash was not treated as current')
}

const params = getPasswordHashParameters(hash)
if (params.iterations !== 100000 || params.keyLength !== 32) {
  throw new Error(`embedded parameters were not readable: ${JSON.stringify(params)}`)
}

const authed = await authenticateLocalStrategy({
  doc: { id: 1, hash, salt },
  password,
})
if (!authed || authed.shouldUpdatePasswordHash) {
  throw new Error('Workers hash did not authenticate without a rehash')
}

const rejected = await authenticateLocalStrategy({
  doc: { id: 1, hash, salt },
  password: 'wrong-password',
})
if (rejected !== null) {
  throw new Error('wrong password was accepted')
}

crypto.pbkdf2 = originalPbkdf2

const nodeResult = await generatePasswordSaltHash({
  collection: { slug: 'users' },
  isPasswordAuthenticated: true,
  password,
  req: {},
})
if (!/^pbkdf2-sha256-v2-i600000-l32:[0-9a-f]{64}$/.test(nodeResult.hash)) {
  throw new Error(`Node hash did not keep 600000 iterations: ${nodeResult.hash}`)
}
const nodeAuth = await authenticateLocalStrategy({
  doc: { id: 1, hash: nodeResult.hash, salt: nodeResult.salt },
  password,
})
if (!nodeAuth) {
  throw new Error('Node hash did not authenticate')
}

console.log(
  'PBKDF2 patch verified: Workers hashes use 100000 iterations and still log in; Node keeps 600000.',
)
