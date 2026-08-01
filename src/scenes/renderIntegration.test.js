import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Render-integration smoke test (DW-2). Pins the Boot→Preload→…→Arena scene
// chain and the render→sim decoupling wiring against SOURCE TEXT.
//
// These modules cannot be imported headlessly: `phaser` throws `window is not
// defined` on import in the node test env, and `main.js` constructs a
// `new Phaser.Game(...)` at module load (needs a DOM). So — following the
// `buildConfig.test.js` convention for Phaser-coupled invariants — every check
// below asserts against the file's source text rather than the loaded module.
//
// This file COMPLEMENTS `buildConfig.test.js` (which pins the WEBGL / Scale.FIT /
// CENTER_BOTH positives): here we pin the scene chain, the render→sim decoupling,
// and the not-AUTO negative that buildConfig lacks.

function readSrc(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('render-integration — scene chain (main.js)', () => {
  const mainSrc = readSrc('../main.js');

  it('registers scenes in order Boot→Preload→Title→Arena→Settings', () => {
    expect(mainSrc).toMatch(
      /scene:\s*\[\s*BootScene\s*,\s*PreloadScene\s*,\s*TitleScene\s*,\s*ArenaScene\s*,\s*SettingsScene\s*\]/,
    );
  });

  it('forces the WEBGL renderer and never falls back to Phaser.AUTO', () => {
    expect(mainSrc).toMatch(/type:\s*Phaser\.WEBGL/);
    // The not-AUTO negative: a flip to Phaser.AUTO (Canvas fallback) must fail.
    expect(mainSrc).not.toContain('Phaser.AUTO');
  });
});

describe('render-integration — Boot→Preload→Title handoffs', () => {
  it('BootScene.create() starts PreloadScene', () => {
    expect(readSrc('./BootScene.js')).toMatch(/this\.scene\.start\(\s*['"]PreloadScene['"]\s*\)/);
  });

  it('PreloadScene.create() starts TitleScene', () => {
    expect(readSrc('./PreloadScene.js')).toMatch(/this\.scene\.start\(\s*['"]TitleScene['"]\s*\)/);
  });
});

describe('render-integration — vibrant primary scenes without camera haze', () => {
  const primaryScenes = [
    ['ArenaScene', readSrc('./ArenaScene.js')],
    ['TitleScene', readSrc('./TitleScene.js')],
    ['SettingsScene', readSrc('./SettingsScene.js')],
  ];

  it.each(primaryScenes)('%s does not register camera-wide bloom', (_name, source) => {
    expect(source).not.toContain('addNeonBloom');
    expect(source).not.toMatch(/\.postFX\.addBloom\s*\(/);
  });

  it.each(primaryScenes)('%s preserves local additive neon layers', (_name, source) => {
    expect(source).toMatch(/applyAdditiveBlend\s*\(/);
  });
});

describe('render-integration — sim-rate sampler wiring (ArenaScene)', () => {
  // Pins that ArenaScene is actually WIRED to the extracted SimRateSampler with
  // the correct arg order and a per-frame update() call. The SimRateSampler unit
  // tests only exercise the class in isolation, so an arg-swap
  // (update(ticks, delta)) or a dropped per-frame call would ship a broken DEV
  // readout while the whole suite stays green. These source-text checks make a
  // mis-wire fail the suite rather than only surfacing as a wrong DEV number.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('constructs the sampler with the 1000 ms window', () => {
    expect(arenaSrc).toMatch(/this\._simRateSampler\s*=\s*new SimRateSampler\(\s*1000\s*\)/);
  });

  it('drives the sampler per frame with delta first, then ticks', () => {
    expect(arenaSrc).toMatch(
      /this\._simRateSampler\.update\(\s*delta\s*,\s*this\.simClock\.ticks\s*\)/,
    );
  });
});

describe('render-integration — reduced-motion wiring (ArenaScene, Story 6.1)', () => {
  // Pins all four load-bearing reduced-motion wirings in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the sim-rate/decoupling
  // checks above — these are SOURCE-TEXT assertions. A regression that dropped any of
  // these would silently disable the accessibility feature (AC2) or silently reset the
  // user's saved preference to false, while the rest of the suite stayed green.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('passes this._reducedMotion as the third arg to packGridUniforms (warp flatten)', () => {
    expect(arenaSrc).toMatch(
      /packGridUniforms\(\s*this\.gridShader\.uniforms\s*,\s*this\.gridFieldSystem\s*,\s*this\._reducedMotion\s*\)/,
    );
  });

  it('zeroes the camera scroll under reduced motion, keeping the shake offsets on the else path', () => {
    // The reduced-motion branch forces scrollX/scrollY to 0 (no camera kick).
    expect(arenaSrc).toMatch(
      /if\s*\(\s*this\._reducedMotion\s*\)\s*\{[\s\S]*?this\.cameras\.main\.scrollX\s*=\s*0\s*;[\s\S]*?this\.cameras\.main\.scrollY\s*=\s*0\s*;[\s\S]*?\}/,
    );
    // The non-reduced path must still write the computed shake offsets — so a
    // regression that dropped the else branch (killing the shake entirely) fails.
    expect(arenaSrc).toMatch(
      /this\.cameras\.main\.scrollX\s*=\s*shakeOffsetX\(/,
    );
    expect(arenaSrc).toMatch(
      /this\.cameras\.main\.scrollY\s*=\s*shakeOffsetY\(/,
    );
  });

  it('gates the flash-overlay alpha on reduced motion (flash forced off)', () => {
    expect(arenaSrc).toMatch(
      /this\.flashOverlay\.setAlpha\(\s*[\s\S]*?this\._reducedMotion\s*\?\s*0\s*:/,
    );
  });

  it('carries reducedMotion through the in-run applyAudioSettings save (no clobber)', () => {
    // The in-run M / - / + save must include reducedMotion: as a read-only passthrough,
    // or an audio change would clobber the persisted preference back to false.
    expect(arenaSrc).toMatch(
      /this\.settingsStorage\.save\(\{[\s\S]*?reducedMotion:\s*this\._reducedMotion[\s\S]*?\}\)/,
    );
  });

  it('gates the black-hole pulse oscillation on reduced motion (Story 6.2 AC / WCAG 2.3.1)', () => {
    // The seizure-band alpha flashing must honor reduced motion: this._reducedMotion
    // is threaded as the 4th arg to blackHolePulseAlpha so the pulse holds steady
    // (color still escalates). A regression that dropped this would flash red at up
    // to BLACKHOLE_PULSE_HZ with no opt-out while the suite stayed green.
    expect(arenaSrc).toMatch(
      /blackHolePulseAlpha\(\s*ratio\s*,\s*time\s*,\s*baseAlpha\s*,\s*this\._reducedMotion\s*\)/,
    );
  });
});

describe('render-integration — black-hole instability wiring (ArenaScene, Story 6.2)', () => {
  // Pins the load-bearing Story 6.2 render/audio wiring in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the reduced-motion /
  // sim-rate checks above — these are SOURCE-TEXT assertions. The pure helpers
  // (blackHolePulseColor/Alpha, blackHoleInstability) and the sim level
  // (maxInstability / AudioDirectorSystem.blackHoleInstability) carry their own unit
  // coverage; the visible red pulse + audible urgency cue are the disclosed manual
  // boundary, so these assertions guard only that the scene actually calls them.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('fills each hole with blackHolePulseColor at blackHolePulseAlpha off its instability ratio', () => {
    // The per-hole ratio comes from blackHoleInstability(h.radius)…
    expect(arenaSrc).toMatch(/blackHoleInstability\(\s*h\.radius\s*\)/);
    // …and drives the pulse color + alpha at the current animation time.
    expect(arenaSrc).toMatch(/blackHolePulseColor\(\s*ratio\s*\)/);
    expect(arenaSrc).toMatch(/blackHolePulseAlpha\(\s*ratio\s*,\s*time\s*,/);
  });

  it('maps audioDirector.blackHoleInstability into the audio engine urgency cue, forced to 0 at game-over', () => {
    // The urgency level is fed to the engine each frame, but gated to 0 on game-over
    // (maxInstability is only recomputed inside the gameOver-gated world.fixedUpdate,
    // so an unstable-hole run-end would otherwise freeze the tone droning).
    expect(arenaSrc).toMatch(
      /this\.audioEngine\.setBlackHoleUrgency\(\s*this\.playerState\.gameOver\s*\?\s*0\s*:\s*this\.audioDirector\.blackHoleInstability\s*,?\s*\)/,
    );
  });
});

describe('render-integration — mirror-reflector render wiring (ArenaScene, Story 6.3)', () => {
  // Pins the load-bearing Story 6.3 dumbbell render pass in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the reduced-motion /
  // black-hole checks above — these are SOURCE-TEXT assertions. The pure geometry seam
  // (reflectorEndpoints) carries its own unit coverage; the visible spinning dumbbell is
  // the disclosed manual boundary, so these assertions guard only that the scene actually
  // draws it from the pool with the telegraph cue and joins the additive/bloom layer.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('computes each reflector bar via the reflectorEndpoints seam scaled by telegraphScale', () => {
    // Endpoints come from the pure seam, with the bar half-length scaled by the
    // telegraph scale so a spawning-in reflector fades + scales in.
    expect(arenaSrc).toMatch(
      /reflectorEndpoints\(\s*r\.x\s*,\s*r\.y\s*,\s*r\.angle\s*,\s*REFLECTOR_BAR_HALF_LENGTH\s*\*\s*scale\s*\)/,
    );
    // The per-reflector telegraph progress drives both the alpha and the scale.
    expect(arenaSrc).toMatch(/telegraphAlpha\(\s*p\s*,\s*SPAWN_TELEGRAPH_MIN_ALPHA\s*\)/);
    expect(arenaSrc).toMatch(/telegraphScale\(\s*p\s*,\s*SPAWN_TELEGRAPH_MIN_SCALE\s*\)/);
  });

  it('draws the reflector bar + weights in COLOR_MIRROR_REFLECTOR from the reflector pool', () => {
    // Iterates the reflector pool's active set…
    expect(arenaSrc).toMatch(
      /this\.mirrorReflectorSystem\.enemyPool\.forEachActive\(/,
    );
    // …stroking the bar line and filling the weights in the reflector color.
    expect(arenaSrc).toMatch(/lineStyle\([\s\S]*?COLOR_MIRROR_REFLECTOR/);
    expect(arenaSrc).toMatch(/fillStyle\(\s*COLOR_MIRROR_REFLECTOR\s*,\s*alpha\s*\)/);
  });

  it('joins the reflector graphics to the additive/bloom neon layer list', () => {
    // The reflectorGraphics object must be in the applyAdditiveBlend list so the
    // dumbbell stays vivid through the same additive blend as every other neon layer.
    expect(arenaSrc).toMatch(
      /applyAdditiveBlend\(\s*\[[\s\S]*?this\.reflectorGraphics[\s\S]*?\]/,
    );
  });
});

describe('render-integration — ricochet bullet tint wiring (ArenaScene, Story 11.5)', () => {
  // Pins the Story 11.5 bounced-bullet tint in the bullet render loop. ArenaScene is Phaser-
  // coupled (cannot be imported headlessly), so — like every check in this file — this is a
  // SOURCE-TEXT assertion. The visual-legibility requirement is that a BOUNCED ricochet bullet
  // draws in COLOR_RICOCHET while a fresh bullet stays COLOR_BULLET. Dropping the ternary (all
  // bullets revert to COLOR_BULLET) or inverting it (fresh tinted, bounced not) would silently
  // regress the mechanic's on-screen legibility while the whole suite stayed green — bullet
  // rendering runs only under Phaser and is never exercised live.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('fills each bullet with COLOR_RICOCHET when bounced, else COLOR_BULLET, off the stamped flag', () => {
    expect(arenaSrc).toMatch(
      /fillStyle\(\s*b\.bounced\s*\?\s*COLOR_RICOCHET\s*:\s*COLOR_BULLET\s*,\s*1\s*\)/,
    );
  });
});

describe('render-integration — render→sim decoupling (ArenaScene.update)', () => {
  const arenaSrc = readSrc('./ArenaScene.js');

  it('advances the sim only through this.fixedTimestep.advance(delta, ...)', () => {
    expect(arenaSrc).toMatch(/this\.fixedTimestep\.advance\(\s*delta\s*,/);
  });

  it('steps the world exactly once, and only inside the gameOver-gated callback', () => {
    // The load-bearing decoupling guard: a second, direct `world.fixedUpdate`
    // call added to update() (stepping the sim from the render loop) would push
    // this count above 1 and fail. The lone call must be the gameOver-gated form
    // fed the fixed step `dt` — never `delta`, never on game over.
    const occurrences = arenaSrc.match(/this\.world\.fixedUpdate\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(arenaSrc).toMatch(
      /if\s*\(\s*!this\.playerState\.gameOver\s*&&\s*!this\.levelUpSystem\.selectionActive\s*\)[\s\S]{0,120}?this\.world\.fixedUpdate\(\s*dt\s*\)/,
    );
  });
});

describe('render-integration — level-up moment wiring (ArenaScene, Story 8.3)', () => {
  // Pins the load-bearing Story 8.3 level-up glue in ArenaScene. The scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the touch / reduced-
  // motion / black-hole checks — these are SOURCE-TEXT assertions. The sim-side state
  // machine (LevelUpSystem) carries its own unit coverage; these guard the three
  // render-loop seams that would silently regress the moment if reverted.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('VG1: hard-freezes an offer, processes only modal actions, and resumes next frame', () => {
    expect(arenaSrc).toMatch(
      /const\s+selectionWasActive\s*=\s*this\.levelUpSystem\.selectionActive/,
    );
    expect(arenaSrc).toMatch(/if\s*\(\s*selectionWasActive\s*\)[\s\S]{0,700}?processModalActions\(\)/);
    expect(arenaSrc).toMatch(/else if\s*\(\s*!selectionWasActive\s*\)[\s\S]{0,500}?fixedTimestep\.advance/);
    expect(arenaSrc).not.toMatch(/LEVELUP_TIME_SCALE/);
  });

  it('VG2: suppresses gameplay input while the overlay is open (clear + drop bomb after sample)', () => {
    // While selectionActive, the sampled input is cleared and any queued bomb dropped
    // so the ship idles and nav keys never steer it. Dropping this block would let the
    // ship fly / fire under the modal.
    expect(arenaSrc).toMatch(
      /if\s*\(\s*selectionWasActive\s*\)\s*\{\s*this\.inputState\.clear\(\)\s*;\s*this\.inputState\.consumeBomb\(\)\s*;/,
    );
  });

  it('VG3: suppresses only ENTERING pause during a selection, never resuming (no soft-lock)', () => {
    // The guard must be `selectionActive && !this._paused` so a forced pause mid-
    // selection can still be resumed (a bare `selectionActive` guard would deadlock:
    // a paused sim never drains the pending pick).
    expect(arenaSrc).toMatch(
      /if\s*\(\s*this\.levelUpSystem\.selectionActive\s*&&\s*!this\._paused\s*\)\s*return/,
    );
  });

  it('VG4: ordering — the input-suppression clear runs AFTER inputSampler.sample()', () => {
    // VG2 alone only asserts the clear block EXISTS; hoisting it above sample() would
    // still match VG2 yet let sample() re-populate the intent AFTER the clear, so the
    // ship would steer under the modal. Pin that sample() precedes the clear block.
    expect(arenaSrc).toMatch(
      /this\.inputSampler\.sample\(\)[\s\S]{0,600}?const\s+selectionWasActive[\s\S]{0,120}?if\s*\(\s*selectionWasActive\s*\)\s*\{\s*this\.inputState\.clear\(\)/,
    );
  });

  it('VG1b: suppresses catch-up steps after an offer opens and resets the accumulator', () => {
    expect(arenaSrc).toMatch(
      /!this\.playerState\.gameOver\s*&&\s*!this\.levelUpSystem\.selectionActive/,
    );
    expect(arenaSrc).toMatch(
      /if\s*\(\s*this\.levelUpSystem\.selectionActive\s*\)\s*selectionOpenedDuringAdvance\s*=\s*true/,
    );
    expect(arenaSrc).toMatch(
      /if\s*\(\s*selectionOpenedDuringAdvance\s*\)\s*this\.fixedTimestep\.reset\(\)/,
    );
  });

  it('VG1c: creates persistent level/description text and renders the next authored rung', () => {
    expect(arenaSrc).toMatch(/this\._cardLevelTexts\s*=\s*this\._cardRects\.map/);
    expect(arenaSrc).toMatch(/this\._cardDescTexts\s*=\s*this\._cardRects\.map/);
    expect(arenaSrc).toMatch(/const\s+nextRung\s*=\s*Array\.isArray\(offer\[i\]\.levels\)[\s\S]{0,100}?offer\[i\]\.levels\[ownedLevel\]/);
    expect(arenaSrc).toMatch(/'NEW • Lv 1'/);
    expect(arenaSrc).toMatch(/`Lv \$\{ownedLevel\} → \$\{ownedLevel \+ 1\}`/);
    expect(arenaSrc).toMatch(/typeof\s+nextRung\?\.desc\s*===\s*'string'/);
    expect(arenaSrc).toMatch(/fusion\.fusionPartnerItemId\s*\|\|\s*fuseRecipe\?\.partnerItemId/);
    expect(arenaSrc).toMatch(/'Combine mastered items into an Epic power\.'/);
  });

  it('VG1d: queries fusion readiness through the exported module API', () => {
    expect(arenaSrc).toMatch(
      /import\s*\{\s*getReadyFusion\s*\}\s*from\s*['"]\.\.\/systems\/fusionSystem\.js['"]/,
    );
    expect(arenaSrc).toMatch(/\?\s*getReadyFusion\(this\.progressionState,/);
    expect(arenaSrc).not.toMatch(/this\.fusionSystem\.getReadyFusion\(/);
  });

  it('VG5: hides the whole level-up overlay on the paused early-return (no stacked modal)', () => {
    // A forced pause can fire mid-selection; without this hide the card modal renders
    // stacked UNDER the PAUSED overlay. Dropping the sequence re-introduces that stack.
    // The FULL overlay is five element groups — the four singletons AND the three card
    // titles (a Text per card): pin all of them, or a dropped title loop leaves the
    // card titles floating over the PAUSED screen while the rest correctly hides.
    expect(arenaSrc).toMatch(
      /this\.levelUpOverlay\.setVisible\(false\);\s*this\.levelUpHeading\.setVisible\(false\);\s*this\.cardPanelGraphics\.setVisible\(false\);\s*this\.levelUpPrompt\.setVisible\(false\)/,
    );
    expect(arenaSrc).toMatch(
      /for\s*\([\s\S]{0,80}?this\.cardTitles\.length[\s\S]{0,80}?this\.cardTitles\[i\]\.setVisible\(false\)/,
    );
    expect(arenaSrc).toMatch(/this\._cardLevelTexts\[i\]\.setVisible\(false\)/);
    expect(arenaSrc).toMatch(/this\._cardDescTexts\[i\]\.setVisible\(false\)/);
  });

  it('VG6: arms + gates + decays a confirm-grace so an in-flight confirm cannot instant-pick on open', () => {
    // The overlay-open / fresh-offer edge (re)arms _cardConfirmGraceMs, every confirm
    // path returns while it is > 0, AND it decays by delta each frame back to 0.
    // Removing the arm or the gate re-introduces the instant-auto-pick; removing the
    // DECAY pins the grace > 0 forever, so every confirm early-returns, the pick never
    // drains, and selectionActive sticks true — a permanent soft-lock with tests green.
    expect(arenaSrc).toMatch(
      /this\._cardConfirmGraceMs\s*=\s*LEVELUP_CONFIRM_GRACE_MS/,
    );
    expect(arenaSrc).toMatch(
      /if\s*\(\s*this\._cardConfirmGraceMs\s*>\s*0\s*\)\s*return/,
    );
    expect(arenaSrc).toMatch(
      /this\._cardConfirmGraceMs\s*-=\s*delta/,
    );
  });

  it('VG7: resets card focus to 0 on the overlay-open / fresh-offer edge (no stale focus)', () => {
    // Focus must reset on the false→true rise and on a fresh offer mid multi-level jump,
    // else a stale _cardFocus carries across overlays / picks.
    expect(arenaSrc).toMatch(
      /if\s*\(\s*roseActive\s*\|\|\s*freshOffer\s*\)\s*\{\s*this\._cardFocus\s*=\s*0/,
    );
  });

  it('VG8: reconciles held touch on the overlay CLOSE edge (no stranded stick on resume)', () => {
    // A card tap shares pointerdown with the twin-stick sampler; a finger still held
    // when the overlay closes leaves a stick anchored (masked only while selectionActive).
    // The true→false edge must resetTouch, mirroring the pause-edge reconcile.
    expect(arenaSrc).toMatch(
      /const\s+fellActive\s*=\s*!cardsOpen\s*&&\s*this\._wasSelectionActive;\s*if\s*\(\s*fellActive\s*\)\s*\{\s*this\.inputSampler\.resetTouch\(\)/,
    );
  });

  it('VG9: gamepad confirm is restricted to face buttons (indices 0..3), not any button', () => {
    // A prior regression let ANY pad button confirm card 0. Confirm must be gated to the
    // face-button index range so d-pad/stick stay free to navigate.
    expect(arenaSrc).toMatch(/if\s*\(\s*idx\s*>=\s*0\s*&&\s*idx\s*<=\s*3\s*\)/);
  });

  it('VG10: every card/action input handler is a no-op while paused (no blind pick on refocus)', () => {
    // A forced pause (blur/backgrounding, desktop web included) can fire mid-selection
    // with the overlay hidden but these event listeners still live. Without the pause
    // guard, a window-refocus pointerdown (by click position, not focus) inside a now-
    // invisible card rect — or a resume-reflex confirm — silently latches a blind pick
    // applied on resume. Every handler must gate on `selectionActive || this._paused`.
    // The five card handlers (nav L/R, keyboard confirm, gamepad down, card pointerdown)
    // PLUS the three Story 8.5 handlers (keyboard reroll, keyboard banish, action-rect
    // pointerdown) → eight guarded handlers. Pin all eight.
    const guards = arenaSrc.match(
      /if\s*\(\s*!this\.levelUpSystem\.selectionActive\s*\|\|\s*this\._paused\s*\)\s*return/g,
    );
    expect(guards).not.toBeNull();
    expect(guards.length).toBe(8);
  });

  it('VG11: keyboard R maps to reroll and B maps to focused banish (not swapped)', () => {
    // A silent R↔B swap would pass every behavioral test but make the player banish when
    // intending to reroll. Pin the key→action direction at the source (VG9-style): the
    // keydown-R binding drives cardReroll (whose body calls queueReroll), and keydown-B
    // drives cardBanish (whose body calls queueBanish(this._cardFocus)).
    expect(arenaSrc).toMatch(/keydown-R['"]\s*,\s*cardReroll/);
    expect(arenaSrc).toMatch(/const\s+cardReroll\s*=[\s\S]*?queueReroll\(\)/);
    expect(arenaSrc).toMatch(/keydown-B['"]\s*,\s*cardBanish/);
    expect(arenaSrc).toMatch(
      /const\s+cardBanish\s*=[\s\S]*?queueBanish\(this\._cardFocus\)/,
    );
  });

  it('VG12: gamepad shoulder LB(4) maps to banish and RB(5) to reroll (not swapped)', () => {
    // Same anti-swap pin for the pad shoulders: index 4 (LB) banishes the focused card,
    // index 5 (RB) rerolls. A 4↔5 swap passes behavior but inverts the controls.
    expect(arenaSrc).toMatch(
      /idx === 4\)\s*\{\s*this\.levelUpSystem\.queueBanish\(this\._cardFocus\)/,
    );
    expect(arenaSrc).toMatch(
      /idx === 5\)\s*\{\s*this\.levelUpSystem\.queueReroll\(\)/,
    );
  });

  it('VG13: per-card touch banish glyph targets the TAPPED card index and short-circuits the pick', () => {
    // The glyph is the ONLY touch path that can banish a SPECIFIC card (the focus-based
    // path always hits slot 0 on a fresh trio). A silent regression to queueBanish(this.
    // _cardFocus) — matching the keyboard/gamepad idiom — would make every touch banish hit
    // the focused slot instead of the tapped card, defeating the feature while VG11/VG12
    // (keyboard/gamepad only) still pass. Pin the glyph loop to queueBanish(i) (the loop
    // index) AND the short-circuit `return`, so a glyph tap can never also commit a pick.
    expect(arenaSrc).toMatch(
      /_cardBanishRects\[i\][\s\S]*?queueBanish\(i\)[\s\S]*?return/,
    );
  });

  it('VG14: action-row touch latches ONLY reroll; the bottom Banish button is not pointer-hittable', () => {
    // The bottom Banish button banishes the FOCUSED slot, which a touch player cannot aim
    // without also committing a pick — so it would always waste a charge on slot 0. It is
    // deliberately skipped in the action-rect pointerdown (`r.kind !== 'reroll'` continue),
    // leaving the per-card glyph as the touch banish path. Dropping that filter re-opens the
    // exact wasted-charge bug. Pin the skip AND that the reroll rect drives queueReroll().
    expect(arenaSrc).toMatch(/r\.kind !== 'reroll'\)\s*continue/);
    expect(arenaSrc).toMatch(/_actionRects[\s\S]*?queueReroll\(\)/);
  });

  // --- Story 10.1: the VARIABLE-LENGTH offer render contract -------------------
  // The offer is no longer always exactly CARD_OFFER_SIZE: it is SHORT (2 or 1) when
  // fewer items are eligible and EMPTY when none are — reachable in normal play with the
  // two starting banish charges against the 4-item registry. Three render-side sites must
  // bound on the LIVE offer length; all three are Phaser-coupled, so they are pinned here
  // at the source like VG1-VG14.

  it('VG15: card focus wraps against the LIVE offer length, never a hardcoded 3', () => {
    // A revert to `(this._cardFocus + dir + 3) % 3` leaves focus on an unrendered panel of
    // a 2-card offer: no panel highlights, and confirm calls queueSelection(2), which the
    // sim guard-no-ops — the player presses confirm and nothing happens, silently.
    expect(arenaSrc).toMatch(
      /const len = this\.levelUpSystem\.currentOffer\.length;[\s\S]{0,160}?_cardFocus = \(this\._cardFocus \+ dir \+ len\) % len/,
    );
    // The load-bearing negative: no modulo against a literal 3 in the card-nav path.
    expect(arenaSrc).not.toMatch(/_cardFocus \+ dir \+ 3\) % 3/);
    // And the empty-offer guard, so `% 0` can never yield NaN focus.
    expect(arenaSrc).toMatch(/if \(len <= 0\) return;/);
  });

  it('VG16: both overlay pointer hit-test loops clamp to the live offer length', () => {
    // _cardRects / _cardBanishRects are a fixed 3. Reverting `shown` to
    // `this._cardRects.length` lets a tap in a hidden short-offer panel set _cardFocus and
    // latch an out-of-range select (sim-guarded no-op) or short-circuit the banish path —
    // either way the tap is swallowed and every visible panel loses focus.
    expect(arenaSrc).toMatch(
      /const shown = Math\.min\(\s*this\._cardRects\.length,\s*this\.levelUpSystem\.currentOffer\.length,?\s*\)/,
    );
    // BOTH loops (banish glyphs first, then card rects) must bound on `shown`.
    expect(arenaSrc.match(/for \(let i = 0; i < shown; i\+\+\)/g) || []).toHaveLength(2);
  });

  it('VG17: the card-panel render gates each panel on i < offer.length', () => {
    // Previously unreachable dead-safety (the offer was ALWAYS three); Story 10.1 makes it
    // load-bearing. Dropping the `i < offer.length` half is now a hard crash, not a
    // cosmetic slip: title.setText(offer[i].title) throws every frame a short offer is open.
    expect(arenaSrc).toMatch(
      /const shown = cardsOpen && i < offer\.length;[\s\S]{0,160}?if \(!shown\) continue;/,
    );
  });

  it('VG18: ordinary card states use dark palette constants and a non-color focus cue', () => {
    expect(arenaSrc).toMatch(
      /focused\s*\?\s*COLOR_LEVELUP_PANEL_FOCUS\s*:\s*COLOR_LEVELUP_PANEL/,
    );
    expect(arenaSrc).toMatch(
      /focused\s*\?\s*LEVELUP_PANEL_FOCUS_ALPHA\s*:\s*LEVELUP_PANEL_ALPHA/,
    );
    expect(arenaSrc).toMatch(
      /focused\s*\?\s*LEVELUP_PANEL_FOCUS_BORDER_WIDTH\s*:\s*LEVELUP_PANEL_BORDER_WIDTH/,
    );
    expect(arenaSrc).toMatch(/title\.setColor\(COLOR_LEVELUP_TEXT\)/);
    expect(arenaSrc).toMatch(/levelText\.setColor\(COLOR_LEVELUP_TEXT\)/);
    expect(arenaSrc).toMatch(/desc\.setColor\(COLOR_LEVELUP_TEXT\)/);
  });

  it('VG19: Fusion cards retain gold fill, wider border, Epic label, and fallback copy', () => {
    expect(arenaSrc).toMatch(/if\s*\(isFusion\)[\s\S]{0,180}?fillStyle\(COLOR_FUSION_GOLD,\s*0\.25\)/);
    expect(arenaSrc).toMatch(/const borderW = focused \? 5 : 3/);
    expect(arenaSrc).toContain("levelText.setText('EPIC FUSION')");
    expect(arenaSrc).toContain("'Combine mastered items into an Epic power.'");
  });
});

describe('render-integration — touch twin-stick wiring (ArenaScene, Story 7.1)', () => {
  // Pins the load-bearing Story 7.1 touch glue in ArenaScene. This scene is
  // Phaser-coupled and cannot be imported headlessly, so — like the reduced-motion /
  // black-hole / mirror-reflector checks above — these are SOURCE-TEXT assertions.
  // The touch model, sampler, and overlay helper carry their own unit coverage
  // (touchControls / PlayerInputSampler / touchOverlay tests); these guard only the
  // three scene-boundary wirings those units cannot reach: the idempotent multi-touch
  // pointer-pool raise, the pause-edge touch reconciliation, and the render-frame
  // overlay draw/clear gate.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('raises the game-global touch-pointer pool idempotently to a fixed target of 3', () => {
    // addPointer is cumulative and the pool survives scene.restart, so create()
    // re-running on each game-over→restart must add only the shortfall (never an
    // unconditional addPointer(N) that would pile up to Phaser's cap of 10).
    expect(arenaSrc).toMatch(/const\s+TOUCH_POINTER_TARGET\s*=\s*3;/);
    expect(arenaSrc).toMatch(
      /const\s+touchPointerShortfall\s*=\s*TOUCH_POINTER_TARGET\s*-\s*this\.input\.manager\.pointersTotal;/,
    );
    expect(arenaSrc).toMatch(
      /if\s*\(\s*touchPointerShortfall\s*>\s*0\s*\)\s*\{\s*this\.input\.addPointer\(\s*touchPointerShortfall\s*\);\s*\}/,
    );
  });

  it('reconciles held touch state on the pause edge (clear overlay + resetTouch, then return)', () => {
    // The sampler's touch listeners are frozen while paused, so a finger lifted
    // during a pause would otherwise strand a stick (ship drifts on resume) or a
    // bomb latched at the pause edge (detonates on resume). The pause early-return
    // must clear the overlay and call resetTouch() before bailing.
    //
    // The two calls must still be ADJACENT and still precede the return; Story 10.5
    // inserted the InputState dash drain between resetTouch() and that return (pinned
    // by its own test below), so the tail of this pattern allows that one statement.
    expect(arenaSrc).toMatch(
      /this\.touchOverlayGraphics\.clear\(\);\s*this\.inputSampler\.resetTouch\(\);[\s\S]{0,900}?return;/,
    );
  });

  it('gates the render-frame overlay draw on isTouchActive(), clearing it otherwise', () => {
    // Draw only while touch is the driving input; the else-branch clear covers the
    // frame touch ends and every non-touch frame, so a gamepad/kbm player never sees
    // a lingering overlay.
    expect(arenaSrc).toMatch(/if\s*\(\s*this\.inputSampler\.isTouchActive\(\)\s*\)\s*\{/);
    expect(arenaSrc).toMatch(
      /drawTouchOverlay\(\s*this\.touchOverlayGraphics,\s*this\.inputSampler\.touchSnapshot\(\),\s*TOUCH_OVERLAY_STYLE,?\s*\)/,
    );
    expect(arenaSrc).toMatch(/\}\s*else\s*\{\s*this\.touchOverlayGraphics\.clear\(\);\s*\}/);
  });
});

describe('render-integration — responsive mobile layout wiring (Story 7.2)', () => {
  // Pins the load-bearing Story 7.2 layout/orientation/safe-area glue across the
  // Phaser-coupled boundaries that unit tests cannot reach: the ArenaScene overlay
  // screen-anchor + the create/resize/shutdown layout wiring, the sampler's
  // screen-space touch feed, the BootScene landscape lock, and the index.html
  // viewport-fit=cover meta (without which env(safe-area-inset-*) is never reported).
  // The pure math + injectable boundaries carry their own unit coverage in
  // mobileLayout.test.js; these guard only that the app actually calls into them.
  const arenaSrc = readSrc('./ArenaScene.js');
  const bootSrc = readSrc('./BootScene.js');
  const samplerSrc = readSrc('../input/PlayerInputSampler.js');
  const indexHtml = readSrc('../../index.html');

  it('index.html sets viewport-fit=cover so env(safe-area-inset-*) is reported', () => {
    expect(indexHtml).toMatch(
      /<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*"\s*\/?>/,
    );
  });

  it('screen-anchors the touch overlay with setScrollFactor(0)', () => {
    // Paired with the sampler's pointer.x/y feed below, this keeps the overlay
    // shake-stable — the two changes are a package (one without the other regresses).
    expect(arenaSrc).toMatch(/this\.touchOverlayGraphics\.setScrollFactor\(\s*0\s*\)/);
  });

  it('feeds the touch model screen-space pointer.x/y (not worldX/worldY)', () => {
    expect(samplerSrc).toMatch(
      /this\.touch\.onPointerDown\(\s*pointer\.id\s*,\s*pointer\.x\s*,\s*pointer\.y\s*\)/,
    );
    expect(samplerSrc).toMatch(
      /this\.touch\.onPointerMove\(\s*pointer\.id\s*,\s*pointer\.x\s*,\s*pointer\.y\s*\)/,
    );
    // Mouse aim deliberately STAYS on worldX/worldY (arena-logical) — the overlay
    // change must not have swept the mouse-aim path onto screen space.
    expect(samplerSrc).toMatch(/p\.worldX\s*-\s*this\.ship\.x/);
  });

  it('applies the mobile layout at create() and re-applies on every scale resize', () => {
    expect(arenaSrc).toMatch(/this\._applyMobileLayout\(\)/);
    expect(arenaSrc).toMatch(
      /this\.scale\.on\(\s*['"]resize['"]\s*,\s*this\._applyMobileLayout\s*,\s*this\s*\)/,
    );
  });

  it('_applyMobileLayout reads insets → logical → layout and positions HUD/debug/bomb', () => {
    // The seam is called with the injected browser boundaries and its result drives
    // the three UI placements. The composition args are pinned exactly so an arg swap
    // or transpose (e.g. parentH/parentW, or the arena dims out of order) fails here.
    expect(arenaSrc).toMatch(/readSafeAreaInsetsCss\(\s*document\s*,/);
    // The display size feeding the letterbox comes from the single-frame resolver
    // (parentSize else window, both axes together) — pin that the scene routes through
    // it rather than reading parentSize per-axis, so the mixed-frame regression can't
    // return here. The resolver's frame-selection logic is unit-tested in mobileLayout.test.js.
    expect(arenaSrc).toMatch(/resolveDisplaySize\(\s*this\.scale\.parentSize\s*,\s*window\s*\)/);
    expect(arenaSrc).toMatch(
      /logicalSafeInsets\(\s*insetsCss\s*,\s*parentW\s*,\s*parentH\s*,\s*ARENA_WIDTH\s*,\s*ARENA_HEIGHT\s*\)/,
    );
    expect(arenaSrc).toMatch(/computeMobileLayout\(\s*logical\s*\)/);
    // Debug reposition (inside the DEV gate in _applyMobileLayout) — assert the
    // source string; the DEV gate itself is pinned by buildConfig.test.js.
    expect(arenaSrc).toMatch(
      /this\.debugText\.setPosition\(\s*layout\.debug\.x\s*,\s*layout\.debug\.y\s*\)/,
    );
    expect(arenaSrc).toMatch(/this\.hudText\.setPosition\(\s*layout\.hud\.x\s*,\s*layout\.hud\.y\s*\)/);
    expect(arenaSrc).toMatch(
      /this\.inputSampler\.setBombButton\(\s*layout\.bomb\.x\s*,\s*layout\.bomb\.y\s*,\s*layout\.bomb\.radius\s*\)/,
    );
    // Story 10.5: the dash button gets the SAME layout push the bomb does. The bomb's
    // line has always been pinned here; the dash's originally was not, and deleting it
    // left the whole suite green. This assertion is what makes that impossible.
    expect(arenaSrc).toMatch(
      /this\.inputSampler\.setDashButton\(\s*layout\.dash\.x\s*,\s*layout\.dash\.y\s*,\s*layout\.dash\.radius\s*\)/,
    );
  });

  it('pushes the dash button OWNERSHIP GATE every render frame (Story 10.5)', () => {
    // A per-frame push, not a one-shot at create: the dash is unlocked MID-RUN by a
    // card pick, so the button must appear the moment the fold grants it. Deleting
    // this line would silently strand every touch player at "no dash button, ever".
    expect(arenaSrc).toMatch(
      /this\.inputSampler\.setDashEnabled\(\s*this\.dashSystem\.dashEnabled\(\)\s*\)/,
    );
    // …and the handle it reads is assigned from the factory return.
    expect(arenaSrc).toMatch(/this\.dashSystem\s*=\s*arena\.dashSystem/);
  });

  it('drains the DASH latch at the PAUSE edge too (Story 10.5)', () => {
    // resetTouch() clears only the TouchControls model latch; once sample() has copied
    // a press into inputState.dashQueued, nothing else drains it. Without this line a
    // dash latched on a frame that produced zero fixed steps, then paused, fires the
    // instant the run resumes and burns the whole cooldown.
    expect(arenaSrc).toMatch(
      /this\.inputSampler\.resetTouch\(\);[\s\S]{0,900}?this\.inputState\.consumeDash\(\);[\s\S]{0,40}?return;/,
    );
  });

  it('drains the DASH latch alongside the bomb under the level-up modal (Story 10.5)', () => {
    // `inputState.clear()` deliberately clears only the continuous move/aim levels, so
    // without an explicit consumeDash a dash queued under the card overlay would fire
    // the instant the overlay closed.
    expect(arenaSrc).toMatch(
      /this\.inputState\.consumeBomb\(\);[\s\S]{0,400}?this\.inputState\.consumeDash\(\)/,
    );
  });

  it('removes the resize listener on shutdown (no cross-restart leak)', () => {
    expect(arenaSrc).toMatch(
      /this\.scale\.off\(\s*['"]resize['"]\s*,\s*this\._applyMobileLayout\s*,\s*this\s*\)/,
    );
  });

  it('BootScene requests a best-effort landscape lock at boot before starting Preload', () => {
    // Bind the guarded screen.orientation argument shape: a regression to
    // lockLandscape(screen) would silently disable the lock (the seam expects the
    // orientation, not the screen) while a bare /lockLandscape\(/ pin stayed green.
    expect(bootSrc).toMatch(
      /lockLandscape\(\s*typeof\s+screen\s*!==\s*['"]undefined['"]\s*\?\s*screen\.orientation\s*:\s*null\s*\)/,
    );
    // Ordered before the PreloadScene handoff.
    expect(bootSrc).toMatch(
      /lockLandscape\([\s\S]*?screen\.orientation[\s\S]*?\)[\s\S]*?this\.scene\.start\(\s*['"]PreloadScene['"]\s*\)/,
    );
  });
});

describe('render-integration — native feel + keep-awake wiring (ArenaScene, Story 7.5)', () => {
  // Pins the load-bearing Story 7.5 haptic + keep-awake glue in ArenaScene. This scene
  // is Phaser-coupled and cannot be imported headlessly, so — like the reduced-motion /
  // touch checks above — these are SOURCE-TEXT assertions. The pure decisions
  // (decideKeepAwake) and the fail-safe boundaries (pulseHaptic / acquire/releaseWakeLock)
  // carry their own unit coverage; the on-device buzz + screen wake are the disclosed
  // manual boundary, so these guard only that the scene wires them correctly.
  const arenaSrc = readSrc('./ArenaScene.js');

  it('drains the haptic pulses each frame through a stable bound sink', () => {
    expect(arenaSrc).toMatch(
      /this\.screenFeedbackSystem\.drainHapticPulses\(\s*this\._drainHapticSink\s*\)/,
    );
  });

  it('suppresses the haptic pulse under reduced motion at the output layer only', () => {
    // The always-drained sink routes through the pure emitHaptic gate (unit-tested in
    // nativeFeel.test.js), which fires the Haptics boundary ONLY when reduced motion is
    // off — mirrors the shake/flash output-layer suppression; the drain still empties.
    expect(arenaSrc).toMatch(
      /emitHaptic\(\s*this\._reducedMotion\s*,\s*Haptics\s*,\s*style\s*\)/,
    );
  });

  it('edge-triggers keep-awake via decideKeepAwake, tracking the display-awake boolean', () => {
    // Desired-awake is computed each frame from a REUSED scratch object (no per-frame
    // allocation); the wake lock is acquired/released ONLY on the boolean flip.
    expect(arenaSrc).toMatch(/decideKeepAwake\(\s*keepAwakeState\s*\)/);
    expect(arenaSrc).toMatch(/if\s*\(\s*desiredAwake\s*!==\s*this\._displayAwake\s*\)/);
    expect(arenaSrc).toMatch(/acquireWakeLock\(/);
    expect(arenaSrc).toMatch(/releaseWakeLock\(\s*this\._wakeSentinel\s*\)/);
    // Bind the acquire to the desired-awake arm AND pin the involuntary-release
    // recovery arg (Story 7.5 follow-up review, verification-gap): dropping
    // `this._onWakeLockReleased` silently kills the thermal/battery-saver re-acquire,
    // and swapping the acquire/release branches makes the screen sleep during play and
    // stay lit while paused — the loose `acquireWakeLock(` pin above catches neither.
    expect(arenaSrc).toMatch(
      /if\s*\(\s*desiredAwake\s*\)\s*\{[\s\S]*?acquireWakeLock\([\s\S]*?this\._onWakeLockReleased[\s\S]*?\}\s*else\s*\{[\s\S]*?releaseWakeLock\(\s*this\._wakeSentinel\s*\)/,
    );
  });

  it('setPaused runs the render-juice settle on the enter-pause edge only', () => {
    // Story 7.5 follow-up review (verification-gap): setPaused is the SOLE pause entry
    // point — the keyboard handler and the native background/back-button controller both
    // route through it — and its job is to zero the flash/shake/camera so a mid-bomb
    // background pause doesn't freeze a near-white overlay / held camera offset on the
    // PAUSED screen. ArenaScene is Phaser-coupled (cannot be imported headlessly), so —
    // per this file's source-text convention — pin the settle here: deleting any of the
    // resets, or ungating them from `if (paused)`, must fail this test.
    expect(arenaSrc).toMatch(
      /setPaused\(\s*paused\s*\)\s*\{[\s\S]*?if\s*\(\s*paused\s*\)\s*\{[\s\S]*?this\._flashMs\s*=\s*0[\s\S]*?this\._trauma\s*=\s*0[\s\S]*?cameras\.main\.scrollX\s*=\s*0[\s\S]*?cameras\.main\.scrollY\s*=\s*0/,
    );
  });

  it('releases the wake lock on scene shutdown (no cross-restart leak)', () => {
    // The shutdown handler (which also disposes audio + drops the resize listener)
    // releases the sentinel so a lock held during play never leaks across a restart.
    expect(arenaSrc).toMatch(
      /once\(\s*['"]shutdown['"][\s\S]*?releaseWakeLock\(\s*this\._wakeSentinel\s*\)/,
    );
  });
});

describe('render-integration — native lifecycle controller wiring (main.js, Story 7.5)', () => {
  // Pins the main.js lifecycle glue: it cannot be imported headlessly (constructs a
  // new Phaser.Game at load), so these are SOURCE-TEXT assertions. The controller's
  // FR23 branch logic now lives (and is unit-tested) in makeLifecycleController; these
  // guard only that main.js captures the game, builds the controller, wires it, and
  // never reaches for an abrupt-close.
  const mainSrc = readSrc('../main.js');

  it('captures the game and builds + wires the lifecycle controller', () => {
    expect(mainSrc).toMatch(/const\s+game\s*=\s*new\s+Phaser\.Game\(\s*config\s*\)/);
    expect(mainSrc).toMatch(/makeLifecycleController\(\s*game\s*,\s*App\s*\)/);
    expect(mainSrc).toMatch(/wireNativeLifecycle\(\s*\{/);
  });

  it('imports the Capacitor App plugin and never reaches for an abrupt close', () => {
    expect(mainSrc).toMatch(/import\s*\{\s*App\s*\}\s*from\s*['"]@capacitor\/app['"]/);
    // The load-bearing negative: the app is NEVER abruptly closed from the entry point.
    expect(mainSrc).not.toContain('exitApp');
  });
});
