import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { parseClientMessage } from './protocol.js';
import type { ServerMessage } from './protocol.js';
import { Room } from './room.js';
import type { RoomOptions } from './room.js';

export interface GameServer {
  readonly port: number;
  readonly room: Room;
  close(): Promise<void>;
}

/** Hosts one Room over WebSocket and drives its tick loop from wall-clock time. */
export function startServer(port: number, opts: RoomOptions = {}): Promise<GameServer> {
  const sockets = new Map<string, WebSocket>();
  const send = (playerId: string, message: ServerMessage): void => {
    const ws = sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const room = new Room(send, opts);
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    const playerId = room.connect();
    if (!playerId) {
      ws.send(JSON.stringify({ t: 'reject', reason: 'room full or match in progress' } satisfies ServerMessage));
      ws.close();
      return;
    }
    sockets.set(playerId, ws);
    ws.on('message', (data) => {
      const msg = parseClientMessage(data.toString());
      if (msg) room.handle(playerId, msg);
    });
    ws.on('close', () => {
      sockets.delete(playerId);
      room.disconnect(playerId);
    });
    ws.on('error', () => ws.close());
  });

  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    room.advance(now - last);
    last = now;
  }, 1000 / 120);

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const address = wss.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: bound,
        room,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}
