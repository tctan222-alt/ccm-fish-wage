import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

export async function buildClient(outputDir = fileURLToPath(new URL('../node_modules/.cache/voice-asr-benchmark/', import.meta.url))): Promise<void> {
  const client = fileURLToPath(new URL('../client/', import.meta.url))
  await mkdir(outputDir, { recursive: true })
  // No environment substitutions, backend imports, sourcemaps, external CDN or secret-bearing config.
  await build({ entryPoints: [join(client, 'app.ts')], outfile: join(outputDir, 'app.js'), bundle: true, platform: 'browser', target: 'es2022', minify: true })
  await Promise.all(['index.html', 'style.css'].map(file => copyFile(join(client, file), join(outputDir, file))))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildClient()
