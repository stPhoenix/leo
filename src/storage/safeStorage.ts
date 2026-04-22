import type { Logger } from '@/platform/Logger';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface SecretsPersistence {
  load(): Promise<Record<string, StoredSecret> | null>;
  save(data: Record<string, StoredSecret>): Promise<void>;
}

export interface StoredSecret {
  readonly mode: 'keyring' | 'fallback';
  readonly cipherBase64: string;
}

export interface SafeStorageOptions {
  readonly logger?: Logger;
  readonly persistence: SecretsPersistence;
  readonly electron?: SafeStorageLike | null;
  readonly fallbackSecret?: string;
  readonly onFallbackNotice?: () => void;
}

const FALLBACK_XOR_KEY = 'LEO_SAFE_STORAGE_FALLBACK_KEY_V1';

export class SafeStorage {
  private readonly logger: Logger | undefined;
  private readonly persistence: SecretsPersistence;
  private readonly electron: SafeStorageLike | null;
  private readonly fallbackSecret: string;
  private readonly onFallbackNotice: (() => void) | undefined;
  private cache: Record<string, StoredSecret> = {};
  private loaded = false;
  private warningShown = false;
  private firstFallbackNoticeFired = false;

  constructor(opts: SafeStorageOptions) {
    this.logger = opts.logger;
    this.persistence = opts.persistence;
    this.electron = opts.electron ?? null;
    this.fallbackSecret = opts.fallbackSecret ?? FALLBACK_XOR_KEY;
    this.onFallbackNotice = opts.onFallbackNotice;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const data = await this.persistence.load();
    this.cache = data ?? {};
    this.loaded = true;
    if (!this.keyringAvailable() && !this.warningShown) {
      this.logger?.warn('safestorage.warning-shown', { reason: 'keyring-unavailable' });
      this.warningShown = true;
    }
  }

  keyringAvailable(): boolean {
    if (this.electron === null) return false;
    try {
      return this.electron.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    await this.load();
    const entry = this.cache[key];
    if (entry === undefined) return null;
    try {
      return this.decrypt(entry);
    } catch (err) {
      this.logger?.error('safestorage.get-failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async has(key: string): Promise<boolean> {
    await this.load();
    return key in this.cache;
  }

  async set(key: string, plaintext: string): Promise<void> {
    await this.load();
    const mode: StoredSecret['mode'] = this.keyringAvailable() ? 'keyring' : 'fallback';
    const cipherBase64 = this.encrypt(plaintext, mode);
    this.cache[key] = { mode, cipherBase64 };
    await this.persistence.save(this.cache);
    this.logger?.info('safestorage.set', { key, mode });
    if (mode === 'fallback' && !this.firstFallbackNoticeFired) {
      this.firstFallbackNoticeFired = true;
      this.logger?.warn('safestorage.fallback', { key });
      this.onFallbackNotice?.();
    }
  }

  async delete(key: string): Promise<void> {
    await this.load();
    if (!(key in this.cache)) return;
    delete this.cache[key];
    await this.persistence.save(this.cache);
    this.logger?.info('safestorage.delete', { key });
  }

  async keys(): Promise<readonly string[]> {
    await this.load();
    return Object.keys(this.cache);
  }

  private encrypt(plaintext: string, mode: StoredSecret['mode']): string {
    if (mode === 'keyring' && this.electron !== null) {
      const buffer = this.electron.encryptString(plaintext);
      return buffer.toString('base64');
    }
    return xorB64Encode(plaintext, this.fallbackSecret);
  }

  private decrypt(entry: StoredSecret): string {
    if (entry.mode === 'keyring') {
      if (this.electron === null) {
        throw new Error('keyring cipher present but safeStorage not available');
      }
      const buf = Buffer.from(entry.cipherBase64, 'base64');
      return this.electron.decryptString(buf);
    }
    return xorB64Decode(entry.cipherBase64, this.fallbackSecret);
  }
}

export function xorB64Encode(plaintext: string, secret: string): string {
  if (secret.length === 0) throw new Error('fallback secret must be non-empty');
  const bytes = textToBytes(plaintext);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i]! ^ secret.charCodeAt(i % secret.length);
  }
  return bytesToBase64(out);
}

export function xorB64Decode(cipherBase64: string, secret: string): string {
  if (secret.length === 0) throw new Error('fallback secret must be non-empty');
  const bytes = base64ToBytes(cipherBase64);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i]! ^ secret.charCodeAt(i % secret.length);
  }
  return bytesToText(out);
}

function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
