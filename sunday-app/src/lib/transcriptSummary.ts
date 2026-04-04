const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function summarizeTranscript(text: string) {
  const words = text.match(/[A-Za-z0-9']+/g) ?? [];
  const meaningfulWords = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const selected = (meaningfulWords.length >= 3 ? meaningfulWords : words).slice(0, 5);
  const summary = selected.join(" ").trim();

  if (!summary) {
    return "Untitled Voice Note";
  }

  return toTitleCase(summary);
}
