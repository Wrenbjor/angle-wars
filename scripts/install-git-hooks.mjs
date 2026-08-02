import { execFileSync } from 'node:child_process';

let gitDirectoryAvailable = false;
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  gitDirectoryAvailable = true;
} catch {
  process.stderr.write('Warning: Git checkout unavailable; committed hooks were not installed.\n');
}

if (gitDirectoryAvailable) {
  let existing = '';
  try {
    existing = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (existing && existing !== '.githooks') {
    throw new Error(`Refusing to replace existing core.hooksPath (${existing}). Chain the Angle Wars pre-push hook manually or clear that setting, then rerun npm run prepare.`);
  }
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  process.stdout.write('Configured Git hooks from .githooks.\n');
}
