import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { APP_VERSION, APP_VERSION_LABEL, formatAppVersion, validateAppVersion } from './appVersion.js';

describe('appVersion', () => {
  it('uses package.json as the injected source of truth', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION_LABEL).toBe(`v${packageJson.version}`);
  });

  it.each(['0.0.0', '2.0.1', '12.34.56'])('accepts strict SemVer %s', (version) => {
    expect(validateAppVersion(version)).toBe(version);
    expect(formatAppVersion(version)).toBe(`v${version}`);
  });

  it.each(['2.0', 'v2.0.1', '01.0.0', '2.0.1-beta', '', null])(
    'rejects invalid build-time version %s',
    (version) => expect(() => validateAppVersion(version)).toThrow(/Invalid package SemVer/),
  );
});
