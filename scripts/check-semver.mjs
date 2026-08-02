import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compareSemver, parseSemver, assertSynchronized, metadataFromTexts, readMetadata } from './version-utils.mjs';

export function parsePushRefs(input) {
  return input.split(/\r?\n/).filter(Boolean).map((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error(`Invalid pre-push ref line: ${line}`);
    return { localRef: fields[0], localSha: fields[1], remoteRef: fields[2], remoteSha: fields[3] };
  });
}

export function latestSemverTag(tags) {
  let latest = null;
  for (const tag of tags) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) continue;
    const version = tag.slice(1);
    parseSemver(version);
    if (latest === null || compareSemver(version, latest.slice(1)) > 0) latest = tag;
  }
  return latest;
}

export function parseAndroidVersionCode(gradleText) {
  const match = gradleText.match(/^\s*versionCode\s+(\d+)\s*$/m);
  if (!match) throw new Error('Tagged Android versionCode not found');
  const code = Number(match[1]);
  if (!Number.isSafeInteger(code) || code < 1) throw new Error('Tagged Android versionCode must be a positive safe integer');
  return code;
}

export async function checkRepository({ root, refs = [], listTags, taggedVersionCode = () => null, pushedMetadata }) {
  const updates = refs.filter((ref) => !/^0+$/.test(ref.localSha));
  if (updates.length === 0) {
    const metadata = await readMetadata(root);
    assertSynchronized(metadata);
    return metadata.version;
  }

  let checkedVersion = null;
  for (const update of updates) {
    const metadata = pushedMetadata ? await pushedMetadata(update.localSha) : await readMetadata(root);
    assertSynchronized(metadata);
    checkedVersion = metadata.version;
    if (update.remoteRef !== 'refs/heads/main') continue;
    const tags = listTags(update.localSha);
    const latest = latestSemverTag(tags);
    if (latest && compareSemver(metadata.version, latest.slice(1)) <= 0) {
      throw new Error(`Main push blocked: package version ${metadata.version} must be newer than reachable release ${latest}. Run npm run version:bump -- patch|minor|major, review, and commit the result.`);
    }
    if (latest) {
      const priorCode = taggedVersionCode(latest);
      if (Number.isSafeInteger(priorCode) && metadata.androidVersionCode <= priorCode) {
        throw new Error(`Main push blocked: Android versionCode ${metadata.androidVersionCode} must exceed ${priorCode} from ${latest}. Run npm run version:bump -- patch|minor|major, review, and commit the result.`);
      }
    }
  }
  return checkedVersion;
}

function readMetadataAtCommit(root, sha) {
  const show = (file) => execFileSync('git', ['show', `${sha}:${file}`], { cwd: root, encoding: 'utf8' });
  return metadataFromTexts({
    packageText: show('package.json'),
    lockText: show('package-lock.json'),
    gradleText: show('android/app/build.gradle'),
  });
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  const root = process.env.ANGLE_WARS_VERSION_ROOT || process.cwd();
  const refs = parsePushRefs(await readStdin());
  const version = await checkRepository({
    root,
    refs,
    pushedMetadata: (sha) => readMetadataAtCommit(root, sha),
    listTags: (sha) => execFileSync('git', ['tag', '--merged', sha, '--list', 'v*'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean),
    taggedVersionCode: (tag) => {
      try {
        return parseAndroidVersionCode(execFileSync('git', ['show', `${tag}:android/app/build.gradle`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      } catch {
        return null;
      }
    },
  });
  process.stdout.write(`Version metadata synchronized at ${version}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
