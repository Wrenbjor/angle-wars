import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bumpRepositoryVersion } from '../../scripts/bump-version.mjs';
import { checkRepository, latestSemverTag, parseAndroidVersionCode, parsePushRefs } from '../../scripts/check-semver.mjs';

const roots = [];
async function fixture({ version = '2.0.0', lockVersion = version, androidName = version, code = 7 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'angle-wars-version-'));
  roots.push(root);
  await mkdir(path.join(root, 'android/app'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
  await writeFile(path.join(root, 'package-lock.json'), `${JSON.stringify({ name: 'fixture', version: lockVersion, lockfileVersion: 3, packages: { '': { name: 'fixture', version: lockVersion } } }, null, 2)}\n`);
  await writeFile(path.join(root, 'android/app/build.gradle'), `android {\n defaultConfig {\n  versionCode ${code}\n  versionName "${androidName}"\n }\n}\n`);
  return root;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('explicit synchronized version bump', () => {
  it.each([['patch', '2.3.5'], ['minor', '2.4.0'], ['major', '3.0.0']])(
    'bumps %s and increments Android versionCode exactly once', async (level, expected) => {
      const root = await fixture({ version: '2.3.4', code: 41 });
      await expect(bumpRepositoryVersion(root, level)).resolves.toEqual({ version: expected, versionCode: 42 });
      const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
      const gradle = await readFile(path.join(root, 'android/app/build.gradle'), 'utf8');
      expect(pkg.version).toBe(expected);
      expect(lock.version).toBe(expected);
      expect(lock.packages[''].version).toBe(expected);
      expect(gradle).toMatch(/versionCode 42/);
      expect(gradle).toContain(`versionName "${expected}"`);
    },
  );

  it('rejects invalid input or drift without partial writes', async () => {
    const root = await fixture();
    const files = ['package.json', 'package-lock.json', 'android/app/build.gradle'];
    const before = await Promise.all(files.map((file) => readFile(path.join(root, file), 'utf8')));
    await expect(bumpRepositoryVersion(root, 'banana')).rejects.toThrow();
    expect(await Promise.all(files.map((file) => readFile(path.join(root, file), 'utf8')))).toEqual(before);
    const drifted = await fixture({ lockVersion: '1.9.9' });
    await expect(bumpRepositoryVersion(drifted, 'patch')).rejects.toThrow(/Version drift/);
  });
});

describe('validation-only push guard', () => {
  it('allows synchronized feature pushes without a release bump', async () => {
    const root = await fixture();
    const refs = parsePushRefs('refs/heads/topic abc refs/heads/topic 000\n');
    await expect(checkRepository({ root, refs, listTags: () => ['v2.0.0'] })).resolves.toBe('2.0.0');
  });

  it('validates metadata from the commit being pushed instead of the working tree', async () => {
    const root = await fixture({ version: '2.0.1' });
    const pushedRoot = await fixture({ version: '2.0.0', androidName: '1.9.9' });
    const refs = parsePushRefs('refs/heads/topic abc refs/heads/topic 000\n');
    const { readMetadata } = await import('../../scripts/version-utils.mjs');
    await expect(checkRepository({
      root,
      refs,
      listTags: () => [],
      pushedMetadata: () => readMetadata(pushedRoot),
    })).rejects.toThrow(/Version drift/);
  });

  it('blocks drift and leaves files byte-identical', async () => {
    const root = await fixture({ androidName: '1.0.0' });
    const file = path.join(root, 'android/app/build.gradle');
    const before = await readFile(file, 'utf8');
    await expect(checkRepository({ root, refs: [], listTags: () => [] })).rejects.toThrow(/Version drift/);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('blocks equal main versions and allows newer ones', async () => {
    const refs = parsePushRefs('refs/heads/main abc refs/heads/main def\n');
    const equal = await fixture({ version: '2.0.0' });
    await expect(checkRepository({ root: equal, refs, listTags: () => ['v2.0.0'] })).rejects.toThrow(/Main push blocked/);
    const newer = await fixture({ version: '2.0.1' });
    await expect(checkRepository({ root: newer, refs, listTags: () => ['v2.0.0'], taggedVersionCode: () => 6 })).resolves.toBe('2.0.1');
  });

  it('blocks a newer main SemVer when Android versionCode did not increase', async () => {
    const root = await fixture({ version: '2.0.1', code: 7 });
    const refs = parsePushRefs('refs/heads/main abc refs/heads/main def\n');
    await expect(checkRepository({ root, refs, listTags: () => ['v2.0.0'], taggedVersionCode: () => 7 })).rejects.toThrow(/versionCode 7 must exceed 7/);
    expect(parseAndroidVersionCode(' defaultConfig {\n versionCode 42\n }')).toBe(42);
  });

  it('selects the numeric latest strict release tag', () => {
    expect(latestSemverTag(['preview', 'v2.9.0', 'v10.0.0', 'v2.10.0-beta'])).toBe('v10.0.0');
    expect(() => parseAndroidVersionCode('versionCode 99999999999999999999')).toThrow(/safe integer/);
  });
});
