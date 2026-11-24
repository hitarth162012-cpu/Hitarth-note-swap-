import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { db } from './db';
import { parseCookieToken, verifySessionToken } from './security';

interface AuthedSocket extends WebSocket {
  userId?: string;
  rooms?: Set<string>;
}

const userSockets = new Map<string, Set<AuthedSocket>>();
const roomSubscriptions = new Map<string, Set<AuthedSocket>>();

export function getOnlineUserIds(): string[] {
  return Array.from(userSockets.keys());
}

export function broadcastToRoom(roomId: string, event: unknown): void {
  const subs = roomSubscriptions.get(roomId);
  if (!subs) return;
  const payload = JSON.stringify(event);
  for (const sock of subs) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(payload);
    }
  }
}

export function broadcastToUser(userId: string, event: unknown): void {
  const socks = userSockets.get(userId);
  if (!socks) return;
  const payload = JSON.stringify(event);
  for (const sock of socks) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(payload);
    }
  }
}

function broadcastPresence(): void {
  const payload = JSON.stringify({
    type: 'presence:update',
    onlineUserIds: getOnlineUserIds(),
  });
  for (const socks of userSockets.values()) {
    for (const sock of socks) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(payload);
      }
    }
  }
}

function subscribeRoom(sock: AuthedSocket, roomId: string): void {
  if (!sock.rooms) sock.rooms = new Set();
  sock.rooms.add(roomId);
  let set = roomSubscriptions.get(roomId);
  if (!set) {
    set = new Set();
    roomSubscriptions.set(roomId, set);
  }
  set.add(sock);
}

function unsubscribeAll(sock: AuthedSocket): void {
  if (sock.rooms) {
    for (const roomId of sock.rooms) {
      const set = roomSubscriptions.get(roomId);
      if (set) {
        set.delete(sock);
        if (set.size === 0) roomSubscriptions.delete(roomId);
      }
    }
    sock.rooms.clear();
  }
  if (sock.userId) {
    const set = userSockets.get(sock.userId);
    if (set) {
      set.delete(sock);
      if (set.size === 0) userSockets.delete(sock.userId);
    }
  }
}

function canJoinRoom(userId: string, roomId: string): boolean {
  if (roomId.startsWith('room_')) return true;
  const thread = db
    .prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?')
    .get(roomId) as { user_a: string; user_b: string } | undefined;
  return Boolean(thread && (thread.user_a === userId || thread.user_b === userId));
}

export function setupWebSocketHub(wss: WebSocketServer): void {
  wss.on('connection', (ws: AuthedSocket, req: IncomingMessage) => {
    const cookieToken = parseCookieToken(req as unknown as import('express').Request);
    const session = cookieToken ? verifySessionToken(cookieToken) : null;
    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const user = db
      .prepare('SELECT id, name, auth_provider, is_banned FROM users WHERE id = ?')
      .get(session.uid) as { id: string; name: string; auth_provider: string; is_banned: number } | undefined;

    if (!user || user.is_banned || user.auth_provider !== 'google') {
      ws.close(4003, 'Google sign-in required for chat');
      return;
    }

    ws.userId = user.id;
    let set = userSockets.get(user.id);
    if (!set) {
      set = new Set();
      userSockets.set(user.id, set);
    }
    set.add(ws);

    ws.send(JSON.stringify({ type: 'presence:update', onlineUserIds: getOnlineUserIds() }));
    broadcastPresence();

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data?.type === 'room:join' && typeof data.roomId === 'string') {
          if (canJoinRoom(user.id, data.roomId)) {
            subscribeRoom(ws, data.roomId);
          }
        } else if (data?.type === 'typing:start' && typeof data.roomId === 'string') {
          if (canJoinRoom(user.id, data.roomId)) {
            broadcastToRoom(data.roomId, {
              type: 'typing:update',
              roomId: data.roomId,
              userId: user.id,
              userName: user.name,
              isTyping: true,
            });
          }
        } else if (data?.type === 'typing:stop' && typeof data.roomId === 'string') {
          if (canJoinRoom(user.id, data.roomId)) {
            broadcastToRoom(data.roomId, {
              type: 'typing:update',
              roomId: data.roomId,
              userId: user.id,
              userName: user.name,
              isTyping: false,
            });
          }
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      unsubscribeAll(ws);
      broadcastPresence();
    });
  });
}
