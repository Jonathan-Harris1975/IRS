import fs from 'node:fs';
import process from 'node:process';
import { sendOpsEvent } from './send-ops-event.mjs';
import { watchConfiguration, watchDeployment } from './pages-deployment.mjs';

let config;
try { config = watchConfiguration(process.env); } catch (error) {
  console.error(error.message);
  process.exit(1);
}
let result;
try { result = await watchDeployment(config); } catch (error) {
  result = { status: 'api-error', error: error.message };
}
const evidence = {
  schemaVersion: 1, service: 'IRS', repository: process.env.GITHUB_REPOSITORY || null,
  sha: config.commitSha, projectName: config.projectName, environment: 'production',
  observedAt: new Date().toISOString(), ...result,
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/pages-deployment.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`IRS Pages verification: ${result.status}`);
if (result.status === 'success') process.exit(0);
await sendOpsEvent({
  event_id: `cloudflare-pages:IRS:${result.deploymentId || config.commitSha}:${result.status}`,
  severity: 'critical', event_type: 'deployment_verification_failed', title: 'IRS Pages verification failed',
  summary: `Pages verification ended with ${result.status}. Inspect retained deployment evidence.`,
  release_id: config.commitSha, details: evidence,
});
process.exit(1);
