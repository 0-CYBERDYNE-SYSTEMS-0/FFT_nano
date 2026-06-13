interface HostStatus {
  running: boolean;
  port: number | null;
}

interface StatusBarProps {
  hostStatus: HostStatus;
  isConnecting: boolean;
}

function StatusBar({ hostStatus, isConnecting }: StatusBarProps) {
  const getStatusText = () => {
    if (isConnecting) return 'Connecting...';
    if (hostStatus.running) return `Connected on port ${hostStatus.port || 28989}`;
    return 'Disconnected';
  };

  const getStatusClass = () => {
    if (isConnecting) return 'connecting';
    if (hostStatus.running) return 'connected';
    return 'disconnected';
  };

  return (
    <div className="status-bar">
      <div className="status-indicator">
        <span className={`status-dot ${getStatusClass()}`}></span>
        <span>{getStatusText()}</span>
      </div>
      <div className="status-version">
        FFT_nano v0.1.0
      </div>
    </div>
  );
}

export default StatusBar;
