import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCoinUnlockSplit,
  calculateDailyStreakReward,
  calculateExamCountdownDays,
  computeSha256,
  evaluateQuizReward,
  getCreatorLevel,
  isRedeemLocked,
  isSpinEligible,
  isWithinRefundWindow,
  moderateChatMessage,
  normalizeCode,
  parsePositiveIntCoins,
  pickSpinWheelSlice,
  signViewerToken,
  validateCoinTransferEligibility,
  validateDoubtRewardCoins,
  validateNoteUploadPriceCoins,
  validateUploadRewardCoins,
  verifyViewerToken,
} from './domain';

test('calculateCoinUnlockSplit splits 10 coins into 5 uploader + 5 burned', () => {
  const split = calculateCoinUnlockSplit(10);
  assert.equal(split.totalCoins, 10);
  assert.equal(split.uploaderCoins, 5);
  assert.equal(split.burnedCoins, 5);
});

test('validateCoinTransferEligibility enforces 24h age, 1 unlock, daily cap, and device separation', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const oldAcc = '2026-11-20T12:00:00Z';
  const freshAcc = '2026-11-24T10:00:00Z';

  assert.equal(
    validateCoinTransferEligibility({
      amountCoins: 10,
      senderBalance: 30,
      senderCreatedAtIso: oldAcc,
      senderCompletedUnlocks: 1,
      senderSentTodayCoins: 50,
      senderDeviceId: 'dev_a',
      receiverDeviceId: 'dev_b',
      nowMs: now,
    }),
    null,
  );

  // Fresh account < 24h blocked
  assert.ok(
    validateCoinTransferEligibility({
      amountCoins: 10,
      senderBalance: 30,
      senderCreatedAtIso: freshAcc,
      senderCompletedUnlocks: 1,
      senderSentTodayCoins: 0,
      senderDeviceId: 'dev_a',
      receiverDeviceId: 'dev_b',
      nowMs: now,
    }),
  );

  // Zero completed unlocks blocked
  assert.ok(
    validateCoinTransferEligibility({
      amountCoins: 10,
      senderBalance: 30,
      senderCreatedAtIso: oldAcc,
      senderCompletedUnlocks: 0,
      senderSentTodayCoins: 0,
      senderDeviceId: 'dev_a',
      receiverDeviceId: 'dev_b',
      nowMs: now,
    }),
  );

  // Same device blocked
  assert.ok(
    validateCoinTransferEligibility({
      amountCoins: 10,
      senderBalance: 30,
      senderCreatedAtIso: oldAcc,
      senderCompletedUnlocks: 2,
      senderSentTodayCoins: 0,
      senderDeviceId: 'dev_same',
      receiverDeviceId: 'dev_same',
      nowMs: now,
    }),
  );

  // Exceeds 100 coins/day blocked
  assert.ok(
    validateCoinTransferEligibility({
      amountCoins: 20,
      senderBalance: 50,
      senderCreatedAtIso: oldAcc,
      senderCompletedUnlocks: 2,
      senderSentTodayCoins: 90,
      senderDeviceId: 'dev_a',
      receiverDeviceId: 'dev_b',
      nowMs: now,
    }),
  );
});

test('moderateChatMessage blocks untrusted links and allows NCERT/plain text', () => {
  assert.equal(moderateChatMessage('Hey anyone studying Electrostatics?').ok, true);
  assert.equal(moderateChatMessage('Check https://ncert.nic.in/textbook.php').ok, true);
  assert.equal(moderateChatMessage('Click https://phishing-site.xyz/free').ok, false);
  assert.equal(moderateChatMessage('aaaaaaaaaaaaaaaaaaaaaa').ok, false);
});

test('price, upload reward, and doubt reward bounds enforce specs', () => {
  assert.equal(validateNoteUploadPriceCoins(1), null);
  assert.equal(validateNoteUploadPriceCoins(50), null);
  assert.ok(validateNoteUploadPriceCoins(0));
  assert.ok(validateNoteUploadPriceCoins(51));
  assert.equal(validateUploadRewardCoins(2), null);
  assert.ok(validateUploadRewardCoins(3));
  assert.equal(validateDoubtRewardCoins(5), null);
  assert.ok(validateDoubtRewardCoins(6));
});

test('daily login streak, spin wheel, and quiz rewards work cleanly', () => {
  const day7 = calculateDailyStreakReward(6, '2026-11-23', '2026-11-24');
  assert.equal(day7.coinsAwarded, 4);
  assert.equal(day7.isSevenDayBonus, true);

  assert.equal(isSpinEligible(null).eligible, true);
  const spin = pickSpinWheelSlice();
  assert.ok(spin.coins >= 0 && spin.coins <= 5);

  assert.equal(
    evaluateQuizReward({
      score: 4,
      totalQuestions: 5,
      alreadyRewardedForNote: false,
      rewardsEarnedToday: 2,
    }).coinsAwarded,
    1,
  );
});

test('levels, exam countdown, refund window, codes, tokens, and hashes', () => {
  assert.equal(getCreatorLevel(10).level, 'Top Uploader');
  assert.equal(calculateExamCountdownDays('2026-12-04', '2026-11-24'), 10);
  const now = Date.parse('2026-11-24T12:00:00Z');
  assert.equal(isWithinRefundWindow('2026-11-24T00:00:00Z', now), true);
  assert.equal(parsePositiveIntCoins('15'), 15);
  assert.equal(normalizeCode('  diwali 20! '), 'DIWALI20');
  assert.equal(isRedeemLocked(5, new Date(now + 60_000).toISOString(), now), true);

  const token = signViewerToken({ noteId: 'n1', userId: 'u1', exp: 2_000_000_000 }, 'sec');
  assert.equal(verifyViewerToken(token, 'sec', 1_700_000_000)?.noteId, 'n1');
  assert.equal(computeSha256(Buffer.from('abc')), computeSha256(Buffer.from('abc')));
});
