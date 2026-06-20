import { useState, useEffect, useCallback } from 'react';

interface Settings {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  startOnBoot: boolean;
  minimizeToTray: boolean;
}

function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>({
    theme: 'system',
    notifications: true,
    startOnBoot: false,
    minimizeToTray: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (window.fftDesktop) {
        try {
          const savedSettings = await window.fftDesktop.getSettings();
          setSettings({
            theme: (savedSettings.theme as Settings['theme']) || 'system',
            notifications: savedSettings.notifications !== false,
            startOnBoot: savedSettings.startOnBoot === true,
            minimizeToTray: savedSettings.minimizeToTray !== false,
          });
        } catch (err) {
          console.error('Failed to load settings:', err);
        }
      }
    };
    loadSettings();
  }, []);

  const handleChange = useCallback((key: keyof Settings, value: Settings[keyof Settings]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!window.fftDesktop) return;
    
    setIsSaving(true);
    try {
      await window.fftDesktop.setSettings(settings as unknown as Record<string, unknown>);
      setHasChanges(false);
      
      // Apply theme change immediately
      if (settings.theme !== 'system') {
        document.documentElement.setAttribute('data-theme', settings.theme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  return (
    <div className="settings-panel">
      <h2 className="settings-title">Settings</h2>

      <div className="settings-section">
        <h3 className="settings-section-title">Appearance</h3>
        
        <div className="settings-item">
          <span className="settings-label">Theme</span>
          <select
            className="settings-select"
            value={settings.theme}
            onChange={(e) => handleChange('theme', e.target.value as Settings['theme'])}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Behavior</h3>
        
        <div className="settings-item">
          <span className="settings-label">Show notifications</span>
          <button
            className={`settings-toggle ${settings.notifications ? 'active' : ''}`}
            onClick={() => handleChange('notifications', !settings.notifications)}
            aria-pressed={settings.notifications}
          />
        </div>
        
        <div className="settings-item">
          <span className="settings-label">Start on system boot</span>
          <button
            className={`settings-toggle ${settings.startOnBoot ? 'active' : ''}`}
            onClick={() => handleChange('startOnBoot', !settings.startOnBoot)}
            aria-pressed={settings.startOnBoot}
          />
        </div>
        
        <div className="settings-item">
          <span className="settings-label">Minimize to tray on close</span>
          <button
            className={`settings-toggle ${settings.minimizeToTray ? 'active' : ''}`}
            onClick={() => handleChange('minimizeToTray', !settings.minimizeToTray)}
            aria-pressed={settings.minimizeToTray}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">About</h3>
        <div className="settings-item">
          <span className="settings-label">Version</span>
          <span className="settings-value">0.1.0</span>
        </div>
      </div>

      <button
        className="settings-save-btn"
        onClick={handleSave}
        disabled={!hasChanges || isSaving}
      >
        {isSaving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}

export default SettingsPanel;
