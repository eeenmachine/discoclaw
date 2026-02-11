import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics.js';

describe('MetricsRegistry', () => {
  it('tracks invoke counters and latency summaries', () => {
    const m = new MetricsRegistry();
    m.recordInvokeStart('message');
    m.recordInvokeResult('message', 100, true);
    m.recordInvokeResult('message', 200, false, 'timed out');

    const snap = m.snapshot();
    expect(snap.counters['invoke.message.started']).toBe(1);
    expect(snap.counters['invoke.message.succeeded']).toBe(1);
    expect(snap.counters['invoke.message.failed']).toBe(1);
    expect(snap.counters['invoke.message.error_class.timeout']).toBe(1);
    expect(snap.latencies.message.count).toBe(2);
    expect(snap.latencies.message.maxMs).toBe(200);
    expect(snap.latencies.reaction.count).toBe(0);
  });
});
