# memory-retrieval

- Source file: src/memory-retrieval.ts
- Lines: 388
- Responsibility: Retrieval-gated memory context construction and lexical chunk ranking.

## Exported API

```ts
export interface BuildMemoryContextInput {
export interface MemoryContextBuildResult {
export function buildMemoryContext(
```

## Environment Variables Referenced

None in this module.

## Notable Internal Symbols

```ts
type MemorySource = 'group' | 'global';
interface MemoryChunk {
interface ChunkCacheEntry {
function readFileIfExists(filePath: string): string | null {
function getChunkedFile(filePath: string): string[] {
function tokenize(text: string): string[] {
function splitLongSegment(segment: string): string[] {
function chunkMemoryText(text: string): string[] {
function extractQueryText(prompt: string): string {
function lexicalScore(
function formatSnippet(rank: number, chunk: MemoryChunk): string {
function getPreferredMemoryChunks(baseDir: string): string[] {
```
