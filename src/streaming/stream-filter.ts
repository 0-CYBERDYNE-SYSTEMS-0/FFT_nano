// Stream-path content filters for Telegram preview frames (telegram-spec W1/W4).

export const STREAM_CURSOR = ' ▉';

export const SILENCE_MARKERS = ['NO_REPLY', '[SILENT]'] as const;

export function isSilenceMarker(text: string): boolean {
  const trimmed = text.trim();
  for (const marker of SILENCE_MARKERS) {
    if (trimmed === marker) return true;
  }
  return false;
}

/**
 * Mid-stream holdback: while the whole accumulated buffer is still a prefix of
 * a silence marker (e.g. "NO" → "NO_REPLY"), hold the frame back so a partial
 * marker never flashes on screen. Text that merely ends with a marker prefix
 * is delivered unchanged.
 */
export function holdbackSilenceMarker(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  for (const marker of SILENCE_MARKERS) {
    if (marker.startsWith(trimmed)) return '';
  }
  return text;
}
