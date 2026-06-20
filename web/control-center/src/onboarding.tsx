import { useEffect, useState } from 'react';
import type { JSX } from 'react';

interface OnboardingStatus {
  active: boolean;
  providerPreset: string;
  model: string;
  apiKeyConfigured: boolean;
  telegramBotConfigured: boolean;
  telegramAdminSecretConfigured: boolean;
  whatsappEnabled: boolean;
  configComplete: boolean;
}

interface ProviderOption {
  id: string;
  label: string;
  defaultModel: string;
  apiKeyEnv: string;
  apiKeyRequired: boolean;
  note?: string;
  signupUrl?: string;
  docsUrl?: string;
}

const DISMISSED_KEY = 'fft.onboarding.dismissed';
const LAST_SEEN_KEY = 'fft.onboarding.lastSeenComplete';
const PROVIDER_KEY = 'fft.onboarding.draft.provider';
const MODEL_KEY = 'fft.onboarding.draft.model';

function readBool(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Ignore.
  }
}

function readString(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

function writeString(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore.
  }
}

function authHeaders(token: string): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

interface OnboardingGateProps {
  token: string;
  children: JSX.Element;
}

export function OnboardingGate({ token, children }: OnboardingGateProps): JSX.Element {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [error, setError] = useState('');
  const [loadTried, setLoadTried] = useState(false);

  const [provider, setProvider] = useState<string>(() =>
    readString(PROVIDER_KEY, ''),
  );
  const [model, setModel] = useState<string>(() => readString(MODEL_KEY, ''));
  const [apiKey, setApiKey] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [whatsapp, setWhatsapp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const [adminSecret, setAdminSecret] = useState('');

  const [dismissed, setDismissed] = useState<boolean>(() => readBool(DISMISSED_KEY));
  const [showModal, setShowModal] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = authHeaders(token);
        const statusRes = await fetch('/api/onboarding/status', { headers });
        if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
        const statusJson = (await statusRes.json()) as { ok: boolean; onboarding: OnboardingStatus };
        const providerRes = await fetch('/api/settings/providers', { headers });
        if (!providerRes.ok) throw new Error(`providers HTTP ${providerRes.status}`);
        const providerJson = (await providerRes.json()) as {
          ok: boolean;
          providers: ProviderOption[];
        };
        if (cancelled) return;
        setStatus(statusJson.onboarding);
        setProviders(providerJson.providers || []);
        if (!provider && statusJson.onboarding.providerPreset) {
          setProvider(statusJson.onboarding.providerPreset);
        }
        if (!model && statusJson.onboarding.model) {
          setModel(statusJson.onboarding.model);
        }
        setWhatsapp(statusJson.onboarding.whatsappEnabled);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadTried(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!status) return;
    if (status.configComplete) {
      setShowModal(false);
      setShowBanner(false);
      writeBool(LAST_SEEN_KEY, true);
      writeBool(DISMISSED_KEY, false);
      return;
    }
    if (!status.active) {
      setShowModal(false);
      setShowBanner(false);
      return;
    }
    if (dismissed) {
      setShowModal(false);
      setShowBanner(true);
    } else {
      setShowModal(true);
      setShowBanner(false);
    }
  }, [status, dismissed]);

  const dismiss = () => {
    writeBool(DISMISSED_KEY, true);
    setDismissed(true);
    setShowModal(false);
    setShowBanner(true);
  };

  const resume = () => {
    writeBool(DISMISSED_KEY, false);
    setDismissed(false);
    setShowModal(true);
    setShowBanner(false);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitStatus('Saving...');
    setError('');
    try {
      const payload: Record<string, unknown> = {
        providerPreset: provider,
        model,
        whatsappEnabled: whatsapp,
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (telegramToken.trim()) payload.telegramBotToken = telegramToken.trim();
      const res = await fetch('/api/onboarding/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        ok: boolean;
        requiresRestart?: boolean;
        adminSecret?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setSubmitStatus('Saved.');
      setAdminSecret(json.adminSecret || '');
      const next: OnboardingStatus = {
        active: false,
        providerPreset: provider,
        model,
        apiKeyConfigured: json.ok ? true : false,
        telegramBotConfigured: telegramToken.trim().length > 0
          ? true
          : status?.telegramBotConfigured || false,
        telegramAdminSecretConfigured:
          status?.telegramAdminSecretConfigured || !!json.adminSecret,
        whatsappEnabled: whatsapp,
        configComplete: true,
      };
      setStatus(next);
      writeString(PROVIDER_KEY, provider);
      writeString(MODEL_KEY, model);
      setApiKey('');
      setTelegramToken('');
      setShowModal(false);
      setShowBanner(false);
      writeBool(DISMISSED_KEY, false);
      writeBool(LAST_SEEN_KEY, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitStatus('Failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!loadTried && !status) {
    return (
      <>
        {children}
        {error ? (
          <div className="onboarding-banner onboarding-banner--error">
            <span>Onboarding status unavailable: {error}</span>
          </div>
        ) : null}
      </>
    );
  }

  const activeProvider = providers.find((p) => p.id === provider);
  const requiredKeys = activeProvider?.apiKeyRequired !== false;
  const requireTelegram = !whatsapp;
  const ready = provider && model && (!requiredKeys || apiKey.trim() || status?.apiKeyConfigured)
    && (!requireTelegram || telegramToken.trim() || status?.telegramBotConfigured);

  return (
    <>
      {showBanner && status && !status.configComplete ? (
        <div className="onboarding-banner" role="status">
          <div className="onboarding-banner__text">
            <strong>Onboarding incomplete.</strong>{' '}
            {status.apiKeyConfigured
              ? 'Provider key is set, but '
              : 'Provider key is missing, '}
            {status.telegramBotConfigured
              ? 'Telegram bot is set. '
              : 'Telegram bot is missing. '}
            Finish setup so the host can start runs.
          </div>
          <div className="onboarding-banner__actions">
            <button type="button" onClick={resume}>
              Resume setup
            </button>
            <button
              type="button"
              onClick={() => void refreshStatus(token, setStatus, setProviders, setError)}
            >
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      {showModal && status && !status.configComplete ? (
        <div className="onboarding-modal" role="dialog" aria-modal="true" aria-label="Onboarding">
          <div className="onboarding-modal__panel">
            <div className="onboarding-modal__head">
              <div>
                <h2>First-run onboarding</h2>
                <p>
                  Configure the LLM provider, the bot token, and how you want
                  the host to talk to you. You can change all of this later
                  from the Setup tab.
                </p>
              </div>
              <button
                type="button"
                className="onboarding-modal__dismiss"
                onClick={dismiss}
                title="Dismiss for this session (banner stays at the top until complete)"
              >
                Later
              </button>
            </div>

            <div className="onboarding-modal__grid">
              <label className="field">
                <span>Provider</span>
                <select
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value);
                    const next = providers.find((p) => p.id === event.target.value);
                    if (next && !model) setModel(next.defaultModel);
                  }}
                >
                  <option value="">— select —</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Model</span>
                <input
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={activeProvider?.defaultModel || 'model id'}
                />
              </label>
              <label className="field">
                <span>
                  API Key ({activeProvider?.apiKeyEnv || 'PI_API_KEY'}){' '}
                  {status.apiKeyConfigured ? '· already set' : '· required'}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    status.apiKeyConfigured
                      ? 'leave blank to keep current key'
                      : 'paste API key'
                  }
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>
                  Telegram Bot Token{' '}
                  {status.telegramBotConfigured ? '· already set' : '· required unless WhatsApp'}
                </span>
                <input
                  type="password"
                  value={telegramToken}
                  onChange={(event) => setTelegramToken(event.target.value)}
                  placeholder={
                    status.telegramBotConfigured
                      ? 'leave blank to keep current token'
                      : 'paste token from @BotFather'
                  }
                  autoComplete="off"
                />
              </label>
              <label className="field onboarding-modal__checkbox">
                <input
                  type="checkbox"
                  checked={whatsapp}
                  onChange={(event) => setWhatsapp(event.target.checked)}
                />
                <span>Also enable WhatsApp channel (requires separate scan)</span>
              </label>
            </div>

            {activeProvider?.signupUrl || activeProvider?.docsUrl ? (
              <div className="onboarding-modal__links">
                {activeProvider.signupUrl ? (
                  <a href={activeProvider.signupUrl} target="_blank" rel="noreferrer noopener">
                    Get an API key
                  </a>
                ) : null}
                {activeProvider.docsUrl ? (
                  <a href={activeProvider.docsUrl} target="_blank" rel="noreferrer noopener">
                    Provider docs
                  </a>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="onboarding-modal__error">{error}</p> : null}
            {adminSecret ? (
              <p className="onboarding-modal__secret">
                <strong>Admin secret:</strong> <code>{adminSecret}</code>
                <br />
                In Telegram DM, send <code>/main {adminSecret}</code> to claim main.
              </p>
            ) : null}
            <div className="onboarding-modal__actions">
              <button type="button" onClick={dismiss}>
                Later
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!ready || submitting}
              >
                {submitting ? 'Saving...' : 'Save and finish'}
              </button>
            </div>
            {submitStatus ? (
              <p className="onboarding-modal__status">{submitStatus}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {children}
    </>
  );
}

async function refreshStatus(
  token: string,
  setStatus: (next: OnboardingStatus) => void,
  setProviders: (next: ProviderOption[]) => void,
  setError: (next: string) => void,
): Promise<void> {
  try {
    const headers = authHeaders(token);
    const statusRes = await fetch('/api/onboarding/status', { headers });
    if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
    const statusJson = (await statusRes.json()) as { ok: boolean; onboarding: OnboardingStatus };
    const providerRes = await fetch('/api/settings/providers', { headers });
    const providerJson = (await providerRes.json()) as { ok: boolean; providers: ProviderOption[] };
    setStatus(statusJson.onboarding);
    setProviders(providerJson.providers || []);
    setError('');
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
