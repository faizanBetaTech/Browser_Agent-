import type { RealBrowserState, FocusedElementInfo } from './chromiumManager.ts';

export interface ExtensionClientInfo {
  browserName: string;
  browserVersion: string;
  os: string;
  activeTabTitle?: string;
  activeTabUrl?: string;
  connectedAt: string;
  lastSeenAt: string;
}

export interface ExtensionCommand {
  id: string;
  action: string;
  params: Record<string, any>;
  createdAt: number;
}

interface PendingCommand {
  command: ExtensionCommand;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeoutTimer: NodeJS.Timeout;
}

export class ExtensionManager {
  private clientInfo: ExtensionClientInfo | null = null;
  private lastPing: number = 0;
  private commandQueue: ExtensionCommand[] = [];
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private pollWaiters: Array<(cmd: ExtensionCommand | null) => void> = [];
  private activeTarget: 'cloud' | 'extension' = 'cloud';
  private latestState: RealBrowserState | null = null;

  public isConnected(): boolean {
    if (!this.clientInfo) return false;
    // Consider disconnected if no ping or poll within last 90 seconds
    return Date.now() - this.lastPing < 90000;
  }

  public getClientInfo(): ExtensionClientInfo | null {
    if (!this.isConnected()) return null;
    return this.clientInfo;
  }

  public getActiveTarget(): 'cloud' | 'extension' {
    if (!this.isConnected()) {
      return 'cloud';
    }
    return this.activeTarget;
  }

  public setActiveTarget(target: 'cloud' | 'extension'): void {
    this.activeTarget = target;
  }

  public registerClient(info: Partial<ExtensionClientInfo>): void {
    const wasConnected = this.isConnected();
    this.lastPing = Date.now();
    this.clientInfo = {
      browserName: info.browserName || 'Firefox',
      browserVersion: info.browserVersion || 'Desktop',
      os: info.os || 'antiX Linux',
      activeTabTitle: info.activeTabTitle || 'Firefox Active Tab',
      activeTabUrl: info.activeTabUrl || '',
      connectedAt: this.clientInfo?.connectedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    if (!wasConnected) {
      this.activeTarget = 'extension';
      console.log('[ExtensionManager] Firefox extension client registered. Active target set to extension.');
    }
  }

  public updateHeartbeat(activeTabTitle?: string, activeTabUrl?: string): void {
    this.lastPing = Date.now();
    if (this.clientInfo) {
      this.clientInfo.lastSeenAt = new Date().toISOString();
      if (activeTabTitle) this.clientInfo.activeTabTitle = activeTabTitle;
      if (activeTabUrl) this.clientInfo.activeTabUrl = activeTabUrl;
    }
  }

  /**
   * Called by the Firefox extension background script via long-poll to fetch the next queued command.
   */
  public async pollNextCommand(timeoutMs: number = 25000): Promise<ExtensionCommand | null> {
    this.lastPing = Date.now();

    // Check if there is an existing command in the queue
    if (this.commandQueue.length > 0) {
      return this.commandQueue.shift()!;
    }

    // Wait for a command to be queued or timeout
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.pollWaiters.indexOf(resolver);
        if (idx !== -1) {
          this.pollWaiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);

      const resolver = (cmd: ExtensionCommand | null) => {
        clearTimeout(timer);
        resolve(cmd);
      };

      this.pollWaiters.push(resolver);
    });
  }

  /**
   * Called by the Firefox extension to respond to a previously dispatched command.
   */
  public handleCommandResponse(commandId: string, result: any, error?: string): boolean {
    this.lastPing = Date.now();
    const pending = this.pendingCommands.get(commandId);
    if (!pending) {
      console.warn(`[ExtensionManager] Received response for unknown or timed out command: ${commandId}`);
      return false;
    }

    clearTimeout(pending.timeoutTimer);
    this.pendingCommands.delete(commandId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      if (result && result.url && result.screenshotBase64) {
        this.latestState = result as RealBrowserState;
        if (this.clientInfo) {
          this.clientInfo.activeTabTitle = result.title;
          this.clientInfo.activeTabUrl = result.url;
        }
      }
      pending.resolve(result);
    }
    return true;
  }

  /**
   * Dispatches a command to the Firefox extension and waits for response.
   */
  public dispatchCommand<T = any>(action: string, params: Record<string, any> = {}, timeoutMs: number = 30000): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('Firefox extension is not connected. Please load the extension in Firefox and click Connect.');
    }

    const id = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const command: ExtensionCommand = {
      id,
      action,
      params,
      createdAt: Date.now(),
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Extension command timed out after ${timeoutMs}ms (${action})`));
      }, timeoutMs);

      this.pendingCommands.set(id, {
        command,
        resolve,
        reject,
        timeoutTimer,
      });

      // If there is an active poll waiter, give it immediately
      if (this.pollWaiters.length > 0) {
        const waiter = this.pollWaiters.shift()!;
        waiter(command);
      } else {
        this.commandQueue.push(command);
      }
    });
  }

  // --- Browser Control Methods (Mirrors ChromiumManager Interface) ---

  public async getState(): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<RealBrowserState>('getState', {}, 20000);
    this.latestState = res;
    return res;
  }

  public async navigate(url: string): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<RealBrowserState>('navigate', { url }, 30000);
    this.latestState = res;
    return res;
  }

  public async click(target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('click', { target }, 25000);
    if (res.state) this.latestState = res.state;
    return res;
  }

  public async rightClick(target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('right_click', { target }, 25000);
    if (res.state) this.latestState = res.state;
    return res;
  }

  public async hover(target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('hover', { target }, 20000);
    if (res.state) this.latestState = res.state;
    return res;
  }

  public async type(target: string, value: string, submit: boolean = false): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('type', { target, value, submit }, 25000);
    if (res.state) this.latestState = res.state;
    return res;
  }

  public async pressKey(key: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('press_key', { key }, 20000);
    if (res.state) this.latestState = res.state;
    return res;
  }

  public async scroll(direction: 'up' | 'down' = 'down', amount: number = 400): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<RealBrowserState>('scroll', { direction, amount }, 20000);
    this.latestState = res;
    return res;
  }

  public async dragAndDrop(source: string, target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('drag_and_drop', { source, target }, 25000);
    if (res.state) this.latestState = res.state;
    return res;
  }

  public async openTab(url?: string): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<RealBrowserState>('open_tab', { url: url || 'https://www.google.com' }, 25000);
    this.latestState = res;
    return res;
  }

  public async switchTab(tabId: string): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<RealBrowserState>('switch_tab', { tab_id: tabId }, 20000);
    this.latestState = res;
    return res;
  }

  public async closeTab(tabId: string): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<RealBrowserState>('close_tab', { tab_id: tabId }, 20000);
    this.latestState = res;
    return res;
  }

  public async mouseClickCoordinates(x: number, y: number): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('mouse_click', { x, y }, 20000);
    if (res && res.state) this.latestState = res.state;
    return this.latestState || (await this.getState());
  }

  public async keyboardType(text: string): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('keyboard_type', { text }, 20000);
    if (res && res.state) this.latestState = res.state;
    return this.latestState || (await this.getState());
  }

  public async keyboardPress(key: string): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('keyboard_press', { key }, 20000);
    if (res && res.state) this.latestState = res.state;
    return this.latestState || (await this.getState());
  }

  public async clearFocusedInput(): Promise<RealBrowserState> {
    const res = await this.dispatchCommand<{ success: boolean; message: string; state: RealBrowserState }>('clear_input', {}, 20000);
    if (res && res.state) this.latestState = res.state;
    return this.latestState || (await this.getState());
  }
}

export const extensionManager = new ExtensionManager();
