import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY_BYTES } from './schema.js';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
export function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let failed = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        if (!failed) reject(new HttpError(413, `Body exceeds ${MAX_BODY_BYTES} bytes`));
        failed = true;
        chunks.length = 0;
      } else if (!failed) chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Body must be valid JSON')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'Request aborted')));
  });
}
