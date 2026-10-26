import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import packageJson from "../../../package.json";

export class UnsupportedInWebError extends Error {
  readonly code = "UNSUPPORTED_IN_WEB";

  constructor(capability: string) {
    super(`${capability} is not available in the web runtime`);
    this.name = "UnsupportedInWebError";
  }
}

export interface WebSession {
  id: string;
  send(channel: string, payload: unknown): void;
  close?(): void;
}

interface InvokeContext {
  session: WebSession;
  signal?: AbortSignal;
}

const invokeContext = new AsyncLocalStorage<InvokeContext>();
let activeSession: WebSession | null = null;

export function setActiveSession(session: WebSession | null): void {
  activeSession = session;
}

function currentSession(): WebSession | null {
  return invokeContext.getStore()?.session ?? activeSession;
}

function sendToCurrentSession(channel: string, payload: unknown): void {
  currentSession()?.send(channel, payload);
}

type InvokeListener = (event: WebIpcEvent, ...args: unknown[]) => unknown;
type EventListener = (event: WebIpcEvent, ...args: unknown[]) => void;

export interface WebIpcEvent {
  sender: WebWebContents;
  senderFrame: { url: string };
  preventDefault(): void;
  signal?: AbortSignal;
  returnValue?: unknown;
}

export class WebWebContents {
  readonly id: number;
  private destroyed = false;
  private readonly session: WebSession | null;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(session: WebSession | null = currentSession()) {
    this.id = nextWebContentsId++;
    this.session = session;
  }

