# telegram

- Source file: src/telegram.ts
- Lines: 1049
- Responsibility: Telegram Bot API polling/sending/downloading abstraction.

## Exported API

```ts
export const TELEGRAM_JID_PREFIX = 'telegram:';
export function isTelegramJid(jid: string): boolean {
export function parseTelegramChatId(jid: string): string | null {
export interface TelegramEntity {
export type TelegramMediaType =
export interface TelegramInboundMedia {
export type TelegramInboundMessageType =
export interface TelegramInboundMessage {
export interface TelegramInboundCallbackQuery {
export type TelegramInboundEvent =
export interface TelegramInlineKeyboardButton {
export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];
export interface TelegramCommand {
export type TelegramCommandScope =
export interface TelegramDownloadFileResult {
export function splitTelegramText(
export function splitTelegramTextForHtmlLimit(
export interface TelegramBotOptions {
export interface TelegramBot {
export function createTelegramBot(opts: TelegramBotOptions): TelegramBot {
```

## Environment Variables Referenced

- FFT_NANO_TELEGRAM_RETRY_ATTEMPTS
- FFT_NANO_TELEGRAM_RETRY_MAX_MS
- FFT_NANO_TELEGRAM_RETRY_MIN_MS
- FFT_NANO_TELEGRAM_TYPING_REFRESH_MS

## Notable Internal Symbols

```ts
class TelegramApiError extends Error {
interface TelegramApiResponse<T> {
interface TelegramUpdate {
interface TelegramPhotoSize {
interface TelegramMessage {
interface TelegramCallbackQuery {
interface TelegramFileInfo {
function getChatName(chat: TelegramMessage['chat']): string {
function getSenderName(
function sleep(ms: number): Promise<void> {
function extractMention(text: string, entity: TelegramEntity): string | null {
function normalizeMentionTrigger(
function selectLargestPhoto(photo: TelegramPhotoSize[]): TelegramPhotoSize | null {
function buildMessageMedia(msg: TelegramMessage): TelegramInboundMedia | undefined {
function buildMessageType(msg: TelegramMessage): TelegramInboundMessageType {
function buildMessageContent(
function buildCommandScopePayload(
function buildReplyMarkup(
```
