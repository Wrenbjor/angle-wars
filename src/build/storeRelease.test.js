import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Store-release scaffolding invariants (Story 7.6 / NFR10). Mirrors
// capacitorConfig.test.js: everything is read straight off disk and asserted in
// the default node test environment — no Phaser/DOM, no ImageMagick, no Android
// SDK / Xcode. This proves, headlessly, that the shipped native shells carry
// BRANDED (not default-Capacitor) icons/splash at every required density with
// the correct alpha, the store manifests are correct (landscape lock, minimal
// permissions, identity), the release-signing scaffold + gitignore + `.example`
// templates are in place, and the docs describe the full store flow.
//
// Producing an actual signed AAB/.ipa and confirming on-device branding is the
// documented manual boundary (no SDK/JDK 21/macOS/Xcode/device on this host).

const repoRoot = new URL('../../', import.meta.url);
const abs = (rel) => fileURLToPath(new URL(rel, repoRoot));
const read = (rel) => readFileSync(abs(rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

// --- minimal PNG IHDR parser (no image dependency) --------------------------
// PNG signature (8 bytes) + IHDR: width u32be @16, height u32be @20,
// bit depth @24, colour type @25. Colour type 6 == truecolour+alpha (RGBA),
// 4 == grey+alpha; 0/2/3 have no alpha channel.
const pngHeader = (rel) => {
  const buf = readFileSync(abs(rel));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`not a PNG: ${rel}`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
};

// Walk the length-prefixed PNG chunk stream (after the 8-byte signature) and
// report whether a chunk of the given type is present. Used to catch palette
// (colour type 3) transparency carried in a tRNS chunk, which the IHDR-only
// header parser never sees.
const pngHasChunk = (rel, type) => {
  const buf = readFileSync(abs(rel));
  let off = 8; // skip signature
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const chunkType = buf.toString('ascii', off + 4, off + 8);
    if (chunkType === type) return true;
    if (chunkType === 'IEND') break;
    off += 12 + len; // 4 len + 4 type + len data + 4 crc
  }
  return false;
};

const fileSize = (rel) => statSync(abs(rel)).size;

const isIgnored = (rel) => {
  try {
    execFileSync('git', ['check-ignore', '-q', abs(rel)], { cwd: abs('.') });
    return true; // exit 0 => path is ignored
  } catch {
    return false; // exit 1 => not ignored
  }
};

const ANDROID_RES = 'android/app/src/main/res';
const IOS_ASSETS = 'ios/App/App/Assets.xcassets';

// exact Capacitor density tables (dims are hard-coded, not inferred)
const ANDROID_ICONS = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];
const ANDROID_FOREGROUND = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
];
const ANDROID_SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];
const IOS_SPLASHES = [
  'splash-2732x2732.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732-2.png',
];

describe('brand source + generator (single source, generated fan-out)', () => {
  it('commits the emblem-only brand source resources/icon.svg', () => {
    expect(existsSync(abs('resources/icon.svg'))).toBe(true);
    const svg = read('resources/icon.svg');
    expect(svg).toContain('<svg');
    // Pin the full brand palette (near-black bg + both neon strokes). Dimension
    // and byte-floor tests prove the assets are non-blank but read the committed
    // PNGs, which don't move on a source-only edit — so without this, recolouring
    // the emblem in the source (then regenerating) would ship off-brand assets
    // with every test green. Assert the exact cyan/magenta strokes too.
    const lower = svg.toLowerCase();
    expect(lower).toContain('#05060a'); // near-black brand background
    expect(lower).toContain('#12e6ff'); // cyan primary stroke
    expect(lower).toContain('#ff2ea6'); // magenta accent stroke
    expect(svg).toMatch(/<polyline/); // pure-geometry emblem (no font/rsvg delegate)
  });

  it('commits the deterministic generator script', () => {
    expect(existsSync(abs('scripts/gen-mobile-assets.sh'))).toBe(true);
    const sh = read('scripts/gen-mobile-assets.sh');
    expect(sh).toContain('convert'); // ImageMagick rasterizer
    expect(sh).toMatch(/command -v convert|which convert/); // convert-absent guard
    expect(sh).toContain('resources/icon.svg');
    // Load-bearing generator invariants that never touch the committed PNGs and
    // so are invisible to the dimension/alpha tests: the flatten background is the
    // brand near-black, every PNG is 8-bit, and opaque targets strip alpha. Pin
    // them so the next `npm run assets:mobile` can't silently regenerate assets
    // with a white background, wrong bit depth, or unstripped alpha.
    expect(sh).toMatch(/BG="#05060a"/i); // brand background feeding -flatten
    expect(sh).toContain('-depth 8'); // 8-bit output
    expect(sh).toContain('-alpha off'); // opaque icons/splashes strip alpha
  });

  it('wires the assets:mobile npm script to the generator', () => {
    const pkg = readJson('package.json');
    expect(pkg.scripts['assets:mobile']).toBe('bash scripts/gen-mobile-assets.sh');
  });
});