  send(channel: string, payload: unknown): void {
    if (!this.destroyed) this.session?.send(channel, payload);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getURL(): string {
    return "https://seltra.local/";
  }

  getType(): string {
    return "window";
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const listener of this.listeners.get("destroyed") ?? []) listener();
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    const wrapped = (...args: unknown[]) => {
      listeners.delete(wrapped);
      listener(...args);
    };
    listeners.add(wrapped);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(
    event: string,
    listener: (...args: unknown[]) => void,
  ): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
}

let nextWebContentsId = 1;
const sessionContents = new WeakMap<WebSession, WebWebContents>();
function contentsForSession(session: WebSession | null): WebWebContents {
  if (!session) return new WebWebContents(null);
  let contents = sessionContents.get(session);
  if (!contents) {
    contents = new WebWebContents(session);
    sessionContents.set(session, contents);
  }
  return contents;
}

const invokeHandlers = new Map<string, InvokeListener>();
const eventListeners = new Map<string, Set<EventListener>>();

export const ipcMain = {
  handle(channel: string, listener: InvokeListener): void {
    if (invokeHandlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`);
    }
    invokeHandlers.set(channel, listener);
  },
  handleOnce(channel: string, listener: InvokeListener): void {
    const wrapped: InvokeListener = async (event, ...args) => {
      invokeHandlers.delete(channel);
      return listener(event, ...args);
    };
    this.handle(channel, wrapped);
  },
  on(channel: string, listener: EventListener): void {
    const listeners = eventListeners.get(channel) ?? new Set<EventListener>();
    listeners.add(listener);
    eventListeners.set(channel, listeners);
  },
  once(channel: string, listener: EventListener): void {
    const wrapped: EventListener = (event, ...args) => {
      this.removeListener(channel, wrapped);
      listener(event, ...args);
    };
    this.on(channel, wrapped);
  },
  removeHandler(channel: string): void {
    invokeHandlers.delete(channel);
  },
  removeListener(channel: string, listener: EventListener): void {
    eventListeners.get(channel)?.delete(listener);
  },
  removeAllListeners(channel?: string): void {
    if (channel === undefined) eventListeners.clear();
    else eventListeners.delete(channel);
  },
  async invoke(
    channel: string,
    args: unknown[] = [],
    context: InvokeContext,
  ): Promise<unknown> {
    const handler = invokeHandlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    return invokeContext.run(context, () =>
      handler(createIpcEvent(context.session, context.signal), ...args),
    );
  },
  send(channel: string, ...args: unknown[]): void {
    const event = createIpcEvent(currentSession());
    for (const listener of eventListeners.get(channel) ?? []) {
      listener(event, ...args);
    }
  },
  sendForSession(channel: string, args: unknown[], session: WebSession): void {
    invokeContext.run({ session }, () => {
      const event = createIpcEvent(session);
      for (const listener of eventListeners.get(channel) ?? []) {
        listener(event, ...args);
      }
    });
  },
  registeredInvokeChannels(): string[] {
    return [...invokeHandlers.keys()];
  },
};

function createIpcEvent(
  session: WebSession | null,
  signal?: AbortSignal,
): WebIpcEvent {
  const frame = {
    url: "file:///seltra/index.html",
    parent: null,
    processId: 1,
    routingId: 1,
  };
  const sender = contentsForSession(session) as WebWebContents & {
    mainFrame: typeof frame;
  };
  sender.mainFrame = frame;
  return {
    sender,
    senderFrame: frame,
    preventDefault() {},
    signal,
  };
}

export class BrowserWindow {
  readonly webContents: WebWebContents;
  private destroyed = false;

  constructor(_options: Record<string, unknown> = {}) {
    this.webContents = contentsForSession(currentSession());
  }

  static getAllWindows(): BrowserWindow[] {
    return currentSession() ? [getSessionWindow()] : [];
  }

  static getFocusedWindow(): BrowserWindow | null {
    return currentSession() ? getSessionWindow() : null;
  }

  static fromWebContents(contents: WebWebContents): BrowserWindow | null {
    return contents.isDestroyed() ? null : getSessionWindow();
  }

  static fromId(_id: number): BrowserWindow | null {
    return currentSession() ? getSessionWindow() : null;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFocused(): boolean {
    return currentSession() !== null;
  }

  isMinimized(): boolean {
    return false;
  }

  isVisible(): boolean {
    return currentSession() !== null;
  }

  show(): void {}
  focus(): void {}
  hide(): void {}
  minimize(): void {}
  restore(): void {}
  close(): void {
    this.destroyed = true;
  }
  destroy(): void {
    this.destroyed = true;
    this.webContents.close();
  }
  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }
  once(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }
  setTitle(_title: string): void {}
  setBackgroundColor(_color: string): void {}
  setSize(_width: number, _height: number): void {}
  setPosition(_x: number, _y: number): void {}
  setProgressBar(_progress: number): void {}
  setMenu(_menu: unknown): void {}
  setMenuBarVisibility(_visible: boolean): void {}
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 1280, height: 800 };
  }
  getNativeWindowHandle(): Buffer {
    return Buffer.alloc(0);
  }
}

const sessionWindows = new WeakMap<WebSession, BrowserWindow>();
function getSessionWindow(): BrowserWindow {
  const session = currentSession();
  if (!session) return new BrowserWindow();
  let window = sessionWindows.get(session);
  if (!window) {
    window = new BrowserWindow();
    sessionWindows.set(session, window);
  }
  return window;
}

export function closeWebSession(session: WebSession): void {
  sessionContents.get(session)?.close();
  sessionWindows.get(session)?.destroy();
}

const userDataPath = () =>
  path.resolve(process.env.DYAD_USER_DATA?.trim() || "./userData");

export const app = {
  isPackaged: false,
  name: "Seltra",
  getPath(name: string): string {
    if (name === "userData" || name === "crashDumps") return userDataPath();
    if (name === "temp") {
      return (
        process.env.DYAD_TMP_DIR ||
        process.env.TMPDIR ||
        process.env.TEMP ||
        os.tmpdir()
      );
    }
    if (name === "home") {
      const appsDir = process.env.DYAD_APPS_DIR?.trim();
      return appsDir ? path.dirname(path.resolve(appsDir)) : os.homedir();
    }
    if (name === "sessionData" || name === "appData") {
      return path.join(userDataPath(), name);
    }
    return userDataPath();
  },
  getAppPath(): string {
    return process.cwd();
  },
  getVersion(): string {
    return packageJson.version;
  },
  getName(): string {
    return "Seltra";
  },
  isReady(): boolean {
    return true;
  },
  whenReady(): Promise<void> {
    return Promise.resolve();
  },
  on(_event: string, _listener: (...args: unknown[]) => void): void {},
  once(_event: string, _listener: (...args: unknown[]) => void): void {},
  removeListener(_event: string, _listener: (...args: unknown[]) => void): void {},
  quit(): void {},
  relaunch(): void {},
  setPath(_name: string, _value: string): void {},
  getAppMetrics(): unknown[] {
    return [];
  },
};

export class UnsupportedDialog {
  showOpenDialog(): Promise<never> {
    return Promise.reject(new UnsupportedInWebError("File picker"));
  }
  showSaveDialog(): Promise<never> {
    return Promise.reject(new UnsupportedInWebError("Save dialog"));
  }
  showMessageBox(): Promise<never> {
    return Promise.reject(new UnsupportedInWebError("Native dialog"));
  }
  showErrorBox(): never {
    throw new UnsupportedInWebError("Native error dialog");
  }
  showCertificateTrustDialog(): Promise<never> {
    return Promise.reject(new UnsupportedInWebError("Certificate dialog"));
  }
}

export const dialog = new UnsupportedDialog();

export const shell = {
  openExternal(url: string): Promise<void> {
    sendToCurrentSession("web:open-external", { url });
    return Promise.resolve();
  },
  openPath(_path: string): Promise<string> {
    return Promise.reject(new UnsupportedInWebError("Open local path"));
  },
  showItemInFolder(_path: string): void {
    throw new UnsupportedInWebError("Show in file explorer");
  },
};

function getSecretsKey(): Buffer {
  const value = process.env.RUNTIME_SECRETS_KEY?.trim();
  if (!value) throw new Error("RUNTIME_SECRETS_KEY must be configured");
  const decoded = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("RUNTIME_SECRETS_KEY must encode exactly 32 bytes");
  }
  return decoded;
}

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return true;
  },
  encryptString(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getSecretsKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([Buffer.from("SLS1"), iv, cipher.getAuthTag(), ciphertext]);
  },
  decryptString(value: Buffer): string {
    if (value.subarray(0, 4).toString() !== "SLS1") {
      throw new Error("Unsupported encrypted secret format");
    }
    const iv = value.subarray(4, 16);
    const tag = value.subarray(16, 32);
    const decipher = createDecipheriv("aes-256-gcm", getSecretsKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(value.subarray(32)),
      decipher.final(),
    ]).toString("utf8");
  },
  getSelectedStorageBackend(): string {
    return "unknown";
  },
};

export class Notification {
  static isSupported(): boolean {
    return false;
  }
  constructor(_options: Record<string, unknown> = {}) {}
  show(): void {}
  close(): void {}
  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }
}

export const clipboard = {
  readText(): never {
    throw new UnsupportedInWebError("Clipboard access");
  },
  writeText(_text: string): never {
    throw new UnsupportedInWebError("Clipboard access");
  },
};

export const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: "system",
  on(_event: string, _listener: (...args: unknown[]) => void): void {},
};

export const autoUpdater = {
  checkForUpdates(): void {},
  quitAndInstall(): void {},
  on(_event: string, _listener: (...args: unknown[]) => void): void {},
};

export const powerMonitor = {
  on(_event: string, _listener: (...args: unknown[]) => void): void {},
};

export const screen = {
  getPrimaryDisplay() {
    return { bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1 };
  },
  getAllDisplays() {
    return [this.getPrimaryDisplay()];
  },
  on(_event: string, _listener: (...args: unknown[]) => void): void {},
};

export const protocol = {
  registerSchemesAsPrivileged(): void {},
  handle(): void {},
  registerFileProtocol(): void {},
};

const defaultWebSession = {
  clearStorageData: async () => undefined,
  clearCache: async () => undefined,
  webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
};

export const session = {
  defaultSession: defaultWebSession,
  fromPartition(): typeof defaultWebSession {
    return defaultWebSession;
  },
};

export const net = {
  fetch: globalThis.fetch.bind(globalThis),
};

export class Menu {
  static buildFromTemplate(template: unknown): unknown {
    return template;
  }
  static setApplicationMenu(_menu: unknown): void {}
}

export const nativeImage = {
  createFromPath(): { isEmpty: () => boolean } {
    return { isEmpty: () => true };
  },
};

export const crashReporter = {
  start(): void {},
  getLastCrashReport(): null {
    return null;
  },
};

export const utilityProcess = {
  fork(): never {
    throw new UnsupportedInWebError("Electron utility process");
  },
};

export class WebContentsView {
  readonly webContents = new WebWebContents();
  setBounds(_bounds: unknown): void {}
  setVisible(_visible: boolean): void {}
  setBackgroundColor(_color: string): void {}
}

export class Event {}

export function resetForTesting(): void {
  invokeHandlers.clear();
  eventListeners.clear();
  activeSession = null;
}
