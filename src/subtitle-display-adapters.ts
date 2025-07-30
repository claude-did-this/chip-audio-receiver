import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { SubtitleData } from './types';
import { logger } from './logger';

interface DisplayEvent {
  sessionId: string;
  subtitle: SubtitleData;
  timestamp: number;
}

export abstract class SubtitleDisplayAdapter extends EventEmitter {
  protected isConnected: boolean = false;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract displaySubtitle(event: DisplayEvent): Promise<void>;
  abstract hideSubtitle(event: DisplayEvent): Promise<void>;
  abstract isAvailable(): boolean;
}

export class OBSWebSocketAdapter extends SubtitleDisplayAdapter {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly password?: string;
  private readonly textSourceName: string;

  constructor(config: {
    host: string;
    port: number;
    password?: string;
    textSourceName?: string;
  }) {
    super();
    this.host = config.host;
    this.port = config.port;
    this.password = config.password;
    this.textSourceName = config.textSourceName || 'SubtitleText';
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://${this.host}:${this.port}`;
      
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', async () => {
          logger.info('Connected to OBS WebSocket');
          this.isConnected = true;
          
          // Authenticate if password is provided
          if (this.password) {
            await this.authenticate();
          }
          
          resolve();
        });

        this.ws.on('error', (error) => {
          logger.error('OBS WebSocket error', error);
          this.isConnected = false;
          reject(error);
        });

        this.ws.on('close', () => {
          logger.info('OBS WebSocket disconnected');
          this.isConnected = false;
          this.scheduleReconnect();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private async authenticate(): Promise<void> {
    // OBS WebSocket 5.x authentication
    // This is a simplified version - real implementation would need proper auth flow
    if (!this.ws) return;

    const authRequest = {
      op: 1, // Identify
      d: {
        rpcVersion: 1,
        authentication: this.password
      }
    };

    this.ws.send(JSON.stringify(authRequest));
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      logger.debug('OBS WebSocket message received', message);
    } catch (error) {
      logger.error('Failed to parse OBS message', { error, data });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect to OBS WebSocket');
      this.connect().catch(error => {
        logger.error('Reconnection failed', error);
      });
    }, 5000);
  }

  async displaySubtitle(_event: DisplayEvent): Promise<void> {
    if (!this.isConnected || !this.ws) {
      logger.warn('Cannot display subtitle - OBS not connected');
      return;
    }

    const request = {
      op: 6, // Request
      d: {
        requestType: 'SetInputSettings',
        requestId: `subtitle-${Date.now()}`,
        requestData: {
          inputName: this.textSourceName,
          inputSettings: {
            text: _event.subtitle.text
          }
        }
      }
    };

    this.ws.send(JSON.stringify(request));
    logger.debug('Sent subtitle to OBS', { text: _event.subtitle.text });
  }

  async hideSubtitle(_event: DisplayEvent): Promise<void> {
    if (!this.isConnected || !this.ws) return;

    const request = {
      op: 6, // Request
      d: {
        requestType: 'SetInputSettings',
        requestId: `subtitle-hide-${Date.now()}`,
        requestData: {
          inputName: this.textSourceName,
          inputSettings: {
            text: ''
          }
        }
      }
    };

    this.ws.send(JSON.stringify(request));
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  isAvailable(): boolean {
    return this.isConnected;
  }
}

export class OverlayWindowAdapter extends SubtitleDisplayAdapter {
  // This would use Electron or similar to create an overlay window
  // For now, this is a placeholder implementation

  async connect(): Promise<void> {
    logger.info('Overlay window adapter connected (placeholder)');
    this.isConnected = true;
  }

  async displaySubtitle(_event: DisplayEvent): Promise<void> {
    logger.info('Display subtitle in overlay', { text: _event.subtitle.text });
    // In real implementation, this would update an Electron window
  }

  async hideSubtitle(_event: DisplayEvent): Promise<void> {
    logger.info('Hide subtitle in overlay');
    // In real implementation, this would clear the Electron window
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  isAvailable(): boolean {
    return this.isConnected;
  }
}

export class ToastNotificationAdapter extends SubtitleDisplayAdapter {

  constructor() {
    super();
    // Windows toast notifications would be implemented here
  }

  async connect(): Promise<void> {
    try {
      // In real implementation, initialize Windows toast notifier
      logger.info('Toast notification adapter connected');
      this.isConnected = true;
    } catch (error) {
      logger.error('Failed to initialize toast notifications', error);
      throw error;
    }
  }

  async displaySubtitle(_event: DisplayEvent): Promise<void> {
    if (!this.isConnected) return;

    // In real implementation, show Windows toast
    logger.info('Display subtitle as toast', { text: _event.subtitle.text });
  }

  async hideSubtitle(_event: DisplayEvent): Promise<void> {
    // Toast notifications auto-hide, so this is usually a no-op
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  isAvailable(): boolean {
    return this.isConnected && process.platform === 'win32';
  }
}

export class SubtitleDisplayManager {
  private adapters: Map<string, SubtitleDisplayAdapter> = new Map();
  private activeAdapter: SubtitleDisplayAdapter | null = null;

  constructor(private config: any) {
    this.initializeAdapters();
  }

  private initializeAdapters(): void {
    // OBS WebSocket adapter
    if (this.config.obsWebsocket?.enabled) {
      const obsAdapter = new OBSWebSocketAdapter({
        host: this.config.obsWebsocket.host || 'localhost',
        port: this.config.obsWebsocket.port || 4455,
        password: this.config.obsWebsocket.password,
        textSourceName: this.config.obsWebsocket.textSourceName
      });
      this.adapters.set('obs-websocket', obsAdapter);
    }

    // Overlay window adapter
    if (this.config.overlay?.enabled) {
      const overlayAdapter = new OverlayWindowAdapter();
      this.adapters.set('overlay', overlayAdapter);
    }

    // Toast notification adapter
    if (this.config.toast?.enabled) {
      const toastAdapter = new ToastNotificationAdapter();
      this.adapters.set('toast', toastAdapter);
    }
  }

  async setDisplayMethod(method: string): Promise<void> {
    const adapter = this.adapters.get(method);
    if (!adapter) {
      throw new Error(`Unknown display method: ${method}`);
    }

    // Disconnect current adapter
    if (this.activeAdapter) {
      await this.activeAdapter.disconnect();
    }

    // Connect new adapter
    await adapter.connect();
    this.activeAdapter = adapter;

    logger.info('Subtitle display method changed', { method });
  }

  async displaySubtitle(_event: DisplayEvent): Promise<void> {
    if (!this.activeAdapter) {
      logger.warn('No active subtitle display adapter');
      return;
    }

    await this.activeAdapter.displaySubtitle(_event);
  }

  async hideSubtitle(_event: DisplayEvent): Promise<void> {
    if (!this.activeAdapter) return;
    await this.activeAdapter.hideSubtitle(_event);
  }

  async shutdown(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
    this.adapters.clear();
    this.activeAdapter = null;
  }
}