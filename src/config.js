// Configuration: the label prefix, the log directory, the port, and where plists are read from.
// Precedence: command-line flags, then LAUNCHBOARD_* environment variables, then the config file,
// then the defaults below.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  prefix: [],
  exclude: [],
  logDir: '~/Library/Logs/launchboard',
  agentsDirs: ['~/Library/LaunchAgents'],
  port: 3990,
  host: '127.0.0.1',
});

export const expandHome = (p, home = os.homedir()) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(home, p.slice(1)) : p);
export const tildify = (p, home = os.homedir()) => (typeof p === 'string' && home && (p === home || p.startsWith(home + path.sep)) ? `~${p.slice(home.length)}` : p);

const list = (v) => {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(list);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
};

function readFileConfig(file) {
  if (!file) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`launchboard: cannot read config file ${file}: ${e.message}`);
  }
}

/**
 * Resolve the configuration.
 * flags: { prefix, exclude, logDir, agentsDir, port, host, config }
 */
export function loadConfig({ flags = {}, env = process.env, home = os.homedir() } = {}) {
  const configPath = flags.config || env.LAUNCHBOARD_CONFIG || path.join(home, '.config', 'launchboard', 'config.json');
  const file = readFileConfig(expandHome(configPath, home));
  const pick = (flag, envKey, fileKey) => {
    if (flag !== undefined && flag !== null && !(Array.isArray(flag) && !flag.length)) return flag;
    if (env[envKey] !== undefined && env[envKey] !== '') return env[envKey];
    if (file[fileKey] !== undefined) return file[fileKey];
    return DEFAULTS[fileKey];
  };
  const port = Number(pick(flags.port, 'LAUNCHBOARD_PORT', 'port'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`launchboard: port must be a whole number from 0 to 65535, got ${port}`);
  const agentsDirs = list(pick(flags.agentsDir, 'LAUNCHBOARD_AGENTS_DIRS', 'agentsDirs')).map((d) => expandHome(d, home));
  return {
    prefix: list(pick(flags.prefix, 'LAUNCHBOARD_PREFIX', 'prefix')),
    exclude: list(pick(flags.exclude, 'LAUNCHBOARD_EXCLUDE', 'exclude')),
    logDir: expandHome(String(pick(flags.logDir, 'LAUNCHBOARD_LOG_DIR', 'logDir')), home),
    agentsDirs: agentsDirs.length ? agentsDirs : DEFAULTS.agentsDirs.map((d) => expandHome(d, home)),
    port,
    host: String(pick(flags.host, 'LAUNCHBOARD_HOST', 'host')),
    configPath: expandHome(configPath, home),
    home,
  };
}

/** Whether a label is on the board under this configuration. */
export function labelMatches(label, cfg) {
  const inPrefix = !cfg.prefix.length || cfg.prefix.some((p) => label.startsWith(p));
  return inPrefix && !cfg.exclude.some((p) => label.startsWith(p));
}
