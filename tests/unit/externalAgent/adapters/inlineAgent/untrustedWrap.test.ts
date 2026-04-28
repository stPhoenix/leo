import { describe, expect, it } from 'vitest';
import {
  wrapToolResultForLLM,
  wrapUntrusted,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/untrustedWrap';

describe('wrapUntrusted', () => {
  it('wraps text with origin attribute', () => {
    const out = wrapUntrusted('hello', 'https://example.com/x');
    expect(out).toBe('<untrusted-content origin="https://example.com/x">hello</untrusted-content>');
  });

  it('strips quotes and newlines from origin', () => {
    const out = wrapUntrusted('body', 'https://x"y\nz');
    expect(out).toBe('<untrusted-content origin="https://xyz">body</untrusted-content>');
  });

  it('escapes nested closing tag', () => {
    const out = wrapUntrusted('pre </untrusted-content> post', 'http://x');
    expect(out).toContain('</untrusted-content_>');
    // Exactly one real closing tag remains (the wrap's own).
    expect(out.match(/<\/untrusted-content>/g)).toHaveLength(1);
  });

  it('case-insensitive nested-close escape', () => {
    const out = wrapUntrusted('a </UNTRUSTED-CONTENT> b', 'http://x');
    expect(out).toContain('</untrusted-content_>');
  });
});

describe('wrapToolResultForLLM', () => {
  it('passes through non-ok results', () => {
    const r = { ok: false, error: 'blocked' };
    expect(wrapToolResultForLLM('fetch_url', r)).toBe(r);
  });

  it('passes through unknown tool names', () => {
    const r = { ok: true, data: { body: 'x' } };
    expect(wrapToolResultForLLM('extract_note', r)).toBe(r);
  });

  it('wraps fetch_url string body', () => {
    const r = {
      ok: true,
      data: {
        status: 200,
        headers: {},
        body: 'hello world',
        totalBytes: 11,
        url: 'https://example.com/page',
      },
    };
    const out = wrapToolResultForLLM('fetch_url', r) as typeof r;
    expect(out.data.body).toBe(
      '<untrusted-content origin="https://example.com/page">hello world</untrusted-content>',
    );
    // Other fields preserved.
    expect(out.data.status).toBe(200);
    expect(out.data.totalBytes).toBe(11);
  });

  it('does not wrap fetch_url JSON body (object)', () => {
    const r = {
      ok: true,
      data: {
        status: 200,
        headers: {},
        body: { foo: 'bar' },
        totalBytes: 13,
        url: 'https://example.com/api',
      },
    };
    const out = wrapToolResultForLLM('fetch_url', r) as typeof r;
    expect(out.data.body).toEqual({ foo: 'bar' });
  });

  it('wraps each search_web result and answer', () => {
    const r = {
      ok: true,
      data: {
        answer: 'top-line answer',
        results: [
          { title: 't1', url: 'https://a.example/1', content: 'c1', score: 0.9 },
          { title: 't2', url: 'https://b.example/2', content: 'c2', score: 0.5 },
        ],
        responseTimeMs: 12,
      },
    };
    const out = wrapToolResultForLLM('search_web', r) as {
      ok: true;
      data: {
        answer: string;
        results: Array<{ title: string; url: string; content: string; score: number }>;
      };
    };
    expect(out.data.answer).toBe(
      '<untrusted-content origin="tavily://aggregate">top-line answer</untrusted-content>',
    );
    const row0 = out.data.results[0];
    const row1 = out.data.results[1];
    if (row0 === undefined || row1 === undefined) throw new Error('expected two results');
    expect(row0.content).toBe(
      '<untrusted-content origin="https://a.example/1">c1</untrusted-content>',
    );
    expect(row1.content).toBe(
      '<untrusted-content origin="https://b.example/2">c2</untrusted-content>',
    );
    // Title/url unmodified.
    expect(row0.title).toBe('t1');
    expect(row0.url).toBe('https://a.example/1');
  });

  it('omits answer wrap when absent', () => {
    const r = {
      ok: true,
      data: {
        results: [{ title: 't', url: 'https://x.example/1', content: 'c', score: 1 }],
        responseTimeMs: 1,
      },
    };
    const out = wrapToolResultForLLM('search_web', r) as { data: Record<string, unknown> };
    expect(out.data.answer).toBeUndefined();
  });
});
