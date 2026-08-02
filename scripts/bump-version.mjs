import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertSynchronized, bumpSemver, readMetadata, replaceFilesAtomically } from './version-utils.mjs';

const ANDROID_VERSION_CODE_MAX = 2100000000;

export async function bumpRepositoryVersion(root, level) {
  const metadata = await readMetadata(root);
  assertSynchronized(metadata);
  const nextVersion = bumpSemver(metadata.version, level);
  if (metadata.androidVersionCode >= ANDROID_VERSION_CODE_MAX) throw new Error(`Android versionCode cannot exceed ${ANDROID_VERSION_CODE_MAX}`);

  metadata.packageJson.version = nextVersion;
  metadata.lockJson.version = nextVersion;
  metadata.lockJson.packages[''].version = nextVersion;
  const packageText = `${JSON.stringify(metadata.packageJson, null, 2)}\n`;
  const lockText = `${JSON.stringify(metadata.lockJson, null, 2)}\n`;
  const gradleText = metadata.texts.gradleText
    .replace(/^(\s*versionCode\s+)\d+(\s*)$/m, `$1${metadata.androidVersionCode + 1}$2`)
    .replace(/^(\s*versionName\s+)["'][^"']+["'](\s*)$/m, `$1"${nextVersion}"$2`);

  await replaceFilesAtomically([
    { path: metadata.paths.packagePath, previous: metadata.texts.packageText, next: packageText },
    { path: metadata.paths.lockPath, previous: metadata.texts.lockText, next: lockText },
    { path: metadata.paths.gradlePath, previous: metadata.texts.gradleText, next: gradleText },
  ]);
  return { version: nextVersion, versionCode: metadata.androidVersionCode + 1 };
}

async function main() {
  const level = process.argv[2];
  const root = process.env.ANGLE_WARS_VERSION_ROOT || process.cwd();
  const result = await bumpRepositoryVersion(root, level);
  process.stdout.write(`Bumped Angle Wars to ${result.version} (Android versionCode ${result.versionCode}).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`Version bump failed: ${error.message}\n`); process.exitCode = 1; });
}
