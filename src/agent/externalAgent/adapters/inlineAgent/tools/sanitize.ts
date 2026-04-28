// Body-content sanitizers for fetched bytes before they enter the LLM context.
// Defense-in-depth, not output-rendering safety. Pure module.

// Zero-width + word-joiner + BOM + bidi-control / bidi-isolate code points.
// U+200B-200D, U+2060, U+FEFF, U+202A-202E, U+2066-2069.
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const SCRIPT_REGEX = /<script\b[\s\S]*?<\/script\s*>/gi;
const STYLE_REGEX = /<style\b[\s\S]*?<\/style\s*>/gi;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const HTML_CONTENT_TYPE_REGEX = /^\s*text\/html\b/i;

export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_CHARS_REGEX, '');
}

export function stripHtmlScriptStyleComments(s: string): string {
  return s.replace(SCRIPT_REGEX, '').replace(STYLE_REGEX, '').replace(HTML_COMMENT_REGEX, '');
}

export function isHtmlContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return HTML_CONTENT_TYPE_REGEX.test(contentType);
}

export function sanitizeBody(body: string, contentType?: string): string {
  let out = stripInvisible(body);
  if (isHtmlContentType(contentType)) out = stripHtmlScriptStyleComments(out);
  return out;
}