describe('Android launcher icons — branded, every density, opaque', () => {
  for (const [dir, size] of ANDROID_ICONS) {
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      it(`${dir}/${name} is ${size}x${size}, 8-bit, no alpha channel`, () => {
        const rel = `${ANDROID_RES}/${dir}/${name}`;
        const h = pngHeader(rel);
        expect([h.width, h.height]).toEqual([size, size]);
        expect(h.bitDepth).toBe(8);
        expect(h.colorType).not.toBe(6); // opaque icon — no RGBA
        expect(h.colorType).not.toBe(4); // no grey+alpha
        // palette PNGs (colour type 3) can hide transparency in a tRNS chunk —
        // assert none is present so the icon is truly opaque.
        expect(pngHasChunk(rel, 'tRNS')).toBe(false);
      });
    }
  }
});

describe('Android adaptive foreground — branded, every density, alpha kept', () => {
  for (const [dir, size] of ANDROID_FOREGROUND) {
    it(`${dir}/ic_launcher_foreground.png is ${size}x${size}, 8-bit, HAS alpha`, () => {
      const h = pngHeader(`${ANDROID_RES}/${dir}/ic_launcher_foreground.png`);
      expect([h.width, h.height]).toEqual([size, size]);
      expect(h.bitDepth).toBe(8);
      expect(h.colorType).toBe(6); // RGBA — composites over the background layer
    });
  }
});

describe('Android splashes — branded, every density, opaque', () => {
  for (const [dir, w, hh] of ANDROID_SPLASHES) {
    it(`${dir}/splash.png is ${w}x${hh}, 8-bit, no alpha channel`, () => {
      const rel = `${ANDROID_RES}/${dir}/splash.png`;
      const h = pngHeader(rel);
      expect([h.width, h.height]).toEqual([w, hh]);
      expect(h.bitDepth).toBe(8);
      expect(h.colorType).not.toBe(6);
      expect(h.colorType).not.toBe(4);
      expect(pngHasChunk(rel, 'tRNS')).toBe(false);
    });
  }
});

describe('iOS app icon + splash — branded, correct dims/alpha', () => {
  it('AppIcon-512@2x.png is 1024x1024, 8-bit, RGB with NO alpha (App Store rule)', () => {
    const rel = `${IOS_ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`;
    const h = pngHeader(rel);
    expect([h.width, h.height]).toEqual([1024, 1024]);
    expect(h.bitDepth).toBe(8);
    // App Store rejects icons with any alpha — require plain truecolour RGB
    // (colour type 2) and no palette-transparency chunk.
    expect(h.colorType).toBe(2);
    expect(pngHasChunk(rel, 'tRNS')).toBe(false);
  });

  for (const name of IOS_SPLASHES) {
    it(`${name} is 2732x2732, 8-bit, no alpha channel`, () => {
      const rel = `${IOS_ASSETS}/Splash.imageset/${name}`;
      const h = pngHeader(rel);
      expect([h.width, h.height]).toEqual([2732, 2732]);
      expect(h.bitDepth).toBe(8);
      // Splashes are flattened onto the brand background with alpha stripped
      // (same invariant the Android splash test enforces) — pin it here too so a
      // regenerated RGBA iOS splash can't slip through.
      expect(h.colorType).not.toBe(6);
      expect(h.colorType).not.toBe(4);
      expect(pngHasChunk(rel, 'tRNS')).toBe(false);
    });
  }
});

