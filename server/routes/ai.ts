import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import type { Response } from 'express';
import express from 'express';
import multer from 'multer';
import { checkAndUnlockAchievements } from '../achievements';
import { db } from '../db';
import { evaluateQuizReward, QUIZ_MAX_DAILY_REWARDS } from '../domain';
import { resolveSafePrivatePath } from '../noteRenderer';
import { createRateLimiter } from '../security';
import { type AuthedRequest, requireAuth } from './auth';
import { extractNotePlainText, userHasFullAccess } from './notes';

interface Flashcard {
  front: string;
  back: string;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const doubtUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  retries = 3,
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message || '';
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('500') ||
        msg.includes('429');
      if (!isTransient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const msg = (err as Error)?.message || 'Gemini AI request failed';
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return {
      status: 403,
      message: 'Check your GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return {
      status: 429,
      message: 'Gemini quota temporarily reached. Try again shortly or upgrade your key in Settings > Secrets.',
    };
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message: 'Gemini AI is experiencing high demand right now. Please try again in a few seconds.',
    };
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return {
      status: 502,
      message: 'Configured Gemini model is unavailable right now.',
    };
  }
  return {
    status: 502,
    message: `Gemini could not complete that request: ${msg}`,
  };
}

function buildNoteContents(
  note: {
    id: string;
    title: string;
    subject: string;
    exam_class: string;
    description: string;
    file_type: string;
    file_path: string;
  },
  promptText: string,
) {
  if (note.file_type === 'structured') {
    const plain = extractNotePlainText(note as never);
    return `${promptText}\n\n--- NOTE CONTENT ---\n${plain}`;
  }

  const safePath = resolveSafePrivatePath(note.file_path);
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    {
      text: `${promptText}\n\nNote Title: ${note.title}\nSubject: ${note.subject}\nExam: ${note.exam_class}\nDescription: ${note.description}`,
    },
  ];

  if (note.file_type === 'image') {
    const files = JSON.parse(fs.readFileSync(safePath, 'utf8')) as string[];
    for (const rel of files.slice(0, 10)) {
      const imgPath = resolveSafePrivatePath(rel);
      const ext = path.extname(imgPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType,
          data: fs.readFileSync(imgPath).toString('base64'),
        },
      });
    }
  } else if (note.file_type === 'pdf') {
    const pdfData = fs.readFileSync(safePath);
    if (pdfData.byteLength <= 15 * 1024 * 1024) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfData.toString('base64'),
        },
      });
    }
  }

  return { parts };
}

