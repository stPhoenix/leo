import { Notice } from 'obsidian';
import type { UserErrorChannel } from './logTypes';

export function createObsidianUserErrorChannel(statusEl: HTMLElement): UserErrorChannel {
  return {
    notify(message) {
      new Notice(message);
    },
    setStatus(message) {
      statusEl.setText(`Leo: ${message}`);
    },
    clearStatus() {
      statusEl.setText('');
    },
  };
}
