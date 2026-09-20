import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTargetAuditStatus, evaluateTargetAuditStatus } from '../scripts/target-audit-status.mjs';

test('successful target audit emits the persistent status schema', () => {
  const status = buildTargetAuditStatus({
    completedAt: '2026-09-20T06:17:00.000Z',
    checked: 103,
    failed: 0,
    thresholdHours: 36,
  });
  assert.deepEqual(status, {
    schemaVersion: 1,
    service: 'IRS',
    check: 'redirect-target-audit',
    result: 'success',
    lastCompletedAt: '2026-09-20T06:17:00.000Z',
    lastSuccessfulAt: '2026-09-20T06:17:00.000Z',
    targetsChecked: 103,
    targetsFailing: 0,
    staleness: {
      thresholdHours: 36,
      staleAfter: '2026-09-21T18:17:00.000Z',
      statusAtGeneration: 'fresh',
      rule: 'Treat the signal as stale when the observation time is at or after staleAfter.',
    },
  });
});

test('failed audit preserves the previous successful audit timestamp', () => {
  const status = buildTargetAuditStatus({
    completedAt: '2026-09-21T06:17:00.000Z',
    checked: 103,
    failed: 2,
    previousStatus: { lastSuccessfulAt: '2026-09-20T06:17:00.000Z' },
    thresholdHours: 36,
  });
  assert.equal(status.result, 'failure');
  assert.equal(status.lastSuccessfulAt, '2026-09-20T06:17:00.000Z');
  assert.equal(status.targetsFailing, 2);
});

test('freshness evaluation makes an old successful result stale', () => {
  const status = buildTargetAuditStatus({
    completedAt: '2026-09-20T06:17:00.000Z',
    checked: 103,
    failed: 0,
    thresholdHours: 36,
  });
  assert.deepEqual(evaluateTargetAuditStatus(status, '2026-09-21T18:16:59.999Z'), {
    stale: false,
    effectiveStatus: 'healthy',
  });
  assert.deepEqual(evaluateTargetAuditStatus(status, '2026-09-21T18:17:00.000Z'), {
    stale: true,
    effectiveStatus: 'stale',
  });
});

test('a failed result remains failing even when it is also stale', () => {
  const status = buildTargetAuditStatus({
    completedAt: '2026-09-20T06:17:00.000Z',
    checked: 103,
    failed: 1,
    thresholdHours: 36,
  });
  assert.deepEqual(evaluateTargetAuditStatus(status, '2026-09-22T00:00:00.000Z'), {
    stale: true,
    effectiveStatus: 'failing',
  });
});
