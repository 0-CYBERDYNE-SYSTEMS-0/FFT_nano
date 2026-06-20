import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'fft.panel.';

function readStored(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === 'open') return true;
    if (raw === 'closed') return false;
  } catch {
    // localStorage may throw in private mode; fall through.
  }
  return fallback;
}

function writeStored(key: string, open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? 'open' : 'closed');
  } catch {
    // Ignore quota / privacy errors; the toggle still works in-memory.
  }
}

export interface CollapseState {
  open: boolean;
  toggle: () => void;
  setOpen: (next: boolean) => void;
}

export function useCollapse(key: string, defaultOpen: boolean): CollapseState {
  const [open, setOpen] = useState<boolean>(() => readStored(key, defaultOpen));

  useEffect(() => {
    writeStored(key, open);
  }, [key, open]);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const setOpenValue = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  return { open, toggle, setOpen: setOpenValue };
}

export interface ViewState {
  layout: 'dock' | 'stacked';
  setLayout: (next: 'dock' | 'stacked') => void;
  chatFocus: boolean;
  setChatFocus: (next: boolean) => void;
}

const VIEW_KEY = 'fft.view';

function readView(): { layout: 'dock' | 'stacked'; chatFocus: boolean } {
  if (typeof window === 'undefined') {
    return { layout: 'dock', chatFocus: false };
  }
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return { layout: 'dock', chatFocus: false };
    const parsed = JSON.parse(raw) as { layout?: string; chatFocus?: boolean };
    return {
      layout: parsed.layout === 'stacked' ? 'stacked' : 'dock',
      chatFocus: parsed.chatFocus === true,
    };
  } catch {
    return { layout: 'dock', chatFocus: false };
  }
}

export function useViewState(): ViewState {
  const [layout, setLayoutState] = useState<'dock' | 'stacked'>(() =>
    readView().layout,
  );
  const [chatFocus, setChatFocusState] = useState<boolean>(() =>
    readView().chatFocus,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        VIEW_KEY,
        JSON.stringify({ layout, chatFocus }),
      );
    } catch {
      // Ignore.
    }
  }, [layout, chatFocus]);

  const setLayout = useCallback((next: 'dock' | 'stacked') => {
    setLayoutState(next);
  }, []);

  const setChatFocus = useCallback((next: boolean) => {
    setChatFocusState(next);
  }, []);

  return { layout, setLayout, chatFocus, setChatFocus };
}
