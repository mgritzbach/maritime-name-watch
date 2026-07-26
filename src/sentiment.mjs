export function mentionPolarity(analysis) {
  const positive = Number(analysis?.positive ?? 0);
  const negative = Number(analysis?.negative ?? 0);
  const polarized = positive + negative;
  if (polarized < 20) return null;
  return {
    positive: round(positive / polarized * 100),
    negative: round(negative / polarized * 100)
  };
}

export function aggregateMentions(mentions) {
  const polarities = mentions
    .filter((mention) => mention.relevant && mention.analysis)
    .map((mention) => mentionPolarity(mention.analysis))
    .filter(Boolean);
  if (!polarities.length) return { count: 0, positive: null, negative: null };
  const positive = polarities.reduce((sum, polarity) => sum + polarity.positive, 0) / polarities.length;
  return { count: polarities.length, positive: round(positive), negative: round(100 - positive) };
}

export function calculateChange(previousMentions, newMention) {
  const before = aggregateMentions(previousMentions);
  const after = aggregateMentions([...previousMentions, newMention]);
  const current = mentionPolarity(newMention.analysis);
  return {
    current,
    before,
    after,
    delta: before.count && after.count
      ? {
          positive: round(after.positive - before.positive),
          negative: round(after.negative - before.negative)
        }
      : null
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}
