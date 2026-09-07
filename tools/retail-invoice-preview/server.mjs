/* global process, console, URL */
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const directory = fileURLToPath(new URL('.', import.meta.url))
const previewBuild = resolve(directory, '../../node_modules/.cache/retail-invoice-preview')
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' }

function reply(response, status, body, contentType = 'text/plain; charset=utf-8', method = 'GET') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src blob:; frame-src blob:; base-uri 'none'",
  })
  response.end(method === 'HEAD' ? undefined : body)
}

export function createPreviewHandler(distDirectory) {
  return async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(response, 405, 'Only GET and HEAD are available.')
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local.invalid').pathname)
      const file = pathname === '/' || pathname === '/retail-sales' || pathname === '/retail-sales/'
        ? 'index.html'
        : /^\/assets\/[A-Za-z0-9._-]+\.(?:js|css|png|svg|woff2?)$/.test(pathname) ? pathname.slice(1) : null
      if (!file) return reply(response, 404, 'Not found.')
      const root = await realpath(distDirectory)
      const target = await realpath(resolve(root, file))
      const child = relative(root, target)
      if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) return reply(response, 404, 'Not found.')
      reply(response, 200, await readFile(target), contentTypes[extname(target)], request.method)
    } catch {
      reply(response, 404, 'Preview file not found. Build the local preview first.')
    }
  }
}

export function createCertificateHandler(publicCertificate) {
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(response, 405, 'Only GET and HEAD are available.')
    if (request.url !== '/ccm-retail-preview-ca.cer') return reply(response, 404, 'Only the public local test certificate is available on this port.')
    reply(response, 200, publicCertificate, 'application/x-x509-ca-cert', request.method)
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8788' },
    http: { type: 'boolean', default: false },
    'cert-dir': { type: 'string', default: resolve(directory, '.local-https') },
    'certificate-port': { type: 'string' },
  } })
  const port = Number(values.port)
  const certificatePort = values['certificate-port'] === undefined ? null : Number(values['certificate-port'])
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (certificatePort !== null && (!Number.isInteger(certificatePort) || certificatePort < 1 || certificatePort > 65535 || certificatePort === port))) {
    throw new Error('Use valid, different ports from 1 to 65535.')
  }
  if (values.http && values.host !== '127.0.0.1' && values.host !== 'localhost' && values.host !== '::1') {
    throw new Error('Plain HTTP preview is limited to loopback. Use trusted HTTPS for iPhone LAN acceptance.')
  }
  if (values.http && certificatePort !== null) throw new Error('The certificate port is only available with HTTPS.')
  await readFile(resolve(previewBuild, 'index.html'))
  const handler = createPreviewHandler(previewBuild)
  const certificateDirectory = resolve(values['cert-dir'])
  const publicCertificate = certificatePort === null ? null : await readFile(resolve(certificateDirectory, 'ccm-retail-preview-ca.cer'))
  const server = values.http ? createHttpServer(handler) : createHttpsServer({
    key: await readFile(resolve(certificateDirectory, 'server.key')),
    cert: await readFile(resolve(certificateDirectory, 'server.crt')),
    minVersion: 'TLSv1.2',
  }, handler)
  server.on('error', error => { console.error(`Local preview could not start: ${error.message}`); process.exitCode = 1 })
  server.listen(port, values.host, () => console.log(`Local invoice preview: ${values.http ? 'http' : 'https'}://${values.host}:${port}/retail-sales`))
  if (certificatePort !== null) {
    const certificateServer = createHttpServer(createCertificateHandler(publicCertificate))
    certificateServer.on('error', error => { console.error(`Public certificate endpoint could not start: ${error.message}`); process.exitCode = 1 })
    certificateServer.listen(certificatePort, values.host, () => console.log(`Public test CA: http://${values.host}:${certificatePort}/ccm-retail-preview-ca.cer`))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Local preview could not start: ${error.message}`); process.exitCode = 1 })
}
