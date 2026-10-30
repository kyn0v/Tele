import { configuration } from './config.js';
import { startServer } from './server.js';

try {
  const server = await startServer(configuration());
  process.stdout.write(`${JSON.stringify({ event: 'listening', url: server.url })}\n`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.stop().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Shutdown failed'}\n`);
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Startup failed'}\n`);
  process.exitCode = 1;
}
