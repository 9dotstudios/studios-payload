// PAYLOAD_WORKERS_PBKDF2_PATCH
// Payload 3.90.0 always hashes passwords with 600,000 PBKDF2-SHA256 iterations.
// Cloudflare Workers rejects iteration counts above 100,000
// (NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported).
// That throws during first-user registration and login.
//
// This build-time replacement of payload/dist/auth/strategies/local/generatePasswordSaltHash.js
// keeps 600,000 iterations on Node.js. On Workers it records the platform cap in the hash:
//   pbkdf2-sha256-v2-i<iterations>-l<keyLength>:<hex>
// Verification reads those parameters back, so a hash created on Workers still verifies
// after Payload embeds the same format upstream (payloadcms/payload#18276).
import crypto from 'crypto'
import { ValidationError } from '../../../errors/index.js'
import { password } from '../../../fields/validations.js'

const legacyV1PasswordHashPrefix = 'pbkdf2-sha256-v1:'
const legacyV1PasswordHashIterations = 600000
const legacyV1PasswordHashKeyLength = 32
const defaultPasswordHashIterations = 600000
const currentPasswordHashKeyLength = 32
const legacyPasswordHashIterations = 25000
const legacyPasswordHashKeyLength = 512
const workersPBKDF2IterationCap = 100000
const currentPasswordHashRegex = /^pbkdf2-sha256-v2-i(\d+)-l(\d+):([0-9a-f]+)$/

export const generatePasswordSaltHash = async ({
  collection,
  isPasswordAuthenticated,
  password: passwordToSet,
  req,
}) => {
  if (!isPasswordAuthenticated) {
    const validationResult = password(passwordToSet, {
      name: 'password',
      type: 'text',
      blockData: {},
      data: {},
      event: 'submit',
      path: ['password'],
      preferences: {
        fields: {},
      },
      req,
      required: true,
      siblingData: {},
    })
    if (typeof validationResult === 'string') {
      throw new ValidationError({
        collection: collection?.slug,
        errors: [
          {
            message: validationResult,
            path: 'password',
          },
        ],
      })
    }
  }
  const saltBuffer = await randomBytes()
  const salt = saltBuffer.toString('hex')
  const { hashRaw, iterations } = await pbkdf2Promisified({
    iterations: defaultPasswordHashIterations,
    keyLength: currentPasswordHashKeyLength,
    password: passwordToSet,
    salt,
  })
  const hash = `pbkdf2-sha256-v2-i${iterations}-l${currentPasswordHashKeyLength}:${hashRaw.toString('hex')}`
  return {
    hash,
    salt,
  }
}

export const getPasswordHashParameters = (hash) => {
  const match = currentPasswordHashRegex.exec(hash)
  if (match) {
    return {
      hash: match[3],
      iterations: Number(match[1]),
      keyLength: Number(match[2]),
    }
  }
  if (typeof hash === 'string' && hash.startsWith(legacyV1PasswordHashPrefix)) {
    return {
      hash: hash.slice(legacyV1PasswordHashPrefix.length),
      iterations: legacyV1PasswordHashIterations,
      keyLength: legacyV1PasswordHashKeyLength,
    }
  }
  return {
    hash,
    iterations: legacyPasswordHashIterations,
    keyLength: legacyPasswordHashKeyLength,
  }
}

export const isCurrentPasswordHash = (hash) =>
  typeof hash === 'string' && currentPasswordHashRegex.test(hash)

function randomBytes() {
  return new Promise((resolve, reject) =>
    crypto.randomBytes(32, (err, saltBuffer) => (err ? reject(err) : resolve(saltBuffer))),
  )
}

function iterationCapFromError(err) {
  const message = err && typeof err.message === 'string' ? err.message : String(err)
  const match = message.match(/above (\d+) are not supported/i)
  if (match) return Number(match[1])
  if (err && (err.name === 'NotSupportedError' || /iteration counts/i.test(message))) {
    return workersPBKDF2IterationCap
  }
  return null
}

function pbkdf2Once(password, salt, iterations, keyLength) {
  return new Promise((resolve, reject) => {
    try {
      crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', (err, hashRaw) => {
        if (err) reject(err)
        else resolve(hashRaw)
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function pbkdf2Promisified({ iterations, keyLength, password, salt }) {
  try {
    const hashRaw = await pbkdf2Once(password, salt, iterations, keyLength)
    return { hashRaw, iterations }
  } catch (err) {
    const cap = iterationCapFromError(err)
    if (cap && iterations > cap) {
      const hashRaw = await pbkdf2Once(password, salt, cap, keyLength)
      return { hashRaw, iterations: cap }
    }
    throw err
  }
}
