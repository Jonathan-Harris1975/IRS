import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_ALLOWLIST = 'config/secret-scan-allowlist.json';
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules']);

const CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^A-Za-z0-9_-])(?:["']?)(?:`,
    String.raw`api[_-]?key|secret(?:[_-]?(?:access[_-]?key|key|token|value))?|password|passwd|`,
    String.raw`access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|`,
    String.raw`webhook[_-]?(?:url|secret|token)|signing[_-]?secret|cf[_-]?pages[_-]?api[_-]?token|`,
    String.raw`ops[_-]?alert[_-]?webhook[_-]?(?:url|token)|ecosystem[_-]?smoke[_-]?dispatch[_-]?token`,
    String.raw`)(?:["']?)\s*[:=]\s*(?<secret>`,
    String.raw`"[^"\r\n]{4,}"|'[^'\r\n]{4,}'|`,
    String.raw`[A-Za-z0-9_./+~=:@-]{8,}(?=$|[\s#;,]))`,
  ].join(''),
  'gim',
);

const DETECTORS = [
  {
    id: 'private-key',
    pattern: /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]{20,}?-----END \1-----/g,
  },
  {
    id: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
  },
  {
    id: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
  },
  {
    id: 'jwt-token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: 'bearer-token',
    pattern: /\bBearer\s+(?<secret>[A-Za-z0-9._~+/=-]{16,})\b/gi,
    secretGroup: 'secret',
  },
  {
    id: 'webhook-url',
    pattern: /https:\/\/(?:hooks\.slack\.com\/services\/[A-Z0-9]{8,}\/[A-Z0-9]{8,}\/(?<slack>[A-Za-z0-9]{16,})|(?:discord(?:app)?\.com)\/api\/webhooks\/\d{8,}\/(?<discord>[A-Za-z0-9._-]{16,}))/gi,
    secretGroup: ['slack', 'discord'],
  },
  {
    id: 'url-credentials',
    pattern: /https?:\/\/(?<secret>[^\s/:@]+:[^\s/@]+)@[^\s/]+/gi,
    secretGroup: 'secret',
  },
  {
    id: 'credential-assignment',
    pattern: CREDENTIAL_ASSIGNMENT_PATTERN,
    secretGroup: 'secret',
  },
];

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function normalizeSecret(value) {
  if (typeof value !== 'string') return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isSafePlaceholder(value) {
  const candidate = normalizeSecret(value).trim();
  if (!candidate) return true;
  if (/^\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}$/i.test(candidate)) return true;
  if (/^\$[A-Z_][A-Z0-9_]*$/i.test(candidate) || /^\$\{[A-Z_][A-Z0-9_]*\}$/i.test(candidate)) return true;
  if (/^(?:process\.env|env)\.[A-Z_][A-Z0-9_]*$/i.test(candidate)) return true;
  if (/^(?:example|placeholder|changeme|change-me|dummy|fake|testing?|sample|redacted|not[-_]?a[-_]?secret|your[-_][A-Za-z0-9_.-]+|x{8,})(?:[-_.:/][A-Za-z0-9_.:/-]+)*$/i.test(candidate)) return true;
  return false;
}

function secretFromMatch(detector, match) {
  if (!detector.secretGroup) return match[0];
  if (Array.isArray(detector.secretGroup)) {
    for (const group of detector.secretGroup) {
      if (match.groups?.[group]) return match.groups[group];
    }
    return '';
  }
  return match.groups?.[detector.secretGroup] || '';
}

function positionFor(text, index) {
  const prefix = text.slice(0, index);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function findingKey(finding) {
  return `${finding.path}\0${finding.detector}\0${finding.fingerprint}`;
}

export function scanText(text, relativePath = '<memory>', allowlistEntries = []) {
  const allowlist = new Set(allowlistEntries.map((entry) => `${entry.path}\0${entry.detector}\0${entry.fingerprint}`));
  const findings = [];
  const allowlistHits = new Set();

  for (const detector of DETECTORS) {
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      const secret = normalizeSecret(secretFromMatch(detector, match));
      if (!secret || isSafePlaceholder(secret)) continue;
      const offsetWithinMatch = Math.max(0, match[0].indexOf(secret));
      const { line, column } = positionFor(text, match.index + offsetWithinMatch);
      const finding = {
        path: relativePath,
        line,
        column,
        detector: detector.id,
        fingerprint: sha256(secret),
        secretLength: secret.length,
      };
      const key = findingKey(finding);
      if (allowlist.has(key)) {
        allowlistHits.add(key);
        continue;
      }
      findings.push(finding);
    }
  }

  return { findings, allowlistHits };
}

