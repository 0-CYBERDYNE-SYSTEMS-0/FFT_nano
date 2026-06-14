// Type declarations for native modules
declare module 'node-windows' {
  interface ServiceOptions {
    name: string;
    description?: string;
    script: string;
  }

  interface Service {
    install(callback: (error: Error | null) => void): void;
    start(callback: (error: Error | null) => void): void;
    stop(callback: (error: Error | null) => void): void;
    delete(callback: (error: Error | null) => void): void;
  }

  class Service {
    constructor(options: ServiceOptions);
  }

  export = Service;
  export default Service;
}

declare module 'node-notifier' {
  interface NotificationOptions {
    title: string;
    message: string;
    icon?: string;
    sound?: boolean;
  }

  interface Notifier {
    notify(
      options: NotificationOptions,
      callback?: (err: Error | null, response: unknown) => void,
    ): void;
  }

  const notifier: Notifier;
  export = notifier;
  export default notifier;
}

declare module 'tree-kill' {
  function treeKill(
    pid: number,
    signal: string,
    callback: (err: Error | null) => void,
  ): void;
  export default treeKill;
}
