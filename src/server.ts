import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { openStore, demoId, StoreError } from './boards.js';
import { defaultPublicDir } from './config.js';
import { catalogueEntries } from './music.js';
import { BoardIdSchema, ContentSchema, MAX_BODY_BYTES, RevisionSchema, demoContent, type Board, type BoardId, type Content, type Revision } from './schema.js';
import { createChatAccess } from './chat-server.js';
import type { ChatAdapter } from './chat-schema.js';
import { HttpError, json, readBody } from './http.js';

export async function startServer(options: { dataDir: string; port?: number; publicDir?: string; seedDemo?: boolean; chat?: ChatAdapter }) {
  const store = openStore(options.dataDir);
  const chat = options.chat ? createChatAccess(options.chat) : undefined;
  const subscribers = new Map<string, Set<ServerResponse>>();
  const publicDir = options.publicDir ?? defaultPublicDir;
  let port = options.port ?? 4317;
  let stopped = false;
  const send = (peer: ServerResponse, board: Board) => {
    if (peer.writableLength > MAX_BODY_BYTES * 4) { peer.destroy(); return; }
    peer.write(`id: ${board.revision}\nevent: snapshot\ndata: ${JSON.stringify(board)}\n\n`);
  };
  const putBoard = (id: BoardId, expected: Revision, content: Content) => {
    if (stopped) throw new HttpError(503, 'Server is stopping');
    const board = store.put(id, expected, content);
    for (const peer of subscribers.get(id) ?? []) send(peer, board);
    return board;
  };
  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      if (error instanceof StoreError) {
        json(response, error.status, { error: error.message, currentRevision: error.currentRevision });
      } else if (error instanceof HttpError) {
        json(response, error.status, { error: error.message });
      } else if (error instanceof ZodError) {
        json(response, 400, { error: 'Validation failed', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) });
      } else {
        process.stderr.write(`${JSON.stringify({ event: 'request-error', message: error instanceof Error ? error.message : 'Unknown failure' })}\n`);
        json(response, 500, { error: 'Internal error. No update was published.' });
      }
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (stopped) throw new HttpError(503, 'Server is stopping');
    const host = request.headers.host;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!host || !allowedHosts.includes(host)) throw new HttpError(403, 'Host must be the local service address');
    if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new HttpError(403, 'Foreign Origin rejected');
    const url = new URL(request.url ?? '/', `http://${host}`);
    const method = request.method;
    const boardPage = /^\/b\/[a-z0-9][a-z0-9-]{0,47}$/.test(url.pathname);
    const documentNavigation = method === 'GET'
      && request.headers['sec-fetch-mode'] === 'navigate'
      && request.headers['sec-fetch-dest'] === 'document'
      && (url.pathname === '/' || boardPage);
    if (request.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation) throw new HttpError(403, 'Cross-site request rejected');
    if (method === 'GET' && url.pathname === '/api/capabilities') { json(response, 200, { chat: Boolean(chat) }); return; }
    if (await chat?.handle(request, response, url)) return;
    if (method === 'GET' && url.pathname === '/') {
      response.writeHead(302, { Location: `/b/${demoId}`, 'Cache-Control': 'no-store' }); response.end(); return;
    }
    if (method === 'GET' && url.pathname === '/api/catalogue') { json(response, 200, { tuning: 'standard', stringOrder: 'lowE-to-highE', chords: catalogueEntries() }); return; }
    const match = /^\/api\/boards\/([^/]+)(\/events)?$/.exec(url.pathname);
    if (match) {
      const id = BoardIdSchema.parse(match[1]);
      if (method === 'PUT' && !match[2]) {
        const supplied = Buffer.from(request.headers.authorization ?? '', 'utf8');
        const expectedToken = Buffer.from(`Bearer ${store.token}`, 'utf8');
        if (supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken)) {
          throw new HttpError(401, 'Local write capability required');
        }
        const precondition = request.headers['if-match'];
        if (precondition === undefined) throw new HttpError(428, 'If-Match is required, use "0" to create');
        if (typeof precondition !== 'string' || !/^"(0|[1-9][0-9]*)"$/.test(precondition)) throw new HttpError(400, 'If-Match must be one quoted nonnegative integer');
        const expected = RevisionSchema.parse(Number(precondition.slice(1, -1)));
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'Use Content-Type application/json');
        if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) { request.resume(); throw new HttpError(413, `Body exceeds ${MAX_BODY_BYTES} bytes`); }
        const content = ContentSchema.parse(await readBody(request));
        if (stopped) throw new HttpError(503, 'Server is stopping');
        const board = putBoard(id, expected, content);
        response.setHeader('ETag', `"${board.revision}"`);
        json(response, expected === 0 ? 201 : 200, { ...board, url: `http://127.0.0.1:${port}/b/${id}` });
        return;
      }
      const board = store.get(id);
      if (!board) throw new HttpError(404, 'Board not found');
      if (method === 'GET' && match[2]) {
        const peers = subscribers.get(id) ?? new Set<ServerResponse>();
        if (peers.size >= 16) throw new HttpError(429, 'Too many board connections');
        subscribers.set(id, peers);
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        peers.add(response);
        send(response, board);
        const heartbeat = setInterval(() => { if (!response.write(': heartbeat\n\n')) response.destroy(); }, 15_000);
        heartbeat.unref();
        response.on('close', () => { clearInterval(heartbeat); peers.delete(response); if (!peers.size) subscribers.delete(id); });
        return;
      }
      if (method === 'GET') { response.setHeader('ETag', `"${board.revision}"`); json(response, 200, board); return; }
      throw new HttpError(405, 'Method not allowed');
    }
    if (method === 'GET') {
      const assets: Record<string, { file: string; mime: string }> = {
        '/favicon.svg': { file: 'favicon.svg', mime: 'image/svg+xml' },
        '/assets/web.js': { file: 'assets/web.js', mime: 'text/javascript' },
        '/assets/audio.js': { file: 'assets/audio.js', mime: 'text/javascript' },
        '/assets/style.css': { file: 'assets/style.css', mime: 'text/css' },
      };
      const asset = assets[url.pathname];
      if (asset) {
        response.writeHead(200, { 'Content-Type': `${asset.mime}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        response.end(readFileSync(join(publicDir, asset.file))); return;
      }
      if (boardPage) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(readFileSync(join(publicDir, 'index.html'))); return;
      }
    }
    throw new HttpError(404, 'Not found');
  }

  try {
    if ((options.seedDemo ?? true) && !store.get(demoId)) store.put(demoId, RevisionSchema.parse(0), demoContent);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    port = address.port;
  } catch (error) { server.close(); store.close(); throw error; }

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    token: store.token,
    getBoard: store.get,
    putBoard,
    inviteChat: () => chat?.invite(`http://127.0.0.1:${port}`),
    async stop() {
      if (stopped) return;
      stopped = true;
      chat?.close();
      for (const peers of subscribers.values()) for (const peer of peers) peer.end();
      try {
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => server.closeAllConnections(), 1000);
          deadline.unref();
          server.close(error => { clearTimeout(deadline); error ? reject(error) : resolve(); });
          server.closeIdleConnections();
        });
      } finally { store.close(); }
    },
  };
}
