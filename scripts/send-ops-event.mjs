function cleanEnv(name) {
  const value = String(process.env[name] || '').trim();
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(value) ? '' : value;
}

export async function sendOpsEvent(event) {
  const url = cleanEnv('OPS_ALERT_WEBHOOK_URL');
  const token = cleanEnv('OPS_ALERT_WEBHOOK_TOKEN');
  if (!url || !token) return { ok: false, skipped: true, reason: 'not-configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPS_ALERT_TIMEOUT_MS || 8000));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'irs_operations',
        service: 'IRS',
        environment: 'production',
        occurred_at: new Date().toISOString(),
        ...event,
      }),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    console.warn(`IRS operational event delivery failed: ${error?.name || 'Error'}`);
    return { ok: false, error: error?.name || 'Error' };
  } finally {
    clearTimeout(timeout);
  }
}
