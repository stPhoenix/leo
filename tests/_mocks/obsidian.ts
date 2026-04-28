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
