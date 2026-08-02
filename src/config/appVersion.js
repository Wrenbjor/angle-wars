const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateAppVersion(version) {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid package SemVer: ${String(version)}`);
  }
  return version;
}

export function formatAppVersion(version) {
  return `v${validateAppVersion(version)}`;
}

export const APP_VERSION = validateAppVersion(__APP_VERSION__);
export const APP_VERSION_LABEL = formatAppVersion(APP_VERSION);
