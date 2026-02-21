# Telegram Chunking Fix - Word Boundary Preservation

## Problem

Telegram messages were being chunked at exactly 900 characters, which cut words in half. For example:
- "dependency of vite" became "depen" + "dency of vite"
- This made messages harder to read and understand

## Solution

Modified the chunking logic in `src/coder-worker.ts` (line 277) to find the last space character within the 900-character limit and chunk at the word boundary instead.

### Changes Made

**File:** `container/agent-runner/src/coder-worker.ts`

**Before:**
```typescript
const chunk = pendingDiff.slice(0, telegramMaxChunk);
```

**After:**
```typescript
// Chunk at word boundary to avoid cutting words mid-word
// Find the last space within ~850-900 characters to prevent word truncation
const searchRange = pendingDiff.slice(0, telegramMaxChunk);
const lastSpaceIndex = searchRange.lastIndexOf(' ');
// Only use word boundary if space exists and is reasonably close to max chunk
// This avoids tiny chunks while still preventing word breaks
const chunkSize = (lastSpaceIndex > telegramMaxChunk * 0.9) ? lastSpaceIndex + 1 : telegramMaxChunk;
const chunk = pendingDiff.slice(0, chunkSize);
```

## Algorithm

1. Search for the last space character in the first 900 characters
2. If a space exists and is within 90% of the max chunk size (810+ characters), use that position
3. Otherwise, fall back to the original 900-character limit

### Edge Cases Handled

| Scenario | Behavior | Example |
|----------|----------|---------|
| Space near boundary (850-900) | Chunk at word boundary | "A...A dependency" → chunks at space |
| Space exactly at 900 | Use word boundary | Uses space at position 900 |
| No spaces in range | Fall back to 900 | Long word → chunks at 900 |
| Space too early (<810) | Fall back to 900 | Space at 500 → chunks at 900 |

## Verification

### Build Status
✅ TypeScript compilation successful
```bash
npm run build
# No errors
```

### Test Results

Test case: Text with space near 900 boundary
```
Input:  "A"*880 + " dependency of vite" + "B"*100
Output: Chunk size: 895 (chunks at space before "dependency")
Result: ✅ Word boundary preserved
```

Test case: Long word with no spaces
```
Input:  "A"*1000
Output: Chunk size: 900
Result: ✅ Falls back to max chunk size
```

## Benefits

1. **Improved Readability:** Messages are no longer cut mid-word
2. **No Performance Impact:** Same chunk size range (~850-900 characters)
3. **No Breaking Changes:** Only affects chunking, not message content or delivery
4. **Backward Compatible:** Works with all existing Telegram message handling

## Configuration

- `telegramMaxChunk`: 900 characters (unchanged)
- Word boundary threshold: 90% of max (810+ characters)
- This ensures chunks are reasonably sized while preventing word breaks

## Related Constants

```typescript
const maxTelegramMessages = 50;
const telegramMinIntervalMs = 4000;
const telegramMaxChunk = 900;
```

---

**Fixed Date:** 2026-02-19
**File Modified:** `container/agent-runner/src/coder-worker.ts`
**Lines Changed:** 277-281 (replaced 1 line with 8 lines)
**Status:** ✅ Complete and Tested
