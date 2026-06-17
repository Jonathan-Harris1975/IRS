import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const mapPath = path.join(root, 'data', 'image-url-map.json');
const redirectsPath = path.join(root, 'public', '_redirects');
const healthPath = path.join(root, 'public', 'health.json');
const allowedHostsPath = path.join(root, 'config', 'allowed-destination-hosts.json');

function fail(message) {
  console.error(`IRS validation failed: ${message}`);
  process.exitCode = 1;
}

const registry = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const allowedHostConfig = JSON.parse(fs.readFileSync(allowedHostsPath, 'utf8'));
const allowedHosts = new Set(Array.isArray(allowedHostConfig?.hosts) ? allowedHostConfig.hosts : []);
if (!allowedHosts.size) fail('config/allowed-destination-hosts.json must contain at least one approved host.');
if (!registry || Array.isArray(registry) || typeof registry !== 'object') {
  fail('data/image-url-map.json must contain an object map.');
}

const rules = fs.readFileSync(redirectsPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line, index) => {
    const parts = line.split(/\s+/);
    if (parts.length !== 3) fail(`redirect line ${index + 1} must contain path, target and status.`);
    return { source: parts[0], target: parts[1], status: parts[2] };
  });

const seen = new Set();
for (const rule of rules) {
  if (!rule.source?.startsWith('/')) fail(`invalid source path: ${rule.source}`);
  if (seen.has(rule.source)) fail(`duplicate redirect source: ${rule.source}`);
  seen.add(rule.source);
  if (!rule.target?.startsWith('https://')) fail(`non-HTTPS target: ${rule.source}`);
  try {
    const targetHost = new URL(rule.target).hostname;
    if (!allowedHosts.has(targetHost)) fail(`target host is not authorised for ${rule.source}: ${targetHost}`);
  } catch {
    fail(`invalid target URL: ${rule.source}`);
  }
  if (rule.status !== '301') fail(`redirect must be permanent (301): ${rule.source}`);
}

const registryKeys = Object.keys(registry);
for (const [source, target] of Object.entries(registry)) {
  if (!source.startsWith('/')) fail(`registry key must begin with /: ${source}`);
  if (typeof target !== 'string' || !target.startsWith('https://')) fail(`invalid registry target: ${source}`);
  const rule = rules.find((candidate) => candidate.source === source);
  if (!rule) fail(`registry path missing from _redirects: ${source}`);
  else if (rule.target !== target) fail(`target mismatch for ${source}`);
}
for (const rule of rules) {
  if (!(rule.source in registry)) fail(`_redirects path missing from registry: ${rule.source}`);
}

const health = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
if (health.status !== 'healthy' || health.service !== 'IRS') {
  fail('public/health.json does not satisfy the IRS health contract.');
}
if (registryKeys.length !== rules.length) fail('redirect count does not match registry count.');

if (!process.exitCode) {
  console.log(`IRS validation passed: ${rules.length} redirects, unique HTTPS targets, authorised destination domains and a valid health contract.`);
}
