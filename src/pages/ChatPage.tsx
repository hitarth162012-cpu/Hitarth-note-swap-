import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Image as ImageIcon,
  Smile,
  Coins,
  Gift,
  Share2,
  BellOff,
  Bell,
  Ban,
  Flag,
  Check,
  CheckCheck,
  ShieldAlert,
  MessageSquarePlus,
  ChevronLeft,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  ChatMessage,
  ChatRoom,
  DmThread,
  NoteSummary,
  UserProfile,
} from '../types';
import { AVATAR_MAP, FRAME_CLASS_MAP, getAccentClasses } from '../i18n';

interface ChatPageProps {
  user: UserProfile | null;
  pendingShareNote: NoteSummary | null;
  onClearPendingShare: () => void;
  onOpenAuth: () => void;
  onOpenNote: (noteId: string) => void;
  onCoinsChange: (newBalance: number, delta: number, label: string) => void;
  onUnreadReset: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

interface PeerItem {
  id: string;
  name: string;
  avatar: string;
  frame: string;
  isMinor: boolean;
  isOnline: boolean;
  isBlocked: boolean;
}

const QUICK_EMOJIS = ['👍', '🔥', '📚', '🧠', '💡', '🎉', '🪙', '👏'];

export function ChatPage({
  user,
  pendingShareNote,
  onClearPendingShare,
  onOpenAuth,
  onOpenNote,
  onCoinsChange,
  onUnreadReset,
  onToast,
}: ChatPageProps) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [dms, setDms] = useState<DmThread[]>([]);
  const [peers, setPeers] = useState<PeerItem[]>([]);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('room_lounge');
  const [mobileShowList, setMobileShowList] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [showEmojis, setShowEmojis] = useState(false);

