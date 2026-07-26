import test from "node:test";
import assert from "node:assert/strict";
import { aggregateMentions, calculateChange, mentionPolarity } from "../src/sentiment.mjs";

function mention(positive, negative, neutral = 0) {
  return { relevant: true, analysis: { positive, negative, neutral } };
}

test("normalizes away neutral sentiment and calculates percentage-point change", () => {
  const first = mention(80, 20);
  const second = mention(20, 80);
  assert.deepEqual(mentionPolarity(first.analysis), { positive: 80, negative: 20 });
  assert.deepEqual(aggregateMentions([first, second]), { count: 2, positive: 50, negative: 50 });
  assert.deepEqual(calculateChange([first], second), {
    current: { positive: 20, negative: 80 },
    before: { count: 1, positive: 80, negative: 20 },
    after: { count: 2, positive: 50, negative: 50 },
    delta: { positive: -30, negative: 30 }
  });
});

test("neutral mentions do not alter the historical rate", () => {
  const positive = mention(80, 20);
  const neutral = mention(5, 5, 90);
  assert.equal(mentionPolarity(neutral.analysis), null);
  assert.deepEqual(aggregateMentions([positive, neutral]), { count: 1, positive: 80, negative: 20 });
});
