import crypto from 'node:crypto';
import type { Response } from 'express';
import express from 'express';
import { checkAndUnlockAchievements } from '../achievements';
import { db } from '../db';
import {
  calculateCoinUnlockSplit,
  CHAT_AUTO_MUTE_REPORT_THRESHOLD,
  CHAT_MAX_IMAGE_BYTES,
  moderateChatMessage,
  parsePositiveIntCoins,
  validateCoinTransferEligibility,
} from '../domain';
import { createRateLimiter } from '../security';
import { broadcastToRoom, broadcastToUser, getOnlineUserIds } from '../ws';
import { type AuthedRequest, requireGoogleAuth } from './auth';

function buildDmId(u1: string, u2: string): [string, string, string] {
  const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
  return [`dm_${a}_${b}`, a, b];
}

function isBlockedBetween(u1: string, u2: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
      .get(u1, u2, u2, u1),
  );
}

function hydrateMessage(row: {
  id: string;
  room_id: string;
  sender_id: string;
  message_type: string;
  body: string;
  image_data: string;
  payload_json: string;
  seen_by_json: string;
  is_deleted: number;
  created_at: string;
  sender_name: string;
  sender_avatar: string;
  sender_frame: string;
}) {
  let payload: Record<string, unknown> = {};
  let seenBy: string[] = [];
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch {
    payload = {};
  }
  try {
    seenBy = JSON.parse(row.seen_by_json || '[]');
  } catch {
    seenBy = [];
  }
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    senderName: row.sender_name, // Never expose email in chat
    senderAvatar: row.sender_avatar,
    senderFrame: row.sender_frame,
    messageType: row.message_type,
    body: row.is_deleted ? '[Message removed by moderator]' : row.body,
    imageData: row.is_deleted ? '' : row.image_data,
    payload,
    seenBy,
    isDeleted: Boolean(row.is_deleted),
    createdAt: row.created_at,
  };
}

