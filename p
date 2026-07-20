    // state; it never advances it. Zero per-frame allocation (mirrors the bullet
    // render). (Story 4.3)
    const ptg = this.particleGraphics;
    ptg.clear();
    this.particleSystem.pool.forEachActive((p) => {
      ptg.fillStyle(p.color, particleAlpha(p.ageMs, p.lifeMs));
      ptg.fillCircle(p.x, p.y, p.size);
    });

    // Sample sim ticks/sec roughly once per second so the readout is steady.
    // DEV-only: gated so a production build eliminates the sampling from the
    // per-frame path (mirrors the debug-text gate in create()).
    if (import.meta.env.DEV) {
      this._simRateSampler.update(delta, this.simClock.ticks);
    }

    // --- HUD + game-over overlay (render only; never advances the sim) -------
    // Read fresh each frame so a kill (score) or a death (lives) shows on the
    // very next frame.
    this.hudText.setText(
      `SCORE ${this.scoreState.score}\nMULT ${this.scoreState.multiplier}×\nBOMBS ${this.scoreState.bombs}\nLIVES ${this.playerState.lives}\nHIGH ${this.highScoreSystem.highScore}`,
    );

    const over = this.playerState.gameOver;
    this.gameOverOverlay.setVisible(over);
    this.gameOverTitle.setVisible(over);
    this.gameOverScore.setVisible(over);
    this.gameOverPrompt.setVisible(over);
    if (over) {
      // The frozen (final) score — stable because the sim no longer advances.
      this.gameOverScore.setText(`FINAL SCORE ${this.scoreState.score}`);
    }

    // DEV-only developer readout: the per-frame array + string build and setText
    // are gated so a production build tree-shakes them off the render path.
    if (import.meta.env.DEV) {
      const renderFps = Math.round(this.game.loop.actualFps);
      this.debugText.setText(
        [
          `render FPS : ${renderFps}`,
          `sim ticks/s: ${this._simRateSampler.ticksPerSec.toFixed(1)}  (target ${(1000 / FIXED_STEP_MS).toFixed(1)})`,
          `sim ticks  : ${this.simClock.ticks}`,
          `sim time   : ${(this.simClock.simTimeMs / 1000).toFixed(1)}s`,
        ].join('\n'),
      );
    }
  }
}
