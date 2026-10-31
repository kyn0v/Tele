import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CHAT_BYTES, ChatCommandSchema, PairSchema, type ChatAdapter, type ChatView } from './chat-schema.js';
import { HttpError, json, readBody } from './http.js';

const INVITATION_MS = 2 * 60_000;
const GRANT_MS = 8 * 60 * 60_000;
function equal(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createChatAccess(adapter: ChatAdapter, now = Date.now) {
  const { binding, epoch, boardId } = adapter.snapshot();
  const path = `/api/chat/${binding}`;
  const cookieName = `ah_${binding.replaceAll('-', '')}`;
  let invitation: { secret: string; expires: number } | undefined;
  let grant: { secret: string; expires: number } | undefined;
  let closed = false;
  const peers = new Set<ServerResponse>();
  const valid = () => !closed && adapter.snapshot().epoch === epoch && adapter.snapshot().phase !== 'disconnected';
  function authenticate(request: IncomingMessage) {
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!valid() || !grant || grant.expires <= now() || !cookie || !equal(cookie, grant.secret)) throw new HttpError(401, 'Chat connection expired. Pair again in Pi.');
  }
  function stopPeers() { for (const peer of peers) peer.end(); }
  return {
    invite(origin: string) {
      if (!valid()) throw new Error('Chat is detached');
      invitation = { secret: randomBytes(32).toString('hex'), expires: now() + INVITATION_MS };
      return `${origin}/b/${boardId}#chat=${binding}.${invitation.secret}`;
    },
    close() { closed = true; invitation = undefined; grant = undefined; stopPeers(); },
    async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
      if (!url.pathname.startsWith('/api/chat/')) return false;
      if (request.method === 'POST') {
        if (request.headers.origin !== url.origin) throw new HttpError(403, 'Exact Origin required');
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'Use Content-Type application/json');
      }
      if (url.pathname === '/api/chat/pair' && request.method === 'POST') {
        const input = PairSchema.parse(await readBody(request));
        if (!valid() || input.binding !== binding || !invitation || invitation.expires <= now() || !equal(input.invitation, invitation.secret)) throw new HttpError(401, 'Invitation invalid or expired');
        invitation = undefined;
        stopPeers();
        grant = { secret: randomBytes(32).toString('hex'), expires: now() + GRANT_MS };
        response.setHeader('Set-Cookie', `${cookieName}=${grant.secret}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${GRANT_MS / 1000}`);
        json(response, 200, { binding, boardId });
        return true;
      }
      if (url.pathname !== path && !url.pathname.startsWith(`${path}/`)) throw new HttpError(401, 'Chat connection required');
      authenticate(request);
      const route = url.pathname.slice(path.length);
      if (request.method === 'GET' && (route === '' || route === '/status')) {
        json(response, 200, adapter.snapshot()); return true;
      }
      if (request.method === 'POST' && route === '/command') {
        const command = ChatCommandSchema.parse(await readBody(request));
        authenticate(request);
        json(response, 202, adapter.submit(command)); return true;
      }
      if (request.method === 'GET' && route === '/events') {
        if (peers.size >= 4) throw new HttpError(429, 'Too many chat connections');
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        peers.add(response);
        const send = (view: ChatView) => {
          if (!valid() || !grant || grant.expires <= now()) { response.end(); return; }
          if (response.writableLength > CHAT_BYTES * 2) { response.destroy(); return; }
          response.write(`event: snapshot\ndata: ${JSON.stringify(view)}\n\n`);
        };
        const unsubscribe = adapter.subscribe(send);
        send(adapter.snapshot());
        const heartbeat = setInterval(() => {
          if (!valid() || !grant || grant.expires <= now()) response.end();
          else if (!response.write(': heartbeat\n\n')) response.destroy();
        }, 15_000);
        heartbeat.unref();
        response.on('close', () => { clearInterval(heartbeat); unsubscribe(); peers.delete(response); });
        return true;
      }
      throw new HttpError(404, 'Chat route not found');
    },
  };
}
