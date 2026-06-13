import { useEffect, useState, useCallback } from 'react';
import ChatPane from './components/ChatPane';
import SettingsPanel from './components/SettingsPanel';
import StatusBar from './components/StatusBar';

// Declare the fftDesktop API type
declare global {
  interface Window {
    fftDesktop: {
      getHostStatus: () => Promise<{ running: boolean; port: number | null }>;
      startHost: () => Promise<{ success: boolean; port?: number }>;
      stopHost: () => Promise<{ success: boolean }>;
      restartHost: () => Promise<{ success: boolean; port?: number }>;
      getSettings: () => Promise<Record<string, unknown>>;
      setSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
      openExternal: (url: string) => Promise<{ success: boolean }>;
      showNotification: (title: string, body: string) => Promise<{ success: boolean }>;
      minimizeToTray: () => Promise<{ success: boolean }>;
      getTheme: () => Promise<'light' | 'dark'>;
      checkForUpdates: () => Promise<{ success: boolean; updateAvailable?: boolean; error?: string }>;
      onHostStatus: (callback: (status: { running: boolean; port: number | null }) => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      onUpdateAvailable: (callback: (info: { version: string }) => void) => () => void;
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void;
    };
  }
}

type TabId = 'chat' | 'settings';

interface HostStatus {
  running: boolean;
  port: number | null;
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [hostStatus, setHostStatus] = useState<HostStatus>({ running: false, port: null });
  const [isConnecting, setIsConnecting] = useState(false);
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  // Check initial host status
  useEffect(() => {
    const checkStatus = async () => {
      if (window.fftDesktop) {
        try {
          const status = await window.fftDesktop.getHostStatus();
          setHostStatus(status);
          if (status.running && status.port) {
            setWsUrl(`ws://127.0.0.1:${status.port}/api/ws`);
          }
        } catch (err) {
          console.error('Failed to get host status:', err);
        }
      }
    };

    checkStatus();

    // Poll for status updates
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for host status changes from main process
  useEffect(() => {
    if (window.fftDesktop) {
      const unsubscribe = window.fftDesktop.onHostStatus((status) => {
        setHostStatus(status);
        if (status.running && status.port) {
          setWsUrl(`ws://127.0.0.1:${status.port}/api/ws`);
        } else {
          setWsUrl(null);
        }
      });
      return unsubscribe;
    }
  }, []);

  // Listen for settings panel open request
  useEffect(() => {
    if (window.fftDesktop) {
      const unsubscribe = window.fftDesktop.onOpenSettings(() => {
        setActiveTab('settings');
      });
      return unsubscribe;
    }
  }, []);

  const handleStartHost = useCallback(async () => {
    setIsConnecting(true);
    try {
      if (window.fftDesktop) {
        const result = await window.fftDesktop.startHost();
        if (result.success && result.port) {
          setWsUrl(`ws://127.0.0.1:${result.port}/api/ws`);
        }
      }
    } catch (err) {
      console.error('Failed to start host:', err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleStopHost = useCallback(async () => {
    try {
      if (window.fftDesktop) {
        await window.fftDesktop.stopHost();
        setWsUrl(null);
      }
    } catch (err) {
      console.error('Failed to stop host:', err);
    }
  }, []);

  const handleRestartHost = useCallback(async () => {
    setIsConnecting(true);
    try {
      if (window.fftDesktop) {
        const result = await window.fftDesktop.restartHost();
        if (result.success && result.port) {
          setWsUrl(`ws://127.0.0.1:${result.port}/api/ws`);
        }
      }
    } catch (err) {
      console.error('Failed to restart host:', err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleMinimizeToTray = useCallback(async () => {
    if (window.fftDesktop) {
      await window.fftDesktop.minimizeToTray();
    }
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1 className="header-title">FFT_nano</h1>
        <div className="header-actions">
          {hostStatus.running ? (
            <>
              <button className="button button-secondary" onClick={handleRestartHost}>
                Restart
              </button>
              <button className="button button-secondary" onClick={handleStopHost}>
                Stop
              </button>
            </>
          ) : (
            <button 
              className="button button-primary" 
              onClick={handleStartHost}
              disabled={isConnecting}
            >
              {isConnecting ? 'Starting...' : 'Start'}
            </button>
          )}
          <button className="button button-secondary" onClick={handleMinimizeToTray}>
            Minimize
          </button>
        </div>
      </header>

      <div className="main-content">
        <div className="chat-pane">
          <ChatPane wsUrl={wsUrl} />
        </div>
        
        <div className="tab-bar">
          <button 
            className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button 
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>

        {activeTab === 'settings' && (
          <SettingsPanel />
        )}
      </div>

      <StatusBar 
        hostStatus={hostStatus} 
        isConnecting={isConnecting} 
      />
    </div>
  );
}

export default App;
