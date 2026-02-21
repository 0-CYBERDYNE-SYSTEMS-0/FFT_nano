# index

- Source file: src/index.ts
- Lines: 3347
- Responsibility: Main host orchestrator: loops, commands, routing, delegation, scheduler, IPC.

## Exported API

No exported symbols.

## Environment Variables Referenced

- FFT_NANO_APPLE_CONTAINER_SELF_HEAL
- FFT_NANO_HEARTBEAT_EVERY
- FFT_NANO_HEARTBEAT_PROMPT
- PI_API
- PI_MODEL
- TELEGRAM_ADMIN_SECRET
- TELEGRAM_API_BASE_URL
- TELEGRAM_AUTO_REGISTER
- TELEGRAM_BOT_TOKEN
- TELEGRAM_MAIN_CHAT_ID
- WHATSAPP_ENABLED

## Notable Internal Symbols

```ts
type TelegramCommandName =
interface ActiveCoderRun {
type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type ReasoningLevel = 'off' | 'on' | 'stream';
type QueueMode =
type QueueDropPolicy = 'old' | 'new' | 'summarize';
interface ChatRunPreferences {
interface ChatUsageStats {
interface ActiveChatRun {
function translateJid(jid: string): string {
async function setTyping(jid: string, isTyping: boolean): Promise<void> {
function loadState(): void {
function saveState(): void {
function registerGroup(jid: string, group: RegisteredGroup): void {
function migrateCompactionSummariesFromSoul(): void {
function migrateLegacyClaudeMemoryFiles(): void {
function maybeRegisterWhatsAppMainChat(): void {
async function syncGroupMetadata(force = false): Promise<void> {
function getAvailableGroups(): AvailableGroup[] {
function maybeRegisterTelegramChat(chatJid: string, chatName: string): boolean {
function hasMainGroup(): boolean {
function promoteChatToMain(chatJid: string, chatName: string): void {
function maybePromoteConfiguredTelegramMain(): void {
function isMainChat(chatJid: string): boolean {
function parseTelegramTargetJid(raw: string): string | null {
function findMainTelegramChatJid(): string | null {
function findMainChatJid(): string | null {
function normalizeThinkLevel(raw: string): ThinkLevel | undefined {
function normalizeReasoningLevel(raw: string): ReasoningLevel | undefined {
function normalizeQueueMode(raw: string): QueueMode | undefined {
function normalizeQueueDrop(raw: string): QueueDropPolicy | undefined {
function parseDurationMs(raw: string): number | undefined {
function parseQueueArgs(argText: string): {
function compactChatRunPreferences(prefs: ChatRunPreferences): ChatRunPreferences | null {
function updateChatRunPreferences(
function consumeNextRunNoContinue(chatJid: string): boolean {
function getEffectiveModelLabel(chatJid: string): string {
function formatChatRuntimePreferences(chatJid: string): string[] {
function updateChatUsage(chatJid: string, usage?: {
function formatUsageText(chatJid: string, scope: 'chat' | 'all' = 'chat'): string {
function runPiListModels(searchText: string): { ok: boolean; text: string } {
function normalizeTelegramCommandToken(token: string): TelegramCommandName | null {
function formatHelpText(isMainGroup: boolean): string {
function formatStatusText(chatJid?: string): string {
function formatTasksText(): string {
function formatGroupsText(): string {
function buildAdminPanelKeyboard(): TelegramInlineKeyboard {
function formatActiveSubagentsText(): string {
async function runCompactionForChat(
function sanitizeFileName(value: string): string {
function defaultExtensionForMedia(message: TelegramInboundMessage): string {
async function persistTelegramMedia(
async function refreshTelegramCommandMenus(): Promise<void> {
function logTelegramCommandAudit(
async function handleTelegramCallbackQuery(
async function handleTelegramCommand(m: {
async function startTelegram(): Promise<void> {
async function processMessage(msg: NewMessage): Promise<boolean> {
async function runAgent(
async function sendMessage(jid: string, text: string): Promise<void> {
```
