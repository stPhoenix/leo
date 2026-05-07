import { describe, expect, it } from 'vitest';
import { CANVAS_LOG, CANVAS_SENSITIVE_FIELD_KEYS } from '@/agent/canvas/loggingNamespaces';

describe('CANVAS_LOG', () => {
  it('exposes the four roots', () => {
    expect(Object.keys(CANVAS_LOG).sort()).toEqual([
      'contentEdit',
      'create',
      'layoutEdit',
      'reveal',
    ]);
  });

  it('every shared root carries refine/plan/fetch/extract/reduce/diff/layout/preview/write/mutex events', () => {
    for (const root of ['create', 'contentEdit', 'layoutEdit'] as const) {
      const node = CANVAS_LOG[root];
      expect(node.transition).toMatch(new RegExp(`^canvas\\.${root}\\.`));
      expect(node.refine.start).toMatch(/\.refine\.start$/);
      expect(node.refine.done).toMatch(/\.refine\.done$/);
      expect(node.fetch.failed).toMatch(/\.fetch\.failed$/);
      expect(node.extract.failed).toMatch(/\.extract\.failed$/);
      expect(node.reduce.failed).toMatch(/\.reduce\.failed$/);
      expect(node.diff.start).toMatch(/\.diff\.start$/);
      expect(node.layout.start).toMatch(/\.layout\.start$/);
      expect(node.preview.write).toMatch(/\.preview\.write$/);
      expect(node.write.start).toMatch(/\.write\.start$/);
      expect(node.write.failed).toMatch(/\.write\.failed$/);
      expect(node.mutex.acquire).toMatch(/\.mutex\.acquire$/);
      expect(node.mutex.release).toMatch(/\.mutex\.release$/);
      expect(node.cancel).toMatch(new RegExp(`^canvas\\.${root}\\.cancel$`));
      expect(node.error).toMatch(new RegExp(`^canvas\\.${root}\\.error$`));
    }
  });

  it('reveal root carries probe + invoke + openCanvas events', () => {
    expect(CANVAS_LOG.reveal.probe.ok).toBe('canvas.reveal.probe.ok');
    expect(CANVAS_LOG.reveal.probe.fail).toBe('canvas.reveal.probe.fail');
    expect(CANVAS_LOG.reveal.invoke.ok).toBe('canvas.reveal.invoke.ok');
    expect(CANVAS_LOG.reveal.invoke.fail).toBe('canvas.reveal.invoke.fail');
    expect(CANVAS_LOG.reveal.openCanvas.opened).toBe('canvas.reveal.openCanvas.opened');
  });

  it('matches snapshot to keep the surface stable', () => {
    expect(CANVAS_LOG).toMatchSnapshot();
  });
});

describe('CANVAS_SENSITIVE_FIELD_KEYS', () => {
  it('exposes the documented sensitive field set', () => {
    expect([...CANVAS_SENSITIVE_FIELD_KEYS].sort()).toEqual([
      'extractorOutput',
      'rawSource',
      'reducerOutput',
      'refineMessages',
      'sidecarBody',
    ]);
  });
});
