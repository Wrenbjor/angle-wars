import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  MENU_CONTROL_MIN_HEIGHT,
} from '../config/constants.js';

export const MENU_ACTIONS = Object.freeze({
  PLAY: 'play',
  SETTINGS: 'settings',
  VOLUME_DOWN: 'volume-down',
  VOLUME_UP: 'volume-up',
  MUTE: 'mute',
  FULLSCREEN: 'fullscreen',
  REDUCED_MOTION: 'reduced-motion',
  BACK: 'back',
});

const ACTIONS = new Set(Object.values(MENU_ACTIONS));

export function isMenuAction(value) {
  return ACTIONS.has(value);
}

export function titleControlLayout() {
  return [
    { action: MENU_ACTIONS.PLAY, label: 'PLAY', x: ARENA_WIDTH / 2, y: 385, width: 360, height: 64 },
    { action: MENU_ACTIONS.SETTINGS, label: 'SETTINGS', x: ARENA_WIDTH / 2, y: 470, width: 360, height: 64 },
  ];
}

export function settingsControlLayout() {
  const cx = ARENA_WIDTH / 2;
  return [
    { action: MENU_ACTIONS.VOLUME_DOWN, label: '−', x: cx - 230, y: 180, width: 72, height: 56 },
    { action: MENU_ACTIONS.VOLUME_UP, label: '+', x: cx + 230, y: 180, width: 72, height: 56 },
    { action: MENU_ACTIONS.MUTE, label: 'MUTE', x: cx, y: 270, width: 560, height: 60 },
    { action: MENU_ACTIONS.FULLSCREEN, label: 'FULLSCREEN', x: cx, y: 360, width: 560, height: 60 },
    { action: MENU_ACTIONS.REDUCED_MOTION, label: 'REDUCED MOTION', x: cx, y: 450, width: 560, height: 60 },
    { action: MENU_ACTIONS.BACK, label: 'BACK', x: cx, y: 570, width: 280, height: 60 },
  ];
}

function isValidControl(control) {
  return isMenuAction(control?.action)
    && Number.isFinite(control.x)
    && Number.isFinite(control.y)
    && Number.isFinite(control.width)
    && Number.isFinite(control.height)
    && control.width > 0
    && control.height >= MENU_CONTROL_MIN_HEIGHT;
}

export function hitTestMenuControls(controls, x, y) {
  if (!Array.isArray(controls) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return controls.find((control) => isValidControl(control)
    && x >= control.x - control.width / 2
    && x <= control.x + control.width / 2
    && y >= control.y - control.height / 2
    && y <= control.y + control.height / 2) || null;
}

export function switchViewModel(label, on) {
  const enabled = Boolean(on);
  return {
    label: `${label}  ${enabled ? 'ON' : 'OFF'}`,
    on: enabled,
    thumbSide: enabled ? 'right' : 'left',
  };
}

export function acceptMenuActivation(lastFrame, frame) {
  if (!Number.isFinite(frame)) return { accepted: true, nextFrame: lastFrame };
  return frame === lastFrame
    ? { accepted: false, nextFrame: lastFrame }
    : { accepted: true, nextFrame: frame };
}

export function controlsInsideArena(controls) {
  return Array.isArray(controls) && controls.every((control) => isValidControl(control)
    && control.x - control.width / 2 >= 0
    && control.x + control.width / 2 <= ARENA_WIDTH
    && control.y - control.height / 2 >= 0
    && control.y + control.height / 2 <= ARENA_HEIGHT);
}