export function createChatRouter(): express.Router {
  const router = express.Router();
  // Strict rate limit: max 20 messages per minute
  const messageLimiter = createRateLimiter('chat_msg', 20, 60 * 1000);
  const transferLimiter = createRateLimiter('chat_transfer', 15, 60 * 1000);

  // List public rooms, user's DM threads, message requests, and available study peers
  router.get('/rooms', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const rooms = db.prepare('SELECT * FROM chat_rooms ORDER BY rowid ASC').all() as Array<{
      id: string;
      slug: string;
      name: string;
      category: string;
      description: string;
    }>;

    const mutedRows = new Set(
      (
        db.prepare('SELECT room_id FROM chat_mutes WHERE user_id = ?').all(user.id) as Array<{ room_id: string }>
      ).map((r) => r.room_id),
    );

    const blockedIds = new Set(
      (
        db
          .prepare('SELECT blocked_id FROM user_blocks WHERE blocker_id = ?')
          .all(user.id) as Array<{ blocked_id: string }>
      ).map((r) => r.blocked_id),
    );

    const dmRows = db
      .prepare(
        `SELECT dt.*,
         ua.name as name_a, ua.equipped_avatar as avatar_a, ua.equipped_frame as frame_a, ua.is_minor as minor_a,
         ub.name as name_b, ub.equipped_avatar as avatar_b, ub.equipped_frame as frame_b, ub.is_minor as minor_b
         FROM dm_threads dt
         JOIN users ua ON ua.id = dt.user_a
         JOIN users ub ON ub.id = dt.user_b
         WHERE dt.user_a = ? OR dt.user_b = ?
         ORDER BY dt.created_at DESC`,
      )
      .all(user.id, user.id) as Array<{
      id: string;
      user_a: string;
      user_b: string;
      requester_id: string;
      status: string;
      created_at: string;
      name_a: string;
      avatar_a: string;
      frame_a: string;
      minor_a: number;
      name_b: string;
      avatar_b: string;
      frame_b: string;
      minor_b: number;
    }>;

    const dms = dmRows.map((d) => {
      const otherIsB = d.user_a === user.id;
      const peerId = otherIsB ? d.user_b : d.user_a;
      return {
        id: d.id,
        peerId,
        peerName: otherIsB ? d.name_b : d.name_a,
        peerAvatar: otherIsB ? d.avatar_b : d.avatar_a,
        peerFrame: otherIsB ? d.frame_b : d.frame_a,
        peerIsMinor: Boolean(otherIsB ? d.minor_b : d.minor_a),
        requesterId: d.requester_id,
        isIncomingRequest: d.status === 'pending' && d.requester_id !== user.id,
        status: d.status,
        isMuted: mutedRows.has(d.id),
        isBlocked: blockedIds.has(peerId),
      };
    });

    const peers = db
      .prepare(
        `SELECT id, name, equipped_avatar as avatar, equipped_frame as frame, is_minor as isMinor
         FROM users
         WHERE id != ? AND is_banned = 0 AND auth_provider = 'google'
         ORDER BY coins_earned_total DESC
         LIMIT 25`,
      )
      .all(user.id) as Array<{ id: string; name: string; avatar: string; frame: string; isMinor: number }>;

    res.json({
      rooms: rooms.map((r) => ({ ...r, isMuted: mutedRows.has(r.id) })),
      dms,
      peers: peers.map((p) => ({
        ...p,
        isMinor: Boolean(p.isMinor),
        isOnline: getOnlineUserIds().includes(p.id),
        isBlocked: blockedIds.has(p.id),
      })),
      onlineUserIds: getOnlineUserIds(),
    });
  });

  // Start or open a 1-to-1 DM thread (first message from stranger creates a pending message request; under-18 protected)
  router.post('/dm/start', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const peerId = String(req.body?.peerId || '');
    if (!peerId || peerId === user.id) {
      res.status(400).json({ error: 'Select another student to message' });
      return;
    }

    const peer = db
      .prepare('SELECT id, name, is_minor, is_banned, auth_provider FROM users WHERE id = ?')
      .get(peerId) as
      | { id: string; name: string; is_minor: number; is_banned: number; auth_provider: string }
      | undefined;

    if (!peer || peer.is_banned || peer.auth_provider !== 'google') {
      res.status(404).json({ error: 'User unavailable for chat' });
      return;
    }

    if (isBlockedBetween(user.id, peer.id)) {
      res.status(403).json({ error: 'Messaging is blocked between these accounts' });
      return;
    }

    const [dmId, userA, userB] = buildDmId(user.id, peer.id);
    const existing = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(dmId) as
      | { id: string; status: string; requester_id: string }
      | undefined;

    if (existing) {
      res.json({ thread: existing });
      return;
    }

    const now = new Date().toISOString();
    // All first-time stranger messages start as 'pending' request; under-18 cannot receive messages until accepted
    db.prepare(
      `INSERT INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(dmId, userA, userB, user.id, now);

    db.prepare(
      `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
       VALUES (?, ?, 'New Chat Request', ?, 0, ?)`,
    ).run(
      `ntf_${crypto.randomUUID().slice(0, 10)}`,
      peer.id,
      `${user.name} wants to start a private study chat with you.`,
      now,
    );

    broadcastToUser(peer.id, { type: 'dm:request', threadId: dmId, fromName: user.name });
    res.status(201).json({ thread: { id: dmId, status: 'pending', requester_id: user.id } });
  });

  // Accept or decline a DM chat request
  router.post('/dm/:threadId/respond', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const decision = req.body?.accept === true ? 'accepted' : 'declined';
    const thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(req.params.threadId) as
      | { id: string; user_a: string; user_b: string; requester_id: string; status: string }
      | undefined;

    if (!thread || (thread.user_a !== user.id && thread.user_b !== user.id)) {
      res.status(404).json({ error: 'Chat request not found' });
      return;
    }
    if (thread.requester_id === user.id) {
      res.status(403).json({ error: 'Wait for the recipient to accept your request' });
      return;
    }

    db.prepare('UPDATE dm_threads SET status = ? WHERE id = ?').run(decision, thread.id);
    broadcastToUser(thread.requester_id, {
      type: 'dm:responded',
      threadId: thread.id,
      status: decision,
    });
    res.json({ ok: true, status: decision });
  });

  // Load last 50 messages (or older via ?before=ISO)
  router.get('/rooms/:roomId/messages', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const roomId = req.params.roomId;
    const before = String(req.query.before || '').trim();

    if (!roomId.startsWith('room_')) {
      const thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(roomId) as
        | { id: string; user_a: string; user_b: string; status: string }
        | undefined;
      if (!thread || (thread.user_a !== user.id && thread.user_b !== user.id)) {
        res.status(403).json({ error: 'Unauthorized chat room' });
        return;
      }
    }

    const blockedIds = (
      db.prepare('SELECT blocked_id FROM user_blocks WHERE blocker_id = ?').all(user.id) as Array<{ blocked_id: string }>
    ).map((r) => r.blocked_id);

    let query = `
      SELECT m.*, u.name as sender_name, u.equipped_avatar as sender_avatar, u.equipped_frame as sender_frame
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = ?
    `;
    const params: unknown[] = [roomId];
    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }
    query += ' ORDER BY m.created_at DESC LIMIT 50';

    const rows = (
      db.prepare(query).all(...params) as Array<{
        id: string;
        room_id: string;
        sender_id: string;
        message_type: string;
        body: string;
        image_data: string;
        payload_json: string;
        seen_by_json: string;
        is_deleted: number;
        created_at: string;
        sender_name: string;
        sender_avatar: string;
        sender_frame: string;
      }>
    )
      .filter((r) => !blockedIds.includes(r.sender_id))
      .reverse();

    res.json({
      messages: rows.map(hydrateMessage),
      hasMore: rows.length === 50,
    });
  });

  // Mark messages seen
  router.post('/rooms/:roomId/seen', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const roomId = req.params.roomId;
    const recent = db
      .prepare('SELECT id, seen_by_json FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(roomId) as Array<{ id: string; seen_by_json: string }>;

    const updatedIds: string[] = [];
    const updateStmt = db.prepare('UPDATE chat_messages SET seen_by_json = ? WHERE id = ?');
    for (const msg of recent) {
      try {
        const seen = JSON.parse(msg.seen_by_json || '[]') as string[];
        if (!seen.includes(user.id)) {
          seen.push(user.id);
          updateStmt.run(JSON.stringify(seen), msg.id);
          updatedIds.push(msg.id);
        }
      } catch {
        // ignore
      }
    }
    if (updatedIds.length > 0) {
      broadcastToRoom(roomId, { type: 'chat:seen', roomId, userId: user.id, messageIds: updatedIds });
    }
    res.json({ ok: true });
  });

  // Send text, emoji, or image (max 2MB)
  router.post('/rooms/:roomId/messages', requireGoogleAuth, messageLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    if (user.is_chat_muted) {
      res.status(403).json({ error: 'Your chat privileges are muted pending admin review' });
      return;
    }

    const roomId = req.params.roomId;
    const rawBody = String(req.body?.body || '');
    const imageData = String(req.body?.imageData || '');
    const optimisticId = String(req.body?.optimisticId || '');

    if (!roomId.startsWith('room_')) {
      const thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(roomId) as
        | { id: string; user_a: string; user_b: string; requester_id: string; status: string }
        | undefined;
      if (!thread || (thread.user_a !== user.id && thread.user_b !== user.id)) {
        res.status(403).json({ error: 'Unauthorized chat room' });
        return;
      }
      const peerId = thread.user_a === user.id ? thread.user_b : thread.user_a;
      if (isBlockedBetween(user.id, peerId)) {
        res.status(403).json({ error: 'Cannot message a blocked user' });
        return;
      }
      if (thread.status === 'declined') {
        res.status(403).json({ error: 'This chat request was declined' });
        return;
      }
      if (thread.status === 'pending') {
        const peerRow = db.prepare('SELECT is_minor FROM users WHERE id = ?').get(peerId) as
          | { is_minor: number }
          | undefined;
        if (peerRow?.is_minor) {
          res.status(403).json({
            error: 'Under-18 safety: you cannot message this student until they accept your chat request.',
          });
          return;
        }
        const existingMsgs = (
          db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ?').get(roomId) as { c: number }
        ).c;
        if (existingMsgs >= 1) {
          res.status(403).json({
            error: 'Message request pending. Wait for the user to accept before sending more messages.',
          });
          return;
        }
      }
    }

    let cleanedBody = '';
    if (rawBody.trim()) {
      const mod = moderateChatMessage(rawBody);
      if (!mod.ok) {
        res.status(400).json({ error: mod.reason });
        return;
      }
      cleanedBody = mod.cleanedText;
    }

    let safeImage = '';
    if (imageData) {
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) {
        res.status(400).json({ error: 'Only PNG, JPG, or WebP images are supported in chat' });
        return;
      }
      const approxBytes = Math.ceil((imageData.length * 3) / 4);
      if (approxBytes > CHAT_MAX_IMAGE_BYTES) {
        res.status(400).json({ error: 'Chat image must be 2 MB or smaller' });
        return;
      }
      safeImage = imageData;
    }

    if (!cleanedBody && !safeImage) {
      res.status(400).json({ error: 'Send a message or image' });
      return;
    }

    const msgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const messageType = safeImage ? 'image' : 'text';

    db.prepare(
      `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, image_data, payload_json, seen_by_json, is_deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, 0, ?)`,
    ).run(msgId, roomId, user.id, messageType, cleanedBody, safeImage, JSON.stringify([user.id]), now);

    const hydrated = hydrateMessage({
      id: msgId,
      room_id: roomId,
      sender_id: user.id,
      message_type: messageType,
      body: cleanedBody,
      image_data: safeImage,
      payload_json: '{}',
      seen_by_json: JSON.stringify([user.id]),
      is_deleted: 0,
      created_at: now,
      sender_name: user.name,
      sender_avatar: user.equipped_avatar,
      sender_frame: user.equipped_frame,
    });

    broadcastToRoom(roomId, { type: 'chat:message', roomId, message: hydrated, optimisticId });

    // Notify DM peer if not muted
    if (!roomId.startsWith('room_')) {
      const thread = db.prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?').get(roomId) as {
        user_a: string;
        user_b: string;
      };
      const peerId = thread.user_a === user.id ? thread.user_b : thread.user_a;
      const muted = db.prepare('SELECT 1 FROM chat_mutes WHERE user_id = ? AND room_id = ?').get(peerId, roomId);
      if (!muted) {
        broadcastToUser(peerId, { type: 'chat:unread', roomId, fromName: user.name });
      }
    }

    res.status(201).json({ message: hydrated, optimisticId });
  });

  // Share a Note card in chat (only public preview card; never leaks file or signed URL)
  router.post('/share-note', requireGoogleAuth, messageLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    if (user.is_chat_muted) {
      res.status(403).json({ error: 'Your chat is muted' });
      return;
    }
    const roomId = String(req.body?.roomId || '');
    const noteId = String(req.body?.noteId || '');
    const note = db
      .prepare("SELECT id, title, subject, price_coins, cover_image FROM notes WHERE id = ? AND status = 'approved'")
      .get(noteId) as
      | { id: string; title: string; subject: string; price_coins: number; cover_image: string }
      | undefined;

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    const payload = {
      noteId: note.id,
      title: note.title,
      subject: note.subject,
      priceCoins: note.price_coins,
      coverImage: note.cover_image || `/api/notes/${note.id}/preview`,
    };

    const msgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
       VALUES (?, ?, ?, 'note_card', ?, ?, ?, ?)`,
    ).run(msgId, roomId, user.id, `Shared a study note: ${note.title}`, JSON.stringify(payload), JSON.stringify([user.id]), now);

    const hydrated = hydrateMessage({
      id: msgId,
      room_id: roomId,
      sender_id: user.id,
      message_type: 'note_card',
      body: `Shared a study note: ${note.title}`,
      image_data: '',
      payload_json: JSON.stringify(payload),
      seen_by_json: JSON.stringify([user.id]),
      is_deleted: 0,
      created_at: now,
      sender_name: user.name,
      sender_avatar: user.equipped_avatar,
      sender_frame: user.equipped_frame,
    });

    broadcastToRoom(roomId, { type: 'chat:message', roomId, message: hydrated });
    res.status(201).json({ message: hydrated });
  });

  // Gift a Note: sender pays Coins, receiver gets note unlocked in their library
  router.post('/gift-note', requireGoogleAuth, transferLimiter, (req: AuthedRequest, res: Response) => {
    const sender = req.user!;
    const receiverId = String(req.body?.receiverId || '');
    const noteId = String(req.body?.noteId || '');
    const roomId = String(req.body?.roomId || '');

    if (!receiverId || receiverId === sender.id) {
      res.status(400).json({ error: 'Choose another student to gift this note to' });
      return;
    }
    const receiver = db.prepare('SELECT id, name, is_banned FROM users WHERE id = ?').get(receiverId) as
      | { id: string; name: string; is_banned: number }
      | undefined;
    if (!receiver || receiver.is_banned) {
      res.status(404).json({ error: 'Recipient not found' });
      return;
    }

    const note = db.prepare("SELECT * FROM notes WHERE id = ? AND status = 'approved'").get(noteId) as
      | {
          id: string;
          uploader_id: string;
          title: string;
          subject: string;
          price_coins: number;
          is_free_sample: number;
          is_gemini_note: number;
          is_pyq: number;
          cover_image: string;
        }
      | undefined;
    if (!note) {
      res.status(404).json({ error: 'Note not available' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const alreadyOwned = db
          .prepare('SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
          .get(receiver.id, note.id);
        if (alreadyOwned || note.uploader_id === receiver.id) {
          throw new Error('RECEIVER_ALREADY_OWNS');
        }

        const price = note.is_free_sample ? 0 : note.price_coins;
        const freshSender = db
          .prepare('SELECT coins_balance FROM users WHERE id = ?')
          .get(sender.id) as { coins_balance: number };
        if (freshSender.coins_balance < price) {
          throw new Error('INSUFFICIENT_COINS');
        }

        const now = new Date().toISOString();
        const isOfficial = note.is_gemini_note === 1 || note.is_pyq === 1;
        const split = calculateCoinUnlockSplit(price);
        const uploaderCoins = isOfficial ? 0 : split.uploaderCoins;
        const burnedCoins = price - uploaderCoins;

        if (price > 0) {
          db.prepare('UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?').run(price, sender.id);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'spent', 'note_gift_sent', ?, ?, ?, ?)`,
          ).run(`tx_${crypto.randomUUID().slice(0, 10)}`, sender.id, -price, `Gifted "${note.title}" to ${receiver.name}`, note.id, now);
        }

        if (uploaderCoins > 0) {
          db.prepare(
            'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
          ).run(uploaderCoins, uploaderCoins, note.uploader_id);
          db.prepare('UPDATE notes SET total_earned_coins = total_earned_coins + ? WHERE id = ?').run(
            uploaderCoins,
            note.id,
          );
        }

        db.prepare('UPDATE notes SET sales_count = sales_count + 1 WHERE id = ?').run(note.id);
        db.prepare(
          `INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, refunded, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(buyer_id, note_id) DO UPDATE SET refunded = 0`,
        ).run(`pur_${crypto.randomUUID().slice(0, 10)}`, receiver.id, note.id, price, uploaderCoins, burnedCoins, now);

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'gift_note', 'note', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          sender.id,
          note.id,
          price,
          JSON.stringify({ receiverId: receiver.id }),
          now,
        );

        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Note Gift Received!', ?, 0, ?)`,
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          receiver.id,
          `${sender.name} gifted you "${note.title}"! It is now unlocked in My Library.`,
          now,
        );

        const targetRoomId = roomId || buildDmId(sender.id, receiver.id)[0];
        if (targetRoomId.startsWith('dm_')) {
          const [dmId, ua, ub] = buildDmId(sender.id, receiver.id);
          db.prepare(
            `INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
             VALUES (?, ?, ?, ?, 'accepted', ?)`,
          ).run(dmId, ua, ub, sender.id, now);
        }

        const payload = {
          noteId: note.id,
          title: note.title,
          subject: note.subject,
          priceCoins: price,
          receiverName: receiver.name,
        };
        const msgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
        db.prepare(
          `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
           VALUES (?, ?, ?, 'note_gift', ?, ?, ?, ?)`,
        ).run(
          msgId,
          targetRoomId,
          sender.id,
          `Gifted "${note.title}" to ${receiver.name}!`,
          JSON.stringify(payload),
          JSON.stringify([sender.id]),
          now,
        );

        const hydrated = hydrateMessage({
          id: msgId,
          room_id: targetRoomId,
          sender_id: sender.id,
          message_type: 'note_gift',
          body: `Gifted "${note.title}" to ${receiver.name}!`,
          image_data: '',
          payload_json: JSON.stringify(payload),
          seen_by_json: JSON.stringify([sender.id]),
          is_deleted: 0,
          created_at: now,
          sender_name: sender.name,
          sender_avatar: sender.equipped_avatar,
          sender_frame: sender.equipped_frame,
        });

        return {
          coinsBalance: freshSender.coins_balance - price,
          targetRoomId,
          hydrated,
        };
      })();

      broadcastToRoom(result.targetRoomId, { type: 'chat:message', roomId: result.targetRoomId, message: result.hydrated });
      broadcastToUser(receiver.id, { type: 'note:gifted', noteTitle: note.title, fromName: sender.name });
      checkAndUnlockAchievements(receiver.id);

      res.json({ ok: true, coinsBalance: result.coinsBalance, message: result.hydrated });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'RECEIVER_ALREADY_OWNS') {
        res.status(400).json({ error: `${receiver.name} already owns this note` });
        return;
      }
      if (msg === 'INSUFFICIENT_COINS') {
        res.status(400).json({ error: 'Not enough Coins to gift this note' });
        return;
      }
      res.status(500).json({ error: 'Could not complete note gift' });
    }
  });

  // Send Coins (1 to 50 Coins, max 100/day, 24h+1 unlock, same-device block, suspicious flag)
  router.post('/send-coins', requireGoogleAuth, transferLimiter, (req: AuthedRequest, res: Response) => {
    const sender = req.user!;
    const receiverId = String(req.body?.receiverId || '');
    const roomId = String(req.body?.roomId || '');
    const amountCoins = parsePositiveIntCoins(req.body?.amountCoins);
    const senderDeviceId = String(req.headers['x-device-id'] || sender.device_id || '').slice(0, 64);

    if (amountCoins === null) {
      res.status(400).json({ error: 'Enter a valid whole number of Coins' });
      return;
    }
    if (!receiverId || receiverId === sender.id) {
      res.status(400).json({ error: 'Select another student to send Coins to' });
      return;
    }

    const receiver = db
      .prepare('SELECT id, name, is_banned, device_id FROM users WHERE id = ?')
      .get(receiverId) as { id: string; name: string; is_banned: number; device_id: string } | undefined;

    if (!receiver || receiver.is_banned) {
      res.status(404).json({ error: 'Recipient not found' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const freshSender = db
          .prepare('SELECT coins_balance, created_at, device_id FROM users WHERE id = ?')
          .get(sender.id) as { coins_balance: number; created_at: string; device_id: string };

        const completedUnlocks = (
          db
            .prepare('SELECT COUNT(*) as c FROM purchases WHERE buyer_id = ? AND refunded = 0')
            .get(sender.id) as { c: number }
        ).c;

        const todayPrefix = new Date().toISOString().slice(0, 10);
        const sentToday = (
          db
            .prepare(
              'SELECT COALESCE(SUM(amount_coins), 0) as total FROM coin_transfers WHERE sender_id = ? AND substr(created_at, 1, 10) = ?',
            )
            .get(sender.id, todayPrefix) as { total: number }
        ).total;

        const errMsg = validateCoinTransferEligibility({
          amountCoins,
          senderBalance: freshSender.coins_balance,
          senderCreatedAtIso: freshSender.created_at,
          senderCompletedUnlocks: completedUnlocks,
          senderSentTodayCoins: sentToday,
          senderDeviceId: senderDeviceId || freshSender.device_id,
          receiverDeviceId: receiver.device_id,
        });

        if (errMsg) {
          throw new Error(`VALIDATION:${errMsg}`);
        }

        // Detect suspicious repetitive small transfers (>= 3 transfers to same user in 24h)
        const recentSamePair = (
          db
            .prepare(
              "SELECT COUNT(*) as c FROM coin_transfers WHERE sender_id = ? AND receiver_id = ? AND datetime(created_at) >= datetime('now', '-24 hours')",
            )
            .get(sender.id, receiver.id) as { c: number }
        ).c;
        const flaggedSuspicious = recentSamePair >= 2 ? 1 : 0;
        const flagReason = flaggedSuspicious
          ? `${recentSamePair + 1} transfers from ${sender.name} to ${receiver.name} within 24h`
          : '';

        const now = new Date().toISOString();
        db.prepare('UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?').run(amountCoins, sender.id);
        db.prepare('UPDATE users SET coins_balance = coins_balance + ? WHERE id = ?').run(amountCoins, receiver.id);

        db.prepare(
          `INSERT INTO coin_transfers (id, sender_id, receiver_id, amount_coins, flagged_suspicious, flag_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `ctr_${crypto.randomUUID().slice(0, 10)}`,
          sender.id,
          receiver.id,
          amountCoins,
          flaggedSuspicious,
          flagReason,
          now,
        );

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'coin_transfer_sent', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          sender.id,
          -amountCoins,
          `Sent 🪙${amountCoins} to ${receiver.name}`,
          receiver.id,
          now,
        );

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'coin_transfer_received', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          receiver.id,
          amountCoins,
          `Received 🪙${amountCoins} from ${sender.name}`,
          sender.id,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'coin_transfer', 'user', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          sender.id,
          receiver.id,
          amountCoins,
          JSON.stringify({ flaggedSuspicious, flagReason }),
          now,
        );

        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Coins Received!', ?, 0, ?)`,
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          receiver.id,
          `${sender.name} sent you 🪙${amountCoins}!`,
          now,
        );

        const targetRoomId = roomId || buildDmId(sender.id, receiver.id)[0];
        if (targetRoomId.startsWith('dm_')) {
          const [dmId, ua, ub] = buildDmId(sender.id, receiver.id);
          db.prepare(
            `INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
             VALUES (?, ?, ?, ?, 'accepted', ?)`,
          ).run(dmId, ua, ub, sender.id, now);
        }

        const payload = {
          amountCoins,
          senderName: sender.name,
          receiverName: receiver.name,
          receiverId: receiver.id,
        };
        const msgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
        db.prepare(
          `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
           VALUES (?, ?, ?, 'coin_receipt', ?, ?, ?, ?)`,
        ).run(
          msgId,
          targetRoomId,
          sender.id,
          `Sent 🪙${amountCoins} to ${receiver.name}`,
          JSON.stringify(payload),
          JSON.stringify([sender.id]),
          now,
        );

        const hydrated = hydrateMessage({
          id: msgId,
          room_id: targetRoomId,
          sender_id: sender.id,
          message_type: 'coin_receipt',
          body: `Sent 🪙${amountCoins} to ${receiver.name}`,
          image_data: '',
          payload_json: JSON.stringify(payload),
          seen_by_json: JSON.stringify([sender.id]),
          is_deleted: 0,
          created_at: now,
          sender_name: sender.name,
          sender_avatar: sender.equipped_avatar,
          sender_frame: sender.equipped_frame,
        });

        return {
          coinsBalance: freshSender.coins_balance - amountCoins,
          targetRoomId,
          hydrated,
        };
      })();

      broadcastToRoom(result.targetRoomId, { type: 'chat:message', roomId: result.targetRoomId, message: result.hydrated });
      broadcastToUser(receiver.id, { type: 'coin:received', amountCoins, fromName: sender.name });

      res.json({ ok: true, coinsBalance: result.coinsBalance, message: result.hydrated });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('VALIDATION:')) {
        res.status(400).json({ error: msg.replace('VALIDATION:', '') });
        return;
      }
      res.status(500).json({ error: 'Coin transfer failed' });
    }
  });

  // Mute / Unmute notifications per chat
  router.post('/rooms/:roomId/mute', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const roomId = req.params.roomId;
    const existing = db.prepare('SELECT 1 FROM chat_mutes WHERE user_id = ? AND room_id = ?').get(userId, roomId);
    if (existing) {
      db.prepare('DELETE FROM chat_mutes WHERE user_id = ? AND room_id = ?').run(userId, roomId);
      res.json({ muted: false });
    } else {
      db.prepare('INSERT INTO chat_mutes (user_id, room_id, created_at) VALUES (?, ?, ?)').run(
        userId,
        roomId,
        new Date().toISOString(),
      );
      res.json({ muted: true });
    }
  });

  // Block / Unblock user
  router.post('/users/:userId/block', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const blockerId = req.user!.id;
    const blockedId = req.params.userId;
    if (blockerId === blockedId) {
      res.status(400).json({ error: 'You cannot block yourself' });
      return;
    }
    const existing = db
      .prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?')
      .get(blockerId, blockedId);
    if (existing) {
      db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
      res.json({ blocked: false });
    } else {
      db.prepare('INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
        blockerId,
        blockedId,
        new Date().toISOString(),
      );
      res.json({ blocked: true });
    }
  });

  // Report chat message (auto-mutes user after 3 unique reports pending admin review)
  router.post('/messages/:messageId/report', requireGoogleAuth, (req: AuthedRequest, res: Response) => {
    const reporter = req.user!;
    const reason = String(req.body?.reason || 'spam').trim().slice(0, 200);
    const msg = db
      .prepare('SELECT id, room_id, sender_id FROM chat_messages WHERE id = ?')
      .get(req.params.messageId) as { id: string; room_id: string; sender_id: string } | undefined;

    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (msg.sender_id === reporter.id) {
      res.status(400).json({ error: 'You cannot report your own message' });
      return;
    }

    try {
      let autoMuted = false;
      db.transaction(() => {
        db.prepare(
          `INSERT INTO chat_reports (id, message_id, room_id, reported_user_id, reporter_id, reason, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
        ).run(`crep_${crypto.randomUUID().slice(0, 10)}`, msg.id, msg.room_id, msg.sender_id, reporter.id, reason, new Date().toISOString());

        db.prepare('UPDATE users SET chat_report_count = chat_report_count + 1 WHERE id = ?').run(msg.sender_id);
        const u = db.prepare('SELECT chat_report_count FROM users WHERE id = ?').get(msg.sender_id) as {
          chat_report_count: number;
        };
        if (u.chat_report_count >= CHAT_AUTO_MUTE_REPORT_THRESHOLD) {
          db.prepare('UPDATE users SET is_chat_muted = 1 WHERE id = ?').run(msg.sender_id);
          autoMuted = true;
        }
      })();
      res.json({ ok: true, autoMuted });
    } catch {
      res.status(409).json({ error: 'You already reported this message' });
    }
  });

  return router;
}
