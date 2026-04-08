import { describe, it, expect } from 'vitest';

describe('Security Flags Environment Variables', () => {
  it('ALLOW_REAL_SEND deve estar definido', () => {
    expect(process.env.ALLOW_REAL_SEND).toBeDefined();
    expect(process.env.ALLOW_REAL_SEND).toBe('true');
  });

  it('ALLOW_CRON_ENABLE deve estar definido', () => {
    expect(process.env.ALLOW_CRON_ENABLE).toBeDefined();
    expect(process.env.ALLOW_CRON_ENABLE).toBe('true');
  });

  it('KILL_SWITCH deve estar definido', () => {
    expect(process.env.KILL_SWITCH).toBeDefined();
    expect(process.env.KILL_SWITCH).toBe('false');
  });
});
