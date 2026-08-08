'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const childProcess = require('node:child_process');

const tracePath = process.env.IDE_NODE_AUDIT_TRACE;
const languageServerRoot = process.env.IDE_NODE_AUDIT_LANGUAGE_SERVER_ROOT;
const typeScriptRoot = process.env.IDE_NODE_AUDIT_TYPESCRIPT_ROOT;
const workspaceRoot = process.env.IDE_NODE_AUDIT_WORKSPACE_ROOT;
if (!tracePath || !languageServerRoot || !typeScriptRoot || !workspaceRoot) {
  throw new Error('Node process audit environment is incomplete');
}

function append(event) {
  fs.appendFileSync(tracePath, `${JSON.stringify({ ...event, pid: process.pid })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function inside(candidate, root) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const normalized = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${path.sep}`);
}

function commandText(command, args) {
  return [command, ...(Array.isArray(args) ? args : [])].map(String).join(' ');
}

const packageManagers = new Set(['npm', 'npm.cmd', 'npx', 'npx.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun', 'bunx', 'corepack']);
function prohibitedLaunch(command, args) {
  const base = path.basename(String(command)).toLowerCase();
  const text = commandText(command, args);
  return packageManagers.has(base)
    || /(^|\s)(run|run-script|exec)(\s|$)/.test(text) && /(npm|pnpm|yarn|bun|corepack)/.test(text)
    || text.includes('CANARY_RAN');
}

append({ event: 'process-start', execPath: process.execPath, argv: process.argv, cwd: process.cwd() });

const originalResolveFilename = Module._resolveFilename;
const reported = new Set();
Module._resolveFilename = function auditedResolveFilename(request, parent, isMain, options) {
  const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
  if (typeof resolved === 'string') {
    let role = null;
    if (inside(resolved, languageServerRoot)) role = 'language-server';
    if (inside(resolved, typeScriptRoot)) role = 'typescript';
    if (inside(resolved, workspaceRoot)) {
      append({ event: 'prohibited-workspace-module-load', request: String(request), resolved });
      throw new Error(`project module execution is forbidden: ${resolved}`);
    }
    const key = `${role}:${resolved}`;
    if (role && !reported.has(key)) {
      reported.add(key);
      append({ event: 'module-resolve', role, request: String(request), resolved });
    }
  }
  return resolved;
};

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[method];
  childProcess[method] = function auditedProcessLaunch(command, args, ...rest) {
    append({ event: 'child-process-attempt', method, command: String(command), args: Array.isArray(args) ? args.map(String) : [] });
    if (prohibitedLaunch(command, args)) {
      append({ event: 'prohibited-package-manager-or-script', method, command: String(command), args: Array.isArray(args) ? args.map(String) : [] });
      throw new Error(`package-manager/project-script invocation is forbidden: ${commandText(command, args)}`);
    }
    return original.call(this, command, args, ...rest);
  };
}

for (const method of ['exec', 'execSync']) {
  const original = childProcess[method];
  childProcess[method] = function auditedShellLaunch(command, ...rest) {
    append({ event: 'child-process-attempt', method, command: String(command), args: [] });
    if (prohibitedLaunch(command, [])) {
      append({ event: 'prohibited-package-manager-or-script', method, command: String(command), args: [] });
      throw new Error(`package-manager/project-script invocation is forbidden: ${command}`);
    }
    return original.call(this, command, ...rest);
  };
}
