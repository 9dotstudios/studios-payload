/**
 * Fail the build if the Worker bundle still contains only Payload's original
 * 600,000-iteration hasher. Webpack treats node_modules as immutable, so a
 * restored `.next` cache can ship the unpatched file even after we patch it.
 */
import fs from 'node:fs'
import path from 'node:path'

const needle = 'pbkdf2-sha256-v2'
const roots = ['.open-next', path.join('.next', 'server')]
const found = []

function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'cache') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath)
      continue
    }
    if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue
    const stat = fs.statSync(fullPath)
    if (stat.size > 80_000_000) continue
    const text = fs.readFileSync(fullPath, 'utf8')
    if (text.includes(needle)) found.push(fullPath)
  }
}

for (const root of roots) walk(root)

if (found.length === 0) {
  console.error(
    `Build output is missing ${needle}. The Worker would still request 600,000 PBKDF2 iterations and first-user registration would return 500.`,
  )
  process.exit(1)
}

console.log(`Workers PBKDF2 patch is in the bundle (${found.length} file(s)):`)
for (const file of found) console.log(`  ${file}`)
