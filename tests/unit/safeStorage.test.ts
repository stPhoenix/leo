import { describe, expect, it, vi } from 'vitest';
import {
  SafeStorage,
  xorB64Decode,
  xorB64Encode,
  type SafeStorageLike,
  type SecretsPersistence,
  type StoredSecret,
} from '@/storage/safeStorage';

interface HarnessPersistence extends SecretsPersistence {
  readonly state: Record<string, StoredSecret>;
  saves: number;
}

function mkPersistence(seed: Record<string, StoredSecret> | null = null): HarnessPersistence {
  const state: Record<string, StoredSecret> = seed ?? {};
  const harness: HarnessPersistence = {
    state,
    saves: 0,
    async load(): Promise<Record<string, StoredSecret> | null> {
      return { ...state };
    },
    async save(data: Record<string, StoredSecret>): Promise<void> {
      for (const k of Object.keys(state)) delete state[k];
      for (const [k, v] of Object.entries(data)) state[k] = v;
      harness.saves += 1;
    },
  };
  return harness;
}

interface MockElectron extends SafeStorageLike {
  encryptCalls: number;
  decryptCalls: number;
}

function mkMockElectron(available = true): MockElectron {
  const state = { encryptCalls: 0, decryptCalls: 0 };
  const impl: MockElectron = {
    encryptCalls: 0,
    decryptCalls: 0,
    isEncryptionAvailable: () => available,
    encryptString: (plaintext) => {
      state.encryptCalls += 1;
      impl.encryptCalls = state.encryptCalls;
      return Buffer.from(`ENC:${plaintext}`);
    },
    decryptString: (cipher) => {
      state.decryptCalls += 1;
      impl.decryptCalls = state.decryptCalls;
      const raw = cipher.toString();
      if (!raw.startsWith('ENC:')) throw new Error('bad cipher');
      return raw.slice('ENC:'.length);
    },
  };
  return impl;
}

describe('SafeStorage', () => {
  it('xor encode/decode round-trips UTF-8 payloads', () => {
    const secret = 'my-secret';
    const payloads = ['hello', '', 'héllo 世界', 'sk-abc123!@#$%^&*()'];
    for (const p of payloads) {
      expect(xorB64Decode(xorB64Encode(p, secret), secret)).toBe(p);
    }
  });

  it('xor decode with wrong secret does not return plaintext', () => {
    const cipher = xorB64Encode('sk-123', 'right-key');
    const wrong = xorB64Decode(cipher, 'wrong-keyZ');
    expect(wrong).not.toBe('sk-123');
  });

  it('keyring path: set writes ciphertext via electron.encryptString, get returns plaintext', async () => {
    const persistence = mkPersistence();
    const electron = mkMockElectron(true);
    const store = new SafeStorage({ persistence, electron });
    await store.set('openai', 'sk-live-KEY');
    expect(electron.encryptCalls).toBe(1);
    expect(persistence.state.openai?.mode).toBe('keyring');
    expect(persistence.state.openai?.cipherBase64).not.toContain('sk-live-KEY');
    const round = await store.get('openai');
    expect(round).toBe('sk-live-KEY');
  });

  it('fallback path when keyring unavailable: set + get round-trips via XOR', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(false) });
    await store.set('openai', 'sk-FALLBACK');
    expect(persistence.state.openai?.mode).toBe('fallback');
    const round = await store.get('openai');
    expect(round).toBe('sk-FALLBACK');
  });

  it('fires onFallbackNotice exactly once on first degraded write', async () => {
    const persistence = mkPersistence();
    const onFallbackNotice = vi.fn();
    const store = new SafeStorage({
      persistence,
      electron: mkMockElectron(false),
      onFallbackNotice,
    });
    await store.set('a', 'v1');
    await store.set('b', 'v2');
    expect(onFallbackNotice).toHaveBeenCalledTimes(1);
  });

  it('delete removes the ciphertext and the in-memory cache entry', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(true) });
    await store.set('openai', 'sk-KEY');
    expect(await store.has('openai')).toBe(true);
    await store.delete('openai');
    expect(await store.has('openai')).toBe(false);
    expect(await store.get('openai')).toBeNull();
    expect(persistence.state.openai).toBeUndefined();
  });

  it('keys() returns every stored key', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(true) });
    await store.set('a', '1');
    await store.set('b', '2');
    const keys = await store.keys();
    expect([...keys].sort()).toEqual(['a', 'b']);
  });

  it('getCached returns null before load() and decrypts in-place after', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(true) });
    expect(store.getCached('openai')).toBe(null);
    await store.set('openai', 'sk-live-KEY');
    expect(store.getCached('openai')).toBe('sk-live-KEY');
    expect(store.getCached('missing')).toBe(null);
  });

  it('getCached reflects updates immediately (no stale window after set)', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(true) });
    await store.set('provider.anthropic.apiKey', 'sk-ant-OLD');
    await store.set('provider.google.apiKey', 'AIza-NEW');
    expect(store.getCached('provider.anthropic.apiKey')).toBe('sk-ant-OLD');
    expect(store.getCached('provider.google.apiKey')).toBe('AIza-NEW');
  });

  it('get for unknown key returns null (not throw)', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(true) });
    expect(await store.get('nothing')).toBeNull();
  });

  it('keyringAvailable returns false when electron is null', () => {
    const store = new SafeStorage({ persistence: mkPersistence(), electron: null });
    expect(store.keyringAvailable()).toBe(false);
  });

  it('persistence never contains plaintext of any stored secret', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(true) });
    const secret = 'PLAINTEXT-GUARD-12345';
    await store.set('k', secret);
    const serialized = JSON.stringify(persistence.state);
    expect(serialized).not.toContain(secret);
  });

  it('persistence in fallback mode never contains plaintext', async () => {
    const persistence = mkPersistence();
    const store = new SafeStorage({ persistence, electron: mkMockElectron(false) });
    const secret = 'PLAINTEXT-GUARD-67890';
    await store.set('k', secret);
    const serialized = JSON.stringify(persistence.state);
    expect(serialized).not.toContain(secret);
  });
});
