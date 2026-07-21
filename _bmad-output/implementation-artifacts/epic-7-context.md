# Epic 7 Context: Mobile (Capacitor Shell & Touch Play)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the finished, shipped web game into a real, installable iOS/Android app without rewriting the game. The existing static Vite build is wrapped in a Capacitor native shell running inside the native WebView, on-screen twin-stick touch controls are added that plug into the existing input seam, the layout is made to respect phone screens (landscape lock, safe-area insets, thumb reach), a mobile performance profile keeps the bloom/grid/particle stack at framerate on a phone GPU, native lifecycle behaviors are wired in (auto-pause on background, hardware back, haptics, keep-awake), and store-submission scaffolding is laid down. This matters because it takes the game to phones — the largest audience — while preserving the twin-stick feel that defines it. The sequencing is spine-first within mobile: touch feel is the highest-risk, most game-defining piece, so it is built and proven in the browser before any native wrapping cost is incurred.

## Stories

- Story 7.1: Touch Twin-Stick Controls
- Story 7.2: Responsive Mobile Layout, Orientation & Safe Areas
- Story 7.3: Capacitor Native Shell and Device Build
- Story 7.4: Mobile Performance Profile
- Story 7.5: Native Lifecycle and Feel Integration
- Story 7.6: Store Release Scaffolding

## Requirements & Constraints

- On-screen dual thumbsticks: press-and-hold on the left half spawns a floating move stick at the thumb; the right half spawns a floating aim stick whose direction sets aim and whose held state auto-fires. Both feed normalized move/aim intent, clamped to the unit circle like an analog stick. An on-screen smart-bomb button latches exactly one bomb per tap regardless of hold duration.
- Touch must integrate as a new input method that hot-swaps to and from gamepad/keyboard/mouse without a restart and with no cross-device aim bleed. It must not require any changes to the movement, firing, or bomb systems — it only feeds the existing intent seam.
- Layout: lock to landscape; scale the WebGL canvas to the device aspect ratio while preserving the arena's playable aspect. HUD and touch controls must respect device safe-area insets (notches, rounded corners, home indicator) via `env(safe-area-inset-*)` and never occlude the ship, score, lives, multiplier, or bomb HUD. Controls must sit within comfortable thumb reach.
- Native shell: wrap the production Vite build (`dist`) with Capacitor pointed at that output; generate clean-building iOS (Xcode) and Android (Android Studio) projects; a full run (title → play → game over → restart) must work end to end inside the native WebView with touch controls active.
- Mobile performance: detect mobile/WebView at init and apply a quality profile that scales particle caps, bloom cost, and grid resolution down from desktop defaults, introducing no new per-frame allocation. Must hold the mobile framerate target under peak load (max enemies, particles, bombs, bloom, grid warp) on a mid-range phone GPU without sustained hitching.
- Native lifecycle: auto-pause when backgrounded or on focus loss so the player never dies while away, resuming cleanly; map the Android hardware back button to pause/resume or a safe exit-confirm (never an abrupt close); fire short haptic pulses on death, bomb, and extra life where supported; keep the display awake during an active run and release keep-awake outside of play.
- Store readiness: app icons and splash screens across required iOS/Android densities; correct orientation, display name, bundle/app id, and permission manifests for both stores; documented signing/build config that yields store-uploadable artifacts.
- In-app purchases and ads are explicitly out of scope. This epic delivers only the installable, store-submittable shell they later bolt onto.

## Technical Decisions

- Capacitor is the native wrapper (chosen for its plugin ecosystem, active maintenance, and Xcode/Android Studio project generation) — deliberately over alternatives, in part to make later IAP/ads straightforward.
- Reuse existing systems rather than rebuild: the input intent seam for controls, the pause system for auto-pause, the centralized quality/feel constants for the mobile profile, and localStorage for settings persistence. The mobile quality profile must compose with the existing Reduced-Motion and quality settings and persist across sessions.
- Haptics must be suppressed when Reduced Motion / the relevant feel setting is off — the native feel layer respects the accessibility settings.
- Touch is added purely as an input source: normalized move/aim/bomb intent written into the existing seam, with zero changes to downstream gameplay systems, honoring the clean/extensible entity-system architecture.
- Native lifecycle uses Capacitor `App` state plus `visibilitychange` for background detection, Capacitor Haptics for pulses, and a keep-awake plugin during play.

## UX & Interaction Patterns

- Floating (not fixed) thumbsticks: each stick materializes at the point of first touch on its screen half, so the player never reaches for a fixed pad. Left half = move, right half = aim; holding the aim stick auto-fires in that direction, independent of movement.
- The bomb button is a discrete latched tap, distinct from the continuous stick gestures.
- Controls and HUD are laid out inside the safe area and positioned for thumb reach without covering critical play space.

## Cross-Story Dependencies

- Depends on the finished web build and prior epics: the production Vite build and pooling/performance work (Epic 5, incl. Story 5.5), the pause system (Story 5.2), the smart-bomb seam (Story 3.2), and the Reduced-Motion / quality settings and persistence (Stories 6.1 and 5.3).
- Within the epic, Story 7.1 (touch controls) is sequenced first and is browser-testable so the twin-stick feel is proven before any native wrapping. Story 7.3 (Capacitor shell) depends on the production build and brings 7.1's controls into the WebView. Stories 7.4, 7.5, and 7.6 layer performance, lifecycle/feel, and store scaffolding onto the working native shell.
