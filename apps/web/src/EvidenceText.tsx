import type { ReactNode } from "react";

type EvidenceTextProps = {
  text: string;
  phrases?: string[];
  lang: string;
  className?: string;
};

type HighlightRange = {
  start: number;
  end: number;
};

function groundedRanges(text: string, phrases: string[]): HighlightRange[] {
  const normalizedText = text.toLocaleLowerCase();
  const candidates: HighlightRange[] = [];

  for (const rawPhrase of phrases) {
    const phrase = rawPhrase.trim();
    if (!phrase) continue;
    const normalizedPhrase = phrase.toLocaleLowerCase();
    let fromIndex = 0;
    while (fromIndex < normalizedText.length) {
      const start = normalizedText.indexOf(normalizedPhrase, fromIndex);
      if (start < 0) break;
      candidates.push({ start, end: start + phrase.length });
      fromIndex = start + phrase.length;
    }
  }

  candidates.sort(
    (left, right) =>
      left.start - right.start || right.end - right.start - (left.end - left.start)
  );

  const accepted: HighlightRange[] = [];
  for (const candidate of candidates) {
    if (accepted.some(range => candidate.start < range.end)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

export function EvidenceText({
  text,
  phrases = [],
  lang,
  className
}: EvidenceTextProps) {
  const ranges = groundedRanges(text, phrases);
  if (ranges.length === 0) {
    return <p className={className} lang={lang}>{text}</p>;
  }

  const content: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) content.push(text.slice(cursor, range.start));
    content.push(
      <mark className="evidence-keyword" key={`${range.start}-${range.end}`}>
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  }
  if (cursor < text.length) content.push(text.slice(cursor));

  return <p className={className} lang={lang}>{content}</p>;
}
