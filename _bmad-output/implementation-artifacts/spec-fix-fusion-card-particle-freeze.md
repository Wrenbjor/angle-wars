---
title: 'Fix Fusion Card Particle Freeze'
type: 'bugfix'
created: '2026-08-01'
status: 'done'
route: 'one-shot'
context: []
---

# Fix Fusion Card Particle Freeze

## Intent

**Problem:** Opening a fresh fusion upgrade offer threw a `ReferenceError` for missing particle constant bindings, terminating Phaser's render loop and making the Android game appear hard-frozen.

**Approach:** Import every burst constant consumed by the fusion-card aura and pin the scene boundary with a comment-resistant, order-independent integration regression.

## Suggested Review Order

**Runtime correction**

- Bind the particle constants before the fusion-card render path can execute.
  [`ArenaScene.js:57`](../../src/scenes/ArenaScene.js#L57)

- Fusion aura calculations now resolve all speed and lifetime inputs.
  [`ArenaScene.js:2017`](../../src/scenes/ArenaScene.js#L2017)

**Regression coverage**

- Guard actual import bindings and uncommented uses without enforcing import order.
  [`renderIntegration.test.js:499`](../../src/scenes/renderIntegration.test.js#L499)
