export class MarkdownView {}
export class TFile {
  path = '';
  name = '';
}
export class TFolder {
  path = '';
  name = '';
}
export class Notice {
  constructor(_message: string) {}
}
export class Component {
  load(): void {}
  unload(): void {}
}
export const Platform = { isMobile: false, isDesktop: true };

export interface Debouncer<T extends unknown[], V> {
  (...args: T): this;
  cancel(): this;
  run(): V | void;
}

export function debounce<T extends unknown[], V>(
  cb: (...args: T) => V,
  timeout = 0,
  resetTimer = false,
): Debouncer<T, V> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;
  const fire = (): V | void => {
    timer = null;
    if (lastArgs === null) return;
    const args = lastArgs;
    lastArgs = null;
    return cb(...args);
  };
  const debounced = function (this: unknown, ...args: T): Debouncer<T, V> {
    lastArgs = args;
    if (timer !== null && resetTimer) clearTimeout(timer);
    if (timer === null || resetTimer) timer = setTimeout(fire, timeout);
    return debounced as unknown as Debouncer<T, V>;
  } as Debouncer<T, V>;
  debounced.cancel = function (): Debouncer<T, V> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
    return debounced;
  };
  debounced.run = function (): V | void {
    if (timer !== null) clearTimeout(timer);
    return fire();
  };
  return debounced;
}
