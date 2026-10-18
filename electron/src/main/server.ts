import { createServer, type Server } from 'node:http'

/**
 * A tiny HTTP server on 127.0.0.1 for one player page. The page must come from a real http(s)
 * origin: a YouTube embed in a page loaded from file://, a custom scheme or a data URL has no valid
 * referrer and fails with "Error 153".
 */
export interface Request { method: string; path: string; query: URLSearchParams; body: string }
export interface Response { status: number; type: string; body: string | Buffer }

export const json = (obj: unknown, status = 200): Response => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(obj) })
export const text = (s: string, status = 200, type = 'text/plain; charset=utf-8'): Response => ({ status, type, body: s })

export class LocalServer {
  private server: Server
  port = 0

  constructor(handler: (req: Request) => Response | Promise<Response>) {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', async () => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        let r: Response
        try {
          r = await handler({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body: Buffer.concat(chunks).toString('utf8') })
        } catch (e) {
          r = json({ error: String(e) }, 500)
        }
        res.writeHead(r.status, { 'Content-Type': r.type, 'Cache-Control': 'no-store', Connection: 'close' })
        res.end(r.body)
      })
    })
  }

  /** Starts listening and returns the port. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        const a = this.server.address()
        this.port = typeof a === 'object' && a ? a.port : 0
        resolve(this.port)
      })
    })
  }

  stop(): void {
    this.server.close()
    this.server.closeAllConnections?.()
  }
}
