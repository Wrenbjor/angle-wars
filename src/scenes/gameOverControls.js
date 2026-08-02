// Phaser-free game-over control seam. Keeping the geometry and hit test as plain
// data makes touch routing deterministic and independently testable.

export const GAME_OVER_ACTION = Object.freeze({
  RESTART: 'restart',
  TITLE: 'title',
});

/**
 * Return the named action under a logical arena point, or null outside both
 * buttons. Bounds are inclusive so taps exactly on a visible edge still land.
 * @param {number} x
 * @param {number} y
 * @param {Array<{action:string,x:number,y:number,width:number,height:number}>} controls
 * @returns {'restart'|'title'|null}
 */
export function hitTestGameOverControls(x, y, controls) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(controls)) return null;

  for (let i = 0; i < controls.length; i++) {
    const control = controls[i];
    if (
      !Number.isFinite(control?.x) ||
      !Number.isFinite(control?.y) ||
      !Number.isFinite(control?.width) ||
      !Number.isFinite(control?.height) ||
      control.width <= 0 ||
      control.height <= 0
    ) continue;
    const halfW = control.width / 2;
    const halfH = control.height / 2;
    if (
      x >= control.x - halfW &&
      x <= control.x + halfW &&
      y >= control.y - halfH &&
      y <= control.y + halfH
    ) {
      return control.action === GAME_OVER_ACTION.RESTART || control.action === GAME_OVER_ACTION.TITLE
        ? control.action
        : null;
    }
  }
  return null;
}
