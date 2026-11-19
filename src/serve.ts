// Node host for the fetch handler: `tri serve`.
import { createServer } from 'node:http';
import { UserError } from './app.ts';
import { MAX_BODY } from './web.ts';

/** Wraps a fetch handler in node:http. Starts listening; resolves with a message once the server closes. */
export function serve(handle: (req: Request) => Promise<Response>, port: number, host: string, where: string): Promise<string> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError(`bad --port ${port}`);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req as AsyncIterable<Buffer>) if ((size += c.length) <= MAX_BODY + 1) chunks.push(c);
    const headers = Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, [v].flat().join(', ')] as [string, string]]));
    const resp = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }));
    res.writeHead(resp.status, Object.fromEntries(resp.headers)).end(Buffer.from(await resp.arrayBuffer()));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('close', () => resolve('server stopped'));
    server.listen(port, host, () => console.log(`tri serving on http://${host}:${port}/ (data: ${where})`));
  });
}
