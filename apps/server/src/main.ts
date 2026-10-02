import { startServer } from './server.js';

const port = Number(process.env['PORT'] ?? 8787);
const server = await startServer(port);
console.log(`boulder-maze server listening on ws://0.0.0.0:${server.port} (room ${server.room.roomId})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
