import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../observability/metrics.js';
import { parseHealthCommand, renderHealthReport, renderHealthToolsReport } from './health-command.js';

describe('parseHealthCommand', () => {
  it('parses supported command forms', () => {
    expect(parseHealthCommand('!health')).toBe('basic');
    expect(parseHealthCommand('  !health   verbose ')).toBe('verbose');
    expect(parseHealthCommand('!health tools')).toBe('tools');
    expect(parseHealthCommand('!memory show')).toBeNull();
  });
});

describe('renderHealthReport', () => {
  it('renders basic and verbose reports without secrets', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('discord.message.received');
    metrics.recordInvokeStart('message');
    metrics.recordInvokeResult('message', 120, false, 'timed out');

    const base = {
      metrics,
      queueDepth: 2,
      config: {
        runtimeModel: 'opus',
        runtimeTimeoutMs: 60000,
        runtimeTools: ['Read', 'Edit'],
        useRuntimeSessions: true,
        toolAwareStreaming: true,
        maxConcurrentInvocations: 3,
        discordActionsEnabled: true,
        summaryEnabled: true,
        durableMemoryEnabled: true,
        messageHistoryBudget: 3000,
        reactionHandlerEnabled: false,
        reactionRemoveHandlerEnabled: false,
        cronEnabled: true,
        beadsEnabled: false,
        requireChannelContext: true,
        autoIndexChannelContext: true,
      },
    } as const;

    const basic = renderHealthReport({ ...base, mode: 'basic' });
    expect(basic).toContain('Discoclaw Health');
    expect(basic).toContain('Queue depth: 2');
    expect(basic).not.toContain('Config (safe)');

    const verbose = renderHealthReport({ ...base, mode: 'verbose' });
    expect(verbose).toContain('Config (safe)');
    expect(verbose).toContain('runtimeModel=opus');
    expect(verbose).toContain('Error classes:');
  });

  it('renders tools report', () => {
    const out = renderHealthToolsReport({
      permissionTier: 'standard',
      effectiveTools: ['Read', 'Edit'],
      configuredRuntimeTools: ['Read', 'Edit', 'WebSearch'],
    });
    expect(out).toContain('Discoclaw Tools');
    expect(out).toContain('Permission tier: standard');
    expect(out).toContain('Effective tools: Read, Edit');
    expect(out).toContain('Configured runtime tools: Read, Edit, WebSearch');
  });
});