describe('generated assets are branded, not blank (emblem present)', () => {
  // The IHDR/dimension checks pass even for a solid #05060a square, so deleting
  // the <polyline> emblems from resources/icon.svg would ship blank assets
  // undetected. Branded PNGs are far larger than a solid fill (measured blanks:
  // iOS icon ~415 B, iOS splash ~1.2 kB, xxxhdpi fg ~308 B, xxxhdpi icon small,
  // land-xxxhdpi splash small). Conservative floors well above those baselines
  // catch the emblem-deletion mutation across all assets (one shared source).
  const floors = [
    [`${IOS_ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`, 10000],
    [`${IOS_ASSETS}/Splash.imageset/splash-2732x2732.png`, 20000],
    [`${ANDROID_RES}/mipmap-xxxhdpi/ic_launcher_foreground.png`, 5000],
    [`${ANDROID_RES}/mipmap-xxxhdpi/ic_launcher.png`, 3000],
    [`${ANDROID_RES}/drawable-land-xxxhdpi/splash.png`, 8000],
  ];
  for (const [rel, floor] of floors) {
    it(`${rel.split('/').pop()} byte size > ${floor} (content, not a flat fill)`, () => {
      expect(fileSize(rel)).toBeGreaterThan(floor);
    });
  }
});

describe('adaptive-icon background is the brand near-black (not white)', () => {
  it('ic_launcher_background.xml colour is #05060A', () => {
    const xml = read(`${ANDROID_RES}/values/ic_launcher_background.xml`);
    const m = xml.match(/<color name="ic_launcher_background">(#[0-9a-fA-F]{6,8})<\/color>/);
    expect(m).not.toBeNull();
    expect(m[1].toLowerCase()).toBe('#05060a');
  });
});

describe('Android manifest — landscape lock + minimal permissions + identity', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('locks MainActivity to sensorLandscape', () => {
    // Scope screenOrientation to the MainActivity <activity> element itself —
    // two unscoped toContain checks would both pass even if the orientation lock
    // were moved onto a different element or left in a comment, so couple them.
    const activity = manifest.match(
      /<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?>/,
    );
    expect(activity).not.toBeNull();
    expect(activity[0]).toContain('android:screenOrientation="sensorLandscape"');
  });

  it('declares exactly the INTERNET permission (no IAP/ads perms)', () => {
    const perms = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(perms).toEqual(['android.permission.INTERNET']);
  });

  it('keeps the stable appId', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('applicationId "com.wrenbjor.anglewars"');
  });

  it('keeps the launcher display name "Angle Wars"', () => {
    // The manifest <application android:label> is @string/app_name; pin its value
    // so the Android launcher display name is verified too (parity with the iOS
    // CFBundleDisplayName pin — the spec claims identity is pinned on BOTH platforms).
    const strings = read('android/app/src/main/res/values/strings.xml');
    const m = strings.match(/<string name="app_name">([^<]+)<\/string>/);
    expect(m?.[1]).toBe('Angle Wars');
  });
});

