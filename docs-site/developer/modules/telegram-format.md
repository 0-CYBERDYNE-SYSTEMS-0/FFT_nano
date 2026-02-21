# telegram-format

- Source file: src/telegram-format.ts
- Lines: 343
- Responsibility: Markdown-to-Telegram HTML rendering and safe chunk splitting logic.

## Exported API

```ts
export function markdownToTelegramHtml(markdown: string): string {
export function renderTelegramHtmlText(
export function chunkTelegramMarkdownText(text: string, limit: number): string[] {
export function splitTelegramText(text: string, maxLen: number): string[] {
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
type FenceSpan = {
function escapeHtml(text: string): string {
function escapeHtmlAttr(text: string): string {
function parseFenceSpans(buffer: string): FenceSpan[] {
function findFenceSpanAt(spans: FenceSpan[], index: number): FenceSpan | undefined {
function isSafeFenceBreak(spans: FenceSpan[], index: number): boolean {
function renderInlineMarkdown(markdown: string): string {
function renderFenceCodeBlock(markdown: string, span: FenceSpan): string {
function stripLeadingNewlines(value: string): string {
function scanParenAwareBreakpoints(
function pickSafeBreakIndex(window: string, spans: FenceSpan[]): number {
function chunkPlainText(text: string, limit: number): string[] {
```
