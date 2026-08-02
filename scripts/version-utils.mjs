import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSemver(value) {
  const match = typeof value === 'string' ? SEMVER_RE.exec(value) : null;
  if (!match) throw new Error(`Invalid SemVer: ${String(value)}`);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error(`Invalid SemVer: ${String(value)}`);
  return parts;
}

export function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  return 0;
}

export function bumpSemver(version, level) {
  const parts = parseSemver(version);
  if (level === 'major') return `${parts[0] + 1}.0.0`;
  if (level === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  if (level === 'patch') return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  throw new Error('Bump level must be patch, minor, or major');
}

export async function readMetadata(root) {
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const gradlePath = path.join(root, 'android/app/build.gradle');
  const [packageText, lockText, gradleText] = await Promise.all([
    readFile(packagePath, 'utf8'), readFile(lockPath, 'utf8'), readFile(gradlePath, 'utf8'),
  ]);
  return metadataFromTexts({ packageText, lockText, gradleText }, { packagePath, lockPath, gradlePath });
}

export function metadataFromTexts({ packageText, lockText, gradleText }, paths = {}) {
  const packageJson = JSON.parse(packageText);
  const lockJson = JSON.parse(lockText);
  parseSemver(packageJson.version);
  const codeMatch = gradleText.match(/^\s*versionCode\s+(\d+)\s*$/m);
  const nameMatch = gradleText.match(/^\s*versionName\s+["']([^"']+)["']\s*$/m);
  if (!codeMatch || !nameMatch) throw new Error('Android versionCode/versionName not found');
  return {
    paths,
    texts: { packageText, lockText, gradleText },
    packageJson, lockJson,
    version: packageJson.version,
    lockVersion: lockJson.version,
    lockRootVersion: lockJson.packages?.['']?.version,
    androidVersionName: nameMatch[1],
    androidVersionCode: Number(codeMatch[1]),
  };
}

export function assertSynchronized(metadata) {
  const { version } = metadata;
  parseSemver(version);
  if (metadata.lockVersion !== version || metadata.lockRootVersion !== version) {
    throw new Error(`Version drift: package.json=${version}, package-lock.json=${metadata.lockVersion}, lock root=${metadata.lockRootVersion}. Run npm run version:bump -- patch|minor|major.`);
  }
  if (metadata.androidVersionName !== version) {
    throw new Error(`Version drift: package.json=${version}, Android versionName=${metadata.androidVersionName}. Run npm run version:bump -- patch|minor|major.`);
  }
  if (!Number.isSafeInteger(metadata.androidVersionCode) || metadata.androidVersionCode < 1) {
    throw new Error('Android versionCode must be a positive safe integer.');
  }
}

export async function replaceFilesAtomically(entries) {
  const temps = [];
  const replaced = [];
  try {
    for (let i = 0; i < entries.length; i++) {
      const temp = `${entries[i].path}.version-tmp-${process.pid}-${i}`;
      await writeFile(temp, entries[i].next, 'utf8');
      temps.push(temp);
    }
    for (let i = 0; i < entries.length; i++) {
      await rename(temps[i], entries[i].path);
      replaced.push(entries[i]);
    }
  } catch (error) {
    await Promise.allSettled(replaced.map((entry) => writeFile(entry.path, entry.previous, 'utf8')));
    await Promise.allSettled(temps.map((temp) => unlink(temp)));
    throw error;
  }
}
