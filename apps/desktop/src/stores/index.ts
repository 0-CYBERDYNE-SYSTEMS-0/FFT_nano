/**
 * FFT_nano Desktop - Nanostores State Management
 * 
 * This module provides lightweight state management using nanostores.
 */

import { atom, map } from 'nanostores';

// Host connection status
export const $hostStatus = atom<{
  running: boolean;
  port: number | null;
}>({
  running: false,
  port: null,
});

// WebSocket connection status
export const $wsConnected = atom<boolean>(false);

// Current active tab
export const $activeTab = atom<'chat' | 'settings'>('chat');

// Messages in the chat
export const $messages = map<Record<string, Record<string, unknown>>>({});

// Settings
export const $settings = map<{
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  startOnBoot: boolean;
  minimizeToTray: boolean;
}>({
  theme: 'system',
  notifications: true,
  startOnBoot: false,
  minimizeToTray: true,
});

// Update functions
export function setHostStatus(status: { running: boolean; port: number | null }) {
  $hostStatus.set(status);
}

export function setWsConnected(connected: boolean) {
  $wsConnected.set(connected);
}

export function setActiveTab(tab: 'chat' | 'settings') {
  $activeTab.set(tab);
}

export function addMessage(message: Record<string, unknown>) {
  const current = $messages.get();
  const key = Date.now().toString();
  $messages.set({ ...current, [key]: message });
}

export function updateSettings(settings: Partial<ReturnType<typeof $settings.get>>) {
  const current = $settings.get();
  $settings.set({ ...current, ...settings });
}