export function createAiRouter(): express.Router {
  const router = express.Router();
  const aiLimiter = createRateLimiter('gemini_ai', 25, 60 * 1000);

  // Generate or fetch cached AI Summary, 10 Flashcards, and 5-Question Quiz (works for Image & PDF notes)
  router.post('/:id/ai-kit', requireAuth, aiLimiter, async (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as
      | {
          id: string;
          uploader_id: string;
          title: string;
          subject: string;
          exam_class: string;
          description: string;
          is_free_sample: number;
          file_type: string;
          file_path: string;
        }
      | undefined;

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    if (!userHasFullAccess(user.id, note as never)) {
      res.status(403).json({ error: 'Unlock this note first to use AI Study Studio' });
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const rewardsToday = (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM quiz_attempts WHERE user_id = ? AND reward_coins > 0 AND substr(created_at, 1, 10) = ?",
        )
        .get(user.id, todayStr) as { c: number }
    ).c;

    const alreadyRewarded = Boolean(
      db
        .prepare('SELECT 1 FROM quiz_attempts WHERE user_id = ? AND note_id = ? AND reward_coins > 0')
        .get(user.id, note.id),
    );

    const cached = db.prepare('SELECT * FROM note_ai_kits WHERE note_id = ?').get(note.id) as
      | { summary: string; flashcards_json: string; quiz_json: string }
      | undefined;

    if (cached) {
      const flashcards = JSON.parse(cached.flashcards_json) as Flashcard[];
      const quiz = JSON.parse(cached.quiz_json) as QuizQuestion[];
      res.json({
        summary: cached.summary,
        flashcards,
        quiz: quiz.map((q) => ({ question: q.question, options: q.options })),
        alreadyRewarded,
        rewardsToday,
        maxDailyRewards: QUIZ_MAX_DAILY_REWARDS,
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    try {
      const contents = buildNoteContents(
        note,
        'Read all provided note images or PDF carefully and generate a concise study kit strictly from this note: (1) a clear exam-focused summary (3-4 sentences), (2) exactly 10 study flashcards (front and back), and (3) exactly 5 multiple-choice quiz questions with 4 options each, correctIndex (0-3), and a 1-sentence explanation.',
      );

      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction:
            'You are an academic study assistant. Base every summary point, flashcard, and quiz question strictly on the provided note material (images or PDF).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: { type: Type.STRING },
                    back: { type: Type.STRING },
                  },
                  required: ['front', 'back'],
                },
              },
              quiz: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                  },
                  required: ['question', 'options', 'correctIndex', 'explanation'],
                },
              },
            },
            required: ['summary', 'flashcards', 'quiz'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        summary: string;
        flashcards: Flashcard[];
        quiz: QuizQuestion[];
      };

      const flashcards = (parsed.flashcards || []).slice(0, 10);
      const quiz = (parsed.quiz || []).slice(0, 5);

      db.prepare(
        `INSERT OR REPLACE INTO note_ai_kits (note_id, summary, flashcards_json, quiz_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(note.id, parsed.summary || '', JSON.stringify(flashcards), JSON.stringify(quiz), new Date().toISOString());

      res.json({
        summary: parsed.summary || '',
        flashcards,
        quiz: quiz.map((q) => ({ question: q.question, options: q.options })),
        alreadyRewarded,
        rewardsToday,
        maxDailyRewards: QUIZ_MAX_DAILY_REWARDS,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Grade 5-question quiz on server & award +1 Coin if >= 4/5 (max 3 quiz rewards/day)
  router.post('/:id/quiz/submit', requireAuth, aiLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const noteId = req.params.id;
    const answers = Array.isArray(req.body?.answers) ? (req.body.answers as number[]) : [];

    const kit = db.prepare('SELECT quiz_json FROM note_ai_kits WHERE note_id = ?').get(noteId) as
      | { quiz_json: string }
      | undefined;
    if (!kit) {
      res.status(404).json({ error: 'Generate the AI quiz first' });
      return;
    }

    const quiz = JSON.parse(kit.quiz_json) as QuizQuestion[];
    if (answers.length !== quiz.length) {
      res.status(400).json({ error: `Please answer all ${quiz.length} questions` });
      return;
    }

    let score = 0;
    const corrections = quiz.map((q, idx) => {
      const selected = Number(answers[idx]);
      const isCorrect = selected === q.correctIndex;
      if (isCorrect) score++;
      return {
        selectedIndex: selected,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      };
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const result = db.transaction(() => {
      const alreadyRewarded = Boolean(
        db
          .prepare('SELECT 1 FROM quiz_attempts WHERE user_id = ? AND note_id = ? AND reward_coins > 0')
          .get(user.id, noteId),
      );
      const rewardsToday = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM quiz_attempts WHERE user_id = ? AND reward_coins > 0 AND substr(created_at, 1, 10) = ?',
          )
          .get(user.id, todayStr) as { c: number }
      ).c;

      const evalRes = evaluateQuizReward({
        score,
        totalQuestions: quiz.length,
        alreadyRewardedForNote: alreadyRewarded,
        rewardsEarnedToday: rewardsToday,
      });

      db.prepare(
        `INSERT INTO quiz_attempts (id, user_id, note_id, score, total_questions, reward_coins, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(`qz_${crypto.randomUUID().slice(0, 10)}`, user.id, noteId, score, quiz.length, evalRes.coinsAwarded, now);

      if (evalRes.coinsAwarded > 0) {
        db.prepare(
          'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
        ).run(evalRes.coinsAwarded, evalRes.coinsAwarded, user.id);

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'quiz_reward', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          evalRes.coinsAwarded,
          `Scored ${score}/${quiz.length} on AI Note Quiz`,
          noteId,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'quiz_reward', 'note', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          noteId,
          evalRes.coinsAwarded,
          JSON.stringify({ score, total: quiz.length }),
          now,
        );
      }

      const updatedBalance = (
        db.prepare('SELECT coins_balance FROM users WHERE id = ?').get(user.id) as { coins_balance: number }
      ).coins_balance;

      return {
        ...evalRes,
        alreadyRewarded,
        rewardsToday: rewardsToday + (evalRes.coinsAwarded > 0 ? 1 : 0),
        updatedBalance,
      };
    })();

    const newlyUnlocked = checkAndUnlockAchievements(user.id);

    res.json({
      score,
      total: quiz.length,
      passed: result.passed,
      coinsAwarded: result.coinsAwarded,
      alreadyRewarded: result.alreadyRewarded,
      rewardsToday: result.rewardsToday,
      maxDailyRewards: QUIZ_MAX_DAILY_REWARDS,
      coinsBalance: result.updatedBalance,
      corrections,
      newlyUnlocked,
    });
  });

  // "Ask this note" strictly grounded in the unlocked note's image/PDF content
  router.post('/:id/ask', requireAuth, aiLimiter, async (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const question = String(req.body?.question || '').trim().slice(0, 500);
    if (question.length < 3) {
      res.status(400).json({ error: 'Enter a question about this note' });
      return;
    }

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as
      | {
          id: string;
          uploader_id: string;
          title: string;
          subject: string;
          exam_class: string;
          description: string;
          is_free_sample: number;
          file_type: string;
          file_path: string;
        }
      | undefined;

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    if (!userHasFullAccess(user.id, note as never)) {
      res.status(403).json({ error: 'Unlock this note first to ask questions about it' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    try {
      const contents = buildNoteContents(note, `Student question: ${question}`);
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction:
            'You are "Ask this note", a strict study tutor. Answer ONLY using facts, formulas, diagrams, and explanations present in the provided note images or PDF. If the answer is not in the note, reply clearly: "This topic is not covered in this note." Keep answers clear and concise.',
        },
      });
      res.json({ answer: (response.text ?? '').trim() || 'No answer returned.' });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return router;
}

export function createGeneralAiRouter(): express.Router {
  const router = express.Router();
  const aiLimiter = createRateLimiter('gemini_general', 30, 60 * 1000);

  // Ask Gemini a study doubt directly (supports text + optional image or PDF attachment!)
  router.post(
    '/doubt',
    requireAuth,
    aiLimiter,
    doubtUpload.single('file'),
    async (req: AuthedRequest, res: Response) => {
      const question = String(req.body?.question || '').trim().slice(0, 1500);
      const subject = String(req.body?.subject || 'General Studies').trim().slice(0, 50);
      const examClass = String(req.body?.examClass || 'Competitive & Boards').trim().slice(0, 50);
      const file = req.file;

      if (question.length < 4 && !file) {
        res.status(400).json({ error: 'Type your study doubt or attach a question image/PDF.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Gemini API key is not configured. Add GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }

      const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
      if (file && !allowedMimes.has(file.mimetype)) {
        res.status(400).json({ error: 'Only PNG, JPG, WebP images or PDF files are supported.' });
        return;
      }

      try {
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
          {
            text: `Subject: ${subject}\nExam/Level: ${examClass}\nStudent Doubt: ${question || 'Please solve and explain the attached question.'}`,
          },
        ];
        if (file) {
          parts.push({
            inlineData: {
              mimeType: file.mimetype,
              data: file.buffer.toString('base64'),
            },
          });
        }

        const response = await generateWithRetry(ai, {
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            systemInstruction:
              'You are Gemini Study Tutor inside NoteSwap. Explain student doubts step by step in clear plain text, include key formulas or definitions, and add one short exam tip at the end.',
          },
        });

        res.json({
          answer: (response.text ?? '').trim() || 'Could not generate an answer. Please rephrase your doubt.',
          hasAttachment: Boolean(file),
        });
      } catch (err) {
        const formatted = formatGeminiError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    },
  );

  // Ask Gemini AI to solve a community Doubt Forum thread
  router.post('/doubts/:doubtId/solve', requireAuth, aiLimiter, async (req: AuthedRequest, res: Response) => {
    const doubt = db.prepare('SELECT * FROM doubts WHERE id = ?').get(req.params.doubtId) as
      | { id: string; title: string; body: string; subject: string; exam_class: string }
      | undefined;
    if (!doubt) {
      res.status(404).json({ error: 'Doubt not found' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Gemini API key is not configured. Add GEMINI_API_KEY in Settings > Secrets.',
      });
      return;
    }

    try {
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: `Subject: ${doubt.subject}\nExam: ${doubt.exam_class}\nQuestion Title: ${doubt.title}\nDetails: ${doubt.body}`,
        config: {
          systemInstruction:
            'You are Gemini Study Tutor. Give a clear, step-by-step explanation for the student doubt above, highlighting key formulas and concepts.',
        },
      });
      res.json({ answer: (response.text ?? '').trim() || 'No explanation generated.' });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Gemini Error Troubleshooting Assistant ("if there is any error the gemini helps")
  router.post('/help-error', aiLimiter, async (req, res: Response) => {
    const errorMessage = String(req.body?.errorMessage || '').trim().slice(0, 800);
    const contextPage = String(req.body?.contextPage || 'app').trim().slice(0, 80);
    const followUp = String(req.body?.followUp || '').trim().slice(0, 400);

    if (!errorMessage && !followUp) {
      res.status(400).json({ error: 'Describe the error or question you need help with.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.json({
        advice:
          '1. Check your internet connection and sign-in status.\n2. Verify your GEMINI_API_KEY in Settings > Secrets if an AI feature failed.\n3. For email sign-in issues, use the 6-Digit Email Code option or Google Sign-In.',
        source: 'offline_fallback',
      });
      return;
    }

    try {
      const prompt = `Screen/Context: ${contextPage}\nError Message: ${errorMessage || 'None'}\nUser Question: ${followUp || 'Explain why this happened and how to fix it step by step.'}`;
      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are the NoteSwap Troubleshooter powered by Gemini. Help the student or admin resolve errors clearly in 2-4 numbered steps. NoteSwap supports Google Sign-In (Firebase), Email & Password / 6-digit Email OTP sign-in, Image & PDF note uploads (up to 10 images or 1 PDF up to 10 MB), virtual Coins, and AI Study Studio. Keep instructions practical and concise.',
        },
      });
      res.json({
        advice: (response.text ?? '').trim() || 'Try refreshing the page and signing in again.',
        source: 'gemini',
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      const lower = `${errorMessage} ${followUp}`.toLowerCase();
      let hint =
        '1. Refresh the page and verify you are signed in.\n2. For uploads, use 1 PDF (up to 10 MB) or up to 10 PNG/JPG/WebP images.';
      if (lower.includes('passcode') || lower.includes('admin')) {
        hint =
          '1. Double-check that Caps Lock is off and re-enter the exact Admin passcode.\n2. If you are a student trying to upload or buy notes, switch to the Google or Firebase Email tab instead.';
      } else if (lower.includes('email') || lower.includes('password') || lower.includes('otp') || lower.includes('firebase')) {
        hint =
          '1. Verify your email address format and password (6+ characters).\n2. If Firebase Email/Password is not enabled yet, click "6-Digit Email Code" in the Firebase Email tab for instant verification.';
      }
      res.json({
        advice: `${hint}\n\n(Note: Live Gemini troubleshooting returned: ${formatted.message})`,
        source: 'fallback',
      });
    }
  });

  return router;
}
