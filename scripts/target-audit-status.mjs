const DEFAULT_STALENESS_THRESHOLD_HOURS = 36;

function validIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normaliseCount(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return number;
}

function normaliseThreshold(value = DEFAULT_STALENESS_THRESHOLD_HOURS) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError('staleness threshold must be a positive number of hours');
  }
  return number;
}

function buildTargetAuditStatus({ completedAt, checked, failed, previousStatus = null, thresholdHours } = {}) {
  const completed = validIso(completedAt);
  if (!completed) throw new TypeError('completedAt must be a valid ISO timestamp');
  const targetsChecked = normaliseCount(checked, 'checked');
  const targetsFailing = normaliseCount(failed, 'failed');
  if (targetsFailing > targetsChecked) throw new RangeError('failed cannot exceed checked');

  const threshold = normaliseThreshold(thresholdHours);
  const result = targetsChecked > 0 && targetsFailing === 0 ? 'success' : 'failure';
  const previousSuccess = validIso(previousStatus?.lastSuccessfulAt);
  const lastSuccessfulAt = result === 'success' ? completed : previousSuccess;
  const staleAfter = new Date(new Date(completed).getTime() + threshold * 60 * 60 * 1000).toISOString();

  return {
    schemaVersion: 1,
    service: 'IRS',
    check: 'redirect-target-audit',
    result,
    lastCompletedAt: completed,
    lastSuccessfulAt,
    targetsChecked,
    targetsFailing,
    staleness: {
      thresholdHours: threshold,
      staleAfter,
      statusAtGeneration: 'fresh',
      rule: 'Treat the signal as stale when the observation time is at or after staleAfter.',
    },
  };
}

function evaluateTargetAuditStatus(status, observedAt = new Date().toISOString()) {
  if (!status || status.schemaVersion !== 1 || status.service !== 'IRS' || status.check !== 'redirect-target-audit') {
    throw new TypeError('invalid IRS target-audit status document');
  }
  if (!['success', 'failure'].includes(status.result)) throw new TypeError('invalid target-audit result');
  const checked = normaliseCount(status.targetsChecked, 'targetsChecked');
  const failing = normaliseCount(status.targetsFailing, 'targetsFailing');
  if (failing > checked) throw new RangeError('targetsFailing cannot exceed targetsChecked');
  if (!validIso(status.lastCompletedAt)) throw new TypeError('lastCompletedAt must be a valid ISO timestamp');
  if (status.lastSuccessfulAt !== null && !validIso(status.lastSuccessfulAt)) {
    throw new TypeError('lastSuccessfulAt must be null or a valid ISO timestamp');
  }
  normaliseThreshold(status.staleness?.thresholdHours);
  const observed = validIso(observedAt);
  const staleAfter = validIso(status.staleness?.staleAfter);
  if (!observed || !staleAfter) throw new TypeError('status freshness timestamps must be valid ISO timestamps');
  const stale = new Date(observed).getTime() >= new Date(staleAfter).getTime();
  const effectiveStatus = status.result === 'failure' ? 'failing' : stale ? 'stale' : 'healthy';
  return { stale, effectiveStatus };
}

export {
  DEFAULT_STALENESS_THRESHOLD_HOURS,
  buildTargetAuditStatus,
  evaluateTargetAuditStatus,
};