describe('iOS Info.plist — landscape-only iPhone orientations + identity', () => {
  const plist = read('ios/App/App/Info.plist');

  it('iPhone orientations are landscape-only (no Portrait)', () => {
    // isolate the UISupportedInterfaceOrientations array (the plain iPhone key,
    // NOT the ~ipad variant — which is landscape-locked too, asserted separately
    // in the next test)
    const m = plist.match(
      /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(m).not.toBeNull();
    const arr = m[1];
    expect(arr).toContain('UIInterfaceOrientationLandscapeLeft');
    expect(arr).toContain('UIInterfaceOrientationLandscapeRight');
    expect(arr).not.toContain('UIInterfaceOrientationPortrait');
  });

  it('iPad orientations are landscape-only (no Portrait)', () => {
    const m = plist.match(
      /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(m).not.toBeNull();
    const arr = m[1];
    expect(arr).toContain('UIInterfaceOrientationLandscapeLeft');
    expect(arr).toContain('UIInterfaceOrientationLandscapeRight');
    expect(arr).not.toContain('UIInterfaceOrientationPortrait');
  });

  it('requires 64-bit (arm64, not armv7)', () => {
    const m = plist.match(
      /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(m).not.toBeNull();
    expect(m[1]).toContain('arm64');
    expect(m[1]).not.toContain('armv7');
  });

  it('keeps the display name "Angle Wars"', () => {
    const m = plist.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/);
    expect(m?.[1]).toBe('Angle Wars');
  });
});

describe('Android release signing scaffold — graceful degradation', () => {
  const gradle = read('android/app/build.gradle');

  it('loads keystore.properties only when it exists', () => {
    expect(gradle).toContain('rootProject.file("keystore.properties")');
    expect(gradle).toMatch(/keystorePropertiesFile\.exists\(\)/);
  });

  it('guards on a completeness check, not bare file-exists (all four keys present)', () => {
    // A partially-filled keystore.properties must NOT feed null into file(...) and
    // break debug/CI configuration — the guard requires every key to be non-empty.
    expect(gradle).toMatch(/def\s+hasKeystore\s*=/);
    expect(gradle).toMatch(/keystorePropertiesFile\.exists\(\)/);
    // Scope the four-key assertion to the `def hasKeystore = ... .every { ... }`
    // expression itself — NOT the whole file. The same four quoted keys also
    // appear (in order) in the signingConfigs.release assignment block, so an
    // unscoped regex would stay green even if the .every completeness list were
    // shrunk to one key, silently reopening the "partial keystore breaks all
    // builds" bug this guard exists to prevent.
    const guard = gradle.match(/def\s+hasKeystore\s*=([\s\S]*?)\.every\s*\{/);
    expect(guard).not.toBeNull();
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      expect(guard[1]).toContain(`'${key}'`);
    }
  });

  it('populates signingConfigs.release under the keystore-presence guard', () => {
    // Capture the signingConfigs { release { ... } } body and assert the guard
    // lives INSIDE it (not only in buildTypes) — so the storeFile/... assignments
    // are themselves gated on hasKeystore.
    const sc = gradle.match(/signingConfigs\s*\{\s*release\s*\{([\s\S]*?)\n\s{8}\}/);
    expect(sc).not.toBeNull();
    expect(sc[1]).toMatch(/if\s*\(\s*hasKeystore\s*\)/);
    expect(sc[1]).toContain('storeFile file(keystoreProperties');
  });

  it('applies signingConfig to buildTypes.release under the same guard', () => {
    const releaseBlock = gradle.match(/buildTypes\s*\{[\s\S]*?\n\s{4}\}/);
    expect(releaseBlock).not.toBeNull();
    expect(releaseBlock[0]).toContain('signingConfig signingConfigs.release');
    expect(releaseBlock[0]).toMatch(/if\s*\(\s*hasKeystore\s*\)/);
  });
});

describe('secrets never committed; only .example templates are', () => {
  it('gitignores keystore.properties, *.jks, *.keystore', () => {
    expect(isIgnored('android/keystore.properties')).toBe(true);
    expect(isIgnored('android/release.jks')).toBe(true);
    expect(isIgnored('android/app/upload.keystore')).toBe(true);
  });

  it('commits the .example templates (not ignored, present)', () => {
    expect(existsSync(abs('android/keystore.properties.example'))).toBe(true);
    expect(existsSync(abs('ios/ExportOptions.plist.example'))).toBe(true);
    expect(isIgnored('android/keystore.properties.example')).toBe(false);
    expect(isIgnored('ios/ExportOptions.plist.example')).toBe(false);
    // the iOS export template is an app-store export config
    expect(read('ios/ExportOptions.plist.example')).toContain('app-store');
  });

  it('keystore.properties.example declares exactly the keys the gradle guard requires', () => {
    // The template must supply the four keys build.gradle's hasKeystore guard
    // checks (storeFile/storePassword/keyAlias/keyPassword). If a key were renamed
    // here, a developer who copies the template gets a keystore.properties that
    // the guard silently rejects (hasKeystore=false) → an UNSIGNED release with no
    // error. Pin the template's keys to the same list the guard test pins.
    const example = read('android/keystore.properties.example');
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      expect(example).toMatch(new RegExp(`^${key}=`, 'm'));
    }
  });
});

describe('docs — store-release flow documented', () => {
  const docs = read('docs/mobile-build.md');

  it('documents asset regeneration, versioning, Android AAB, and iOS export', () => {
    expect(docs).toMatch(/Store release/i);
    expect(docs).toContain('npm run assets:mobile');
    expect(docs).toMatch(/versionCode/);
    expect(docs).toMatch(/MARKETING_VERSION|CURRENT_PROJECT_VERSION/);
    expect(docs).toMatch(/bundleRelease|\.aab/);
    expect(docs).toMatch(/ExportOptions\.plist/);
    expect(docs).toMatch(/keystore\.properties/);
  });
});