function validateAllowlist(config) {
  if (!config || config.version !== 1 || !Array.isArray(config.entries)) {
    throw new Error('secret-scan allow-list must use schema version 1 with an entries array');
  }
  const seen = new Set();
  for (const entry of config.entries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.detector !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(entry.fingerprint || '') || typeof entry.reason !== 'string' || entry.reason.trim().length < 8) {
      throw new Error('each secret-scan allow-list entry requires path, detector, SHA-256 fingerprint and a meaningful reason');
    }
    if (path.isAbsolute(entry.path) || entry.path.includes('..')) {
      throw new Error(`secret-scan allow-list path must be repository-relative: ${entry.path}`);
    }
    const key = `${entry.path}\0${entry.detector}\0${entry.fingerprint}`;
    if (seen.has(key)) throw new Error(`duplicate secret-scan allow-list entry: ${entry.path} / ${entry.detector}`);
    seen.add(key);
  }
  return config.entries;
}

export function loadAllowlist(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return validateAllowlist(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

function isTextBuffer(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export function scanRepository(root, { allowlistPath = path.join(root, DEFAULT_ALLOWLIST) } = {}) {
  const allowlistEntries = loadAllowlist(allowlistPath);
  const allAllowlistKeys = new Set(allowlistEntries.map((entry) => `${entry.path}\0${entry.detector}\0${entry.fingerprint}`));
  const usedAllowlistKeys = new Set();
  const findings = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  for (const absolute of listFiles(root)) {
    const buffer = fs.readFileSync(absolute);
    if (!isTextBuffer(buffer)) {
      skippedFiles += 1;
      continue;
    }
    const relativePath = path.relative(root, absolute).split(path.sep).join('/');
    const result = scanText(buffer.toString('utf8'), relativePath, allowlistEntries);
    scannedFiles += 1;
    findings.push(...result.findings);
    for (const key of result.allowlistHits) usedAllowlistKeys.add(key);
  }

  const staleAllowlist = allowlistEntries.filter((entry) => !usedAllowlistKeys.has(`${entry.path}\0${entry.detector}\0${entry.fingerprint}`));
  return { findings, scannedFiles, skippedFiles, staleAllowlist, configuredAllowlistEntries: allAllowlistKeys.size };
}

export function formatFinding(finding) {
  return `${finding.path}:${finding.line}:${finding.column} ${finding.detector} [REDACTED length=${finding.secretLength} fingerprint=${finding.fingerprint.slice(0, 19)}…]`;
}

function parseArgs(argv) {
  const options = { root: process.cwd(), allowlistPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = path.resolve(argv[++index]);
    else if (arg === '--allowlist') options.allowlistPath = path.resolve(argv[++index]);
    else if (arg === '--no-allowlist') options.allowlistPath = false;
    else throw new Error(`unknown secret-scan option: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allowlistPath = options.allowlistPath === false
    ? path.join(options.root, '__secret-scan-no-allowlist__.json')
    : (options.allowlistPath || path.join(options.root, DEFAULT_ALLOWLIST));
  const result = scanRepository(options.root, { allowlistPath });

  if (result.staleAllowlist.length) {
    console.error(`Secret scan rejected ${result.staleAllowlist.length} stale allow-list entr${result.staleAllowlist.length === 1 ? 'y' : 'ies'}:`);
    for (const entry of result.staleAllowlist) console.error(`- ${entry.path} / ${entry.detector} (${entry.reason})`);
    process.exitCode = 2;
    return;
  }
  if (result.findings.length) {
    console.error(`Secret scan found ${result.findings.length} potential committed secret${result.findings.length === 1 ? '' : 's'}:`);
    for (const finding of result.findings) console.error(`- ${formatFinding(finding)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Secret scan passed: ${result.scannedFiles} text files checked; ${result.configuredAllowlistEntries} exact synthetic/test exception(s); secret values are never printed.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`Secret scan failed safely: ${error?.message || error?.name || 'unknown error'}`);
    process.exitCode = 2;
  });
}
