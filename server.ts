import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { initDatabase, purgeExpiredChatHistory } from './server/db';
import { createAdminRouter } from './server/routes/admin';
import { createAiRouter, createGeneralAiRouter } from './server/routes/ai';
import { attachOptionalUser, createAuthRouter } from './server/routes/auth';
import { createChatRouter } from './server/routes/chat';
import { createCommunityRouter } from './server/routes/community';
import { createNotesRouter } from './server/routes/notes';
import { createWalletRouter } from './server/routes/wallet';
import { csrfProtection } from './server/security';
import { setupWebSocketHub } from './server/ws';

async function startServer(): Promise<void> {
  initDatabase();

  // Periodically purge chat history older than 30 days
  setInterval(() => {
    try {
      purgeExpiredChatHistory();
    } catch {
      // ignore background purge failure
    }
  }, 60 * 60 * 1000);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', csrfProtection);
  app.use('/api', attachOptionalUser);

  app.use('/api/auth', createAuthRouter());
  app.use('/api/notes', createNotesRouter());
  app.use('/api/notes', createAiRouter());
  app.use('/api/ai', createGeneralAiRouter());
  app.use('/api/wallet', createWalletRouter());
  app.use('/api/community', createCommunityRouter());
  app.use('/api/chat', createChatRouter());
  app.use('/api/admin', createAdminRouter());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'NoteSwap' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocketHub(wss);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`NoteSwap server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start NoteSwap server:', err);
  process.exit(1);
});
