# memory-search

- Source file: src/memory-search.ts
- Lines: 354
- Responsibility: Document/transcript memory search and hit ranking/merge utilities.

## Exported API

```ts
export type MemorySourceFilter = 'memory' | 'sessions' | 'all';
export interface MemorySearchHit {
export interface MemoryDocument {
export function searchDocumentMemory(input: {
export function searchTranscriptMemory(input: {
export function mergeAndRankMemoryHits(
export function getMemoryDocument(input: {
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
interface DocumentChunk {
function normalize(text: string): string {
function tokenize(text: string): string[] {
function splitLongSegment(segment: string): string[] {
function chunkMemoryText(text: string): string[] {
function lexicalScore(queryTokens: string[], queryText: string, chunkText: string): number {
function listMarkdownFiles(dir: string): string[] {
function collectDocumentFiles(groupFolder: string): Array<{ abs: string; rel: string }> {
function collectDocumentChunks(groupFolder: string): DocumentChunk[] {
function toTranscriptHit(
```