  // Modals: Send Coins, Gift Note, Share Note
  const [modalMode, setModalMode] = useState<'none' | 'coins' | 'gift' | 'share'>('none');
  const [coinTargetId, setCoinTargetId] = useState('');
  const [coinAmount, setCoinAmount] = useState(5);
  const [marketNotes, setMarketNotes] = useState<NoteSummary[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const activeRoomRef = useRef(activeRoomId);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const accent = getAccentClasses(user?.equippedTheme || 'indigo');
  const canUseChat = Boolean(user && (user.authProvider === 'google' || user.authProvider === 'firebase_email'));
  activeRoomRef.current = activeRoomId;

  useEffect(() => {
    onUnreadReset();
  }, []);

  async function loadSidebar() {
    if (!canUseChat) return;
    try {
      const res = await apiRequest<{
        rooms: ChatRoom[];
        dms: DmThread[];
        peers: PeerItem[];
        onlineUserIds: string[];
      }>('/api/chat/rooms');
      setRooms(res.rooms);
      setDms(res.dms);
      setPeers(res.peers);
      setOnlineIds(res.onlineUserIds);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function loadMessages(roomId: string, before?: string) {
    if (!canUseChat) return;
    setLoadingMsgs(true);
    try {
      const qs = before ? `?before=${encodeURIComponent(before)}` : '';
      const res = await apiRequest<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/api/chat/rooms/${roomId}/messages${qs}`,
      );
      if (before) {
        setMessages((prev) => [...res.messages, ...prev]);
      } else {
        setMessages(res.messages);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      }
      setHasMore(res.hasMore);
      apiRequest(`/api/chat/rooms/${roomId}/seen`, { method: 'POST' }).catch(() => {});
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoadingMsgs(false);
    }
  }

  // WebSocket setup for real-time messages, typing, presence, seen ticks
  useEffect(() => {
    if (!canUseChat || !user) return;
    loadSidebar();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'room:join', roomId: activeRoomRef.current }));
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'presence:update') {
          setOnlineIds(data.onlineUserIds || []);
        } else if (data.type === 'typing:update' && data.roomId === activeRoomRef.current) {
          if (data.userId === user.id) return;
          setTypingUsers((prev) => {
            const copy = { ...prev };
            if (data.isTyping) copy[data.userId] = data.userName;
            else delete copy[data.userId];
            return copy;
          });
        } else if (data.type === 'chat:message' && data.roomId === activeRoomRef.current) {
          const incoming = data.message as ChatMessage;
          setMessages((prev) => {
            const filtered = prev.filter(
              (m) => m.id !== incoming.id && (!data.optimisticId || m.id !== data.optimisticId),
            );
            return [...filtered, incoming];
          });
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          apiRequest(`/api/chat/rooms/${activeRoomRef.current}/seen`, { method: 'POST' }).catch(() => {});
        } else if (data.type === 'chat:seen' && data.roomId === activeRoomRef.current) {
          const ids = new Set(data.messageIds as string[]);
          setMessages((prev) =>
            prev.map((m) =>
              ids.has(m.id) && !m.seenBy.includes(data.userId)
                ? { ...m, seenBy: [...m.seenBy, data.userId] }
                : m,
            ),
          );
        } else if (data.type === 'chat:deleted') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.messageId
                ? { ...m, isDeleted: true, body: '[Message removed by moderator]', imageData: '' }
                : m,
            ),
          );
        } else if (data.type === 'dm:request' || data.type === 'dm:responded') {
          loadSidebar();
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.id, user?.authProvider]);

  useEffect(() => {
    if (!canUseChat) return;
    setTypingUsers({});
    loadMessages(activeRoomId);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'room:join', roomId: activeRoomId }));
    }
  }, [activeRoomId, user?.id, canUseChat]);

  if (!user || !canUseChat) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-3xl">💬</p>
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white">
            Sign-In Required for Live Chat
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Chat rooms and 1-to-1 DMs are reserved for Google or Email signed-in students. Your email is never shown in chat — only your username and avatar.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-5 min-h-[44px] rounded-xl bg-indigo-600 px-6 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Sign in with Google or Email
          </button>
        </div>
      </div>
    );
  }

  const activePublicRoom = rooms.find((r) => r.id === activeRoomId);
  const activeDm = dms.find((d) => d.id === activeRoomId);
  const isMuted = activePublicRoom?.isMuted || activeDm?.isMuted || false;

  function emitTyping(isTyping: boolean) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: isTyping ? 'typing:start' : 'typing:stop', roomId: activeRoomId }),
      );
    }
  }

  function handleDraftChange(val: string) {
    setDraft(val);
    emitTyping(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => emitTyping(false), 1500);
  }

  function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onToast('error', 'Chat images must be 2 MB or smaller');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() && !imagePreview) return;

    const optimisticId = `opt_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      roomId: activeRoomId,
      senderId: user!.id,
      senderName: user!.name,
      senderAvatar: user!.equippedAvatar,
      senderFrame: user!.equippedFrame,
      messageType: imagePreview ? 'image' : 'text',
      body: draft.trim(),
      imageData: imagePreview || undefined,
      payload: {},
      seenBy: [user!.id],
      isDeleted: false,
      createdAt: new Date().toISOString(),
      optimistic: true,
    };

    const bodyToSend = draft;
    const imgToSend = imagePreview;
    setDraft('');
    setImagePreview('');
    emitTyping(false);
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);

    try {
      const res = await apiRequest<{ message: ChatMessage; optimisticId?: string }>(
        `/api/chat/rooms/${activeRoomId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ body: bodyToSend, imageData: imgToSend, optimisticId }),
        },
      );
      setMessages((prev) => {
        const alreadyConfirmed = prev.some((m) => m.id === res.message.id);
        if (alreadyConfirmed) return prev.filter((m) => m.id !== optimisticId);
        return prev.map((m) => (m.id === optimisticId ? res.message : m));
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      onToast('error', (err as Error).message);
    }
  }

  async function handleStartDm(peerId: string) {
    try {
      const res = await apiRequest<{ thread: { id: string } }>('/api/chat/dm/start', {
        method: 'POST',
        body: JSON.stringify({ peerId }),
      });
      await loadSidebar();
      setActiveRoomId(res.thread.id);
      setMobileShowList(false);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleRespondDm(threadId: string, accept: boolean) {
    try {
      await apiRequest(`/api/chat/dm/${threadId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      onToast('success', accept ? 'Chat request accepted' : 'Chat request declined');
      await loadSidebar();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleToggleMute() {
    try {
      const res = await apiRequest<{ muted: boolean }>(`/api/chat/rooms/${activeRoomId}/mute`, {
        method: 'POST',
      });
      onToast('info', res.muted ? 'Notifications muted for this chat' : 'Notifications unmuted');
      await loadSidebar();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleBlockUser(targetId: string) {
    try {
      const res = await apiRequest<{ blocked: boolean }>(`/api/chat/users/${targetId}/block`, {
        method: 'POST',
      });
      onToast('info', res.blocked ? 'User blocked' : 'User unblocked');
      await loadSidebar();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleReportMessage(messageId: string) {
    try {
      const res = await apiRequest<{ autoMuted?: boolean }>(`/api/chat/messages/${messageId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Inappropriate or spam message' }),
      });
      onToast(
        'info',
        res.autoMuted
          ? 'Message reported. User auto-muted pending admin review.'
          : 'Message reported to moderators.',
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function openModal(mode: 'coins' | 'gift' | 'share') {
    setModalMode(mode);
    if (activeDm) setCoinTargetId(activeDm.peerId);
    else if (peers.length > 0 && !coinTargetId) setCoinTargetId(peers[0].id);

    if (mode === 'gift' || mode === 'share') {
      try {
        const res = await apiRequest<{ notes: NoteSummary[] }>('/api/notes?section=trending');
        setMarketNotes(res.notes);
        setSelectedNoteId(res.notes.length > 0 ? res.notes[0].id : '');
      } catch {
        // ignore
      }
    }
  }

  async function handleSendCoinsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction(true);
    try {
      const res = await apiRequest<{ coinsBalance: number }>('/api/chat/send-coins', {
        method: 'POST',
        body: JSON.stringify({
          receiverId: coinTargetId,
          roomId: activeRoomId,
          amountCoins: coinAmount,
        }),
      });
      onCoinsChange(res.coinsBalance, -coinAmount, 'Sent Coins');
      onToast('success', `Sent 🪙${coinAmount}!`);
      setModalMode('none');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleGiftNoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction(true);
    try {
      const res = await apiRequest<{ coinsBalance: number }>('/api/chat/gift-note', {
        method: 'POST',
        body: JSON.stringify({
          receiverId: coinTargetId,
          noteId: selectedNoteId,
          roomId: activeRoomId,
        }),
      });
      const note = marketNotes.find((n) => n.id === selectedNoteId);
      onCoinsChange(res.coinsBalance, -(note?.priceCoins || 0), 'Gifted Note');
      onToast('success', 'Note gifted & unlocked in their library!');
      setModalMode('none');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleShareNoteCard(noteId: string) {
    setBusyAction(true);
    try {
      await apiRequest('/api/chat/share-note', {
        method: 'POST',
        body: JSON.stringify({ roomId: activeRoomId, noteId }),
      });
      onClearPendingShare();
      setModalMode('none');
      onToast('success', 'Note preview card shared in chat!');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(false);
    }
  }

  const typingNames = Object.values(typingUsers);

  return (
    <div className="space-y-4 pb-6">
      {/* Safety & Virtual Coin Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <span>
          💬 Live Study Chat · Virtual Coins have no cash value · Chats auto-delete after 30 days
        </span>
        <span className="font-mono-num font-semibold text-emerald-600 dark:text-emerald-400">
          {onlineIds.length} online now
        </span>
      </div>

      {pendingShareNote && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/60">
          <span className="font-medium text-indigo-950 dark:text-indigo-200">
            Ready to share preview card: <strong>{pendingShareNote.title}</strong> (🪙{pendingShareNote.priceCoins})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyAction}
              onClick={() => handleShareNoteCard(pendingShareNote.id)}
              className="min-h-[36px] rounded-lg bg-indigo-600 px-3 font-semibold text-white hover:bg-indigo-700"
            >
              Send Card Here
            </button>
            <button
              type="button"
              onClick={onClearPendingShare}
              className="min-h-[36px] rounded-lg px-2.5 font-medium text-slate-600 hover:bg-white/60 dark:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main Split Container */}
      <div className="grid h-[70vh] min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[280px_1fr]">
        {/* Left Sidebar: Rooms + DMs + Peers */}
        <aside
          className={`${
            mobileShowList ? 'flex' : 'hidden md:flex'
          } flex-col border-r border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60 overflow-y-auto`}
        >
          <div className="p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Study Rooms
            </p>
            <div className="mt-2 space-y-1">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => {
                    setActiveRoomId(room.id);
                    setMobileShowList(false);
                  }}
                  className={`flex w-full min-h-[42px] items-center justify-between rounded-xl px-3 text-left text-xs font-semibold transition-colors ${
                    activeRoomId === room.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate"># {room.name}</span>
                  {room.isMuted && <BellOff className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                </button>
              ))}
            </div>
          </div>

          {/* DMs & Pending Requests */}
          <div className="border-t border-slate-200 p-3.5 dark:border-slate-800">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Direct Messages
            </p>
            <div className="mt-2 space-y-1.5">
              {dms.map((dm) => {
                const isOnline = onlineIds.includes(dm.peerId);
                return (
                  <div key={dm.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveRoomId(dm.id);
                        setMobileShowList(false);
                      }}
                      className={`flex w-full min-h-[42px] items-center justify-between rounded-xl px-3 text-left text-xs font-semibold transition-colors ${
                        activeRoomId === dm.id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isOnline ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        <span className="truncate">{dm.peerName}</span>
                      </span>
                      {dm.status === 'pending' && (
                        <span className="text-[10px] opacity-80">Pending</span>
                      )}
                    </button>
                    {dm.isIncomingRequest && (
                      <div className="flex gap-1.5 pl-3">
                        <button
                          type="button"
                          onClick={() => handleRespondDm(dm.id, true)}
                          className="min-h-[30px] rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRespondDm(dm.id, false)}
                          className="min-h-[30px] rounded-lg bg-slate-200 px-2.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Study Peers to message */}
          <div className="border-t border-slate-200 p-3.5 dark:border-slate-800">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Message a Student
            </p>
            <div className="mt-2 space-y-1">
              {peers.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleStartDm(p.id)}
                  className="flex w-full min-h-[38px] items-center justify-between rounded-lg px-2.5 text-xs text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span>{AVATAR_MAP[p.avatar] || '🎓'}</span>
                    <span className="truncate font-medium">{p.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    {p.isMinor && <span title="Under-18 Protected">U18</span>}
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Active Conversation */}
        <section className={`${mobileShowList ? 'hidden md:flex' : 'flex'} flex-col h-full overflow-hidden`}>
          {/* Room Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileShowList(true)}
                aria-label="Back to chat rooms"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h2 className="truncate font-display text-base font-bold text-slate-900 dark:text-white">
                  {activePublicRoom ? `# ${activePublicRoom.name}` : activeDm?.peerName || 'Study Chat'}
                </h2>
                <p className="truncate text-[11px] text-slate-500">
                  {activePublicRoom
                    ? activePublicRoom.description
                    : activeDm
                      ? `${onlineIds.includes(activeDm.peerId) ? 'Online' : 'Offline'} · ${
                          activeDm.status === 'pending'
                            ? activeDm.peerIsMinor
                              ? 'Under-18 protected: wait for acceptance'
                              : 'Message request pending'
                            : '1-to-1 Study DM'
                        }`
                      : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openModal('coins')}
                title="Send Coins"
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              >
                <Coins className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Send Coins</span>
              </button>
              <button
                type="button"
                onClick={() => openModal('gift')}
                title="Gift a Note"
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Gift className="h-3.5 w-3.5 text-rose-500" />
                <span className="hidden sm:inline">Gift</span>
              </button>
              <button
                type="button"
                onClick={() => openModal('share')}
                title="Share Note Card"
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Share2 className="h-3.5 w-3.5 text-indigo-500" />
                <span className="hidden sm:inline">Share Note</span>
              </button>
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={isMuted ? 'Unmute chat' : 'Mute chat'}
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
              >
                {isMuted ? <BellOff className="h-4 w-4 text-rose-500" /> : <Bell className="h-4 w-4" />}
              </button>
              {activeDm && (
                <button
                  type="button"
                  onClick={() => handleBlockUser(activeDm.peerId)}
                  aria-label="Block or unblock user"
                  title={activeDm.isBlocked ? 'Unblock user' : 'Block user'}
                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300"
                >
                  <Ban className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Message Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {hasMore && (
              <div className="text-center">
                <button
                  type="button"
                  disabled={loadingMsgs}
                  onClick={() => messages[0] && loadMessages(activeRoomId, messages[0].createdAt)}
                  className="min-h-[34px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Load older messages
                </button>
              </div>
            )}

            {messages.map((msg) => {
              const mine = msg.senderId === user.id;
              const seenByOthers = msg.seenBy.some((id) => id !== msg.senderId);
              return (
                <div key={msg.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm dark:bg-slate-800 ${
                      FRAME_CLASS_MAP[msg.senderFrame] || FRAME_CLASS_MAP.none
                    }`}
                  >
                    {AVATAR_MAP[msg.senderAvatar] || '🎓'}
                  </div>

                  <div className={`max-w-[78%] space-y-1 ${mine ? 'items-end text-right' : ''}`}>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {mine ? 'You' : msg.senderName}
                      </span>
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {msg.messageType === 'coin_receipt' ? (
                      <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-left text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                        🪙 {msg.body}
                      </div>
                    ) : msg.messageType === 'note_gift' ? (
                      <button
                        type="button"
                        onClick={() =>
                          typeof msg.payload?.noteId === 'string' && onOpenNote(msg.payload.noteId)
                        }
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-xs text-rose-950 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
                      >
                        <p className="font-bold">🎁 Note Gift Unlocked!</p>
                        <p className="mt-0.5">{msg.body}</p>
                      </button>
                    ) : msg.messageType === 'note_card' ? (
                      <button
                        type="button"
                        onClick={() =>
                          typeof msg.payload?.noteId === 'string' && onOpenNote(msg.payload.noteId)
                        }
                        className="w-64 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-800"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                          {String(msg.payload?.subject || 'Study Note')} · Locked Preview Card
                        </p>
                        <p className="mt-1 font-display text-sm font-bold text-slate-900 dark:text-white line-clamp-2">
                          {String(msg.payload?.title || msg.body)}
                        </p>
                        <p className="mt-1 font-mono-num text-xs font-bold text-amber-600 dark:text-amber-400">
                          🪙{Number(msg.payload?.priceCoins || 0)} · Tap to preview/unlock
                        </p>
                      </button>
                    ) : (
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                          mine
                            ? `${accent.btn} text-left`
                            : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-left'
                        } ${msg.optimistic ? 'opacity-70' : ''}`}
                      >
                        {msg.imageData && (
                          <img
                            src={msg.imageData}
                            alt="Shared attachment"
                            className="mb-2 max-h-56 rounded-xl object-contain"
                          />
                        )}
                        {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      {mine && (
                        <span className="inline-flex items-center gap-0.5">
                          {seenByOthers ? (
                            <CheckCheck className="h-3.5 w-3.5 text-indigo-500" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          {msg.optimistic ? 'Sending' : seenByOthers ? 'Seen' : 'Sent'}
                        </span>
                      )}
                      {!mine && !msg.isDeleted && (
                        <button
                          type="button"
                          onClick={() => handleReportMessage(msg.id)}
                          className="inline-flex items-center gap-0.5 hover:text-rose-500"
                        >
                          <Flag className="h-3 w-3" /> Report
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Typing indicator */}
          {typingNames.length > 0 && (
            <div className="px-4 py-1 text-xs italic text-slate-500">
              {typingNames.join(', ')} {typingNames.length > 1 ? 'are' : 'is'} typing...
            </div>
          )}

          {/* Muted banner */}
          {user.isChatMuted && (
            <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              Your chat is temporarily muted pending moderator review.
            </div>
          )}

          {/* Image preview before sending */}
          {imagePreview && (
            <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950">
              <img src={imagePreview} alt="Upload preview" className="h-14 w-14 rounded-lg object-cover" />
              <span className="text-xs text-slate-600 dark:text-slate-300">Image ready to send</span>
              <button
                type="button"
                onClick={() => setImagePreview('')}
                className="ml-auto text-xs font-semibold text-rose-600"
              >
                Remove
              </button>
            </div>
          )}

          {/* Emoji Picker Row */}
          {showEmojis && (
            <div className="flex gap-1.5 border-t border-slate-100 px-4 py-2 dark:border-slate-800">
              {QUICK_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setDraft((d) => `${d}${em}`)}
                  className="min-h-[34px] min-w-[34px] rounded-lg text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <form
            onSubmit={handleSendMessage}
            className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handlePickImage}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowEmojis((s) => !s)}
              aria-label="Toggle emoji picker"
              className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Smile className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach image up to 2 MB"
              className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <input
              type="text"
              disabled={user.isChatMuted}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder="Write a study message (no external links)..."
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={user.isChatMuted || (!draft.trim() && !imagePreview)}
              aria-label="Send message"
              className={`flex min-h-[42px] min-w-[44px] items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${accent.btn}`}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </section>
      </div>

      {/* Action Modal: Send Coins / Gift Note / Share Note Card */}
      {modalMode !== 'none' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {modalMode === 'coins'
                ? 'Send Virtual Coins'
                : modalMode === 'gift'
                  ? 'Gift a Note to a Friend'
                  : 'Share Note Preview Card'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {modalMode === 'coins'
                ? 'Send 🪙1–50 (max 🪙100/day). Requires account 24h+ old & 1 completed unlock. Coins have no cash value.'
                : modalMode === 'gift'
                  ? 'You pay the Coins and the recipient gets the note unlocked in their library.'
                  : 'Shares a public preview card only — private pages remain locked until unlocked.'}
            </p>

            {modalMode === 'coins' && (
              <form onSubmit={handleSendCoinsSubmit} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Recipient
                  </label>
                  <select
                    value={coinTargetId}
                    onChange={(e) => setCoinTargetId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {peers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Coins (1–50)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={coinAmount}
                    onChange={(e) => setCoinAmount(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalMode('none')}
                    className="min-h-[40px] rounded-xl px-4 text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction}
                    className={`min-h-[40px] rounded-xl px-4 text-xs font-semibold ${accent.btn}`}
                  >
                    Send 🪙{coinAmount}
                  </button>
                </div>
              </form>
            )}

            {modalMode === 'gift' && (
              <form onSubmit={handleGiftNoteSubmit} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Recipient
                  </label>
                  <select
                    value={coinTargetId}
                    onChange={(e) => setCoinTargetId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {peers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Select Note
                  </label>
                  {marketNotes.length === 0 ? (
                    <p className="mt-1 rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      No approved student notes available yet. Notes appear here once uploaded by students and approved.
                    </p>
                  ) : (
                    <select
                      value={selectedNoteId}
                      onChange={(e) => setSelectedNoteId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      {marketNotes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title} (🪙{n.priceCoins})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalMode('none')}
                    className="min-h-[40px] rounded-xl px-4 text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busyAction || marketNotes.length === 0 || !selectedNoteId}
                    className={`min-h-[40px] rounded-xl px-4 text-xs font-semibold disabled:opacity-50 ${accent.btn}`}
                  >
                    Gift Note
                  </button>
                </div>
              </form>
            )}

            {modalMode === 'share' && (
              <div className="mt-4 space-y-3">
                {marketNotes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No approved student notes available yet. Notes appear here once uploaded by students and approved.
                  </p>
                ) : (
                  <select
                    value={selectedNoteId}
                    onChange={(e) => setSelectedNoteId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {marketNotes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title} (🪙{n.priceCoins})
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalMode('none')}
                    className="min-h-[40px] rounded-xl px-4 text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busyAction || marketNotes.length === 0 || !selectedNoteId}
                    onClick={() => handleShareNoteCard(selectedNoteId)}
                    className={`min-h-[40px] rounded-xl px-4 text-xs font-semibold disabled:opacity-50 ${accent.btn}`}
                  >
                    Post Preview Card
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
