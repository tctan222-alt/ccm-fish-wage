import { existsSync } from 'node:fs'
import process from 'node:process'
import console from 'node:console'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Pinned to the compiler used by firebase-tools 15.29.0. Recalibrate the
// executable estimate against a deployed ruleset when upgrading this version.
const cache = process.env.FIREBASE_EMULATORS_PATH || join(homedir(), '.cache', 'firebase', 'emulators')
const jar = join(cache, 'cloud-firestore-emulator-v1.22.0.jar')
if (!existsSync(jar)) {
  console.error('Firestore compiler missing. Run npm run test:rules with firebase-tools 15.29.0 first.')
  process.exit(1)
}
const result = spawnSync('java', ['--class-path', jar, join(root, 'scripts', 'CheckRulesSize.java'),
  resolve(process.argv[2] || join(root, 'firestore.rules'))], { cwd: root, stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
