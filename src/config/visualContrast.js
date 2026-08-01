// Pure, Phaser-free color math used to verify UI palettes in headless tests.
// RGB channels are kept as floats during compositing so contrast assertions do
// not gain or lose margin through display-byte rounding.

function parseHexColor(color) {
  if (typeof color === 'number' && Number.isInteger(color)) {
    if (color < 0 || color > 0xffffff) {
      throw new RangeError('Numeric colors must be between 0x000000 and 0xffffff.');
    }
    return {
      r: (color >> 16) & 0xff,
      g: (color >> 8) & 0xff,
      b: color & 0xff,
    };
  }

  if (typeof color === 'string') {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (match) {
      const hex = match[1].length === 3
        ? [...match[1]].map((digit) => digit + digit).join('')
        : match[1];
      const value = Number.parseInt(hex, 16);
      return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
      };
    }
  }

  if (
    color &&
    Number.isFinite(color.r) &&
    Number.isFinite(color.g) &&
    Number.isFinite(color.b) &&
    color.r >= 0 && color.r <= 255 &&
    color.g >= 0 && color.g <= 255 &&
    color.b >= 0 && color.b <= 255
  ) {
    return { r: color.r, g: color.g, b: color.b };
  }

  throw new TypeError('Color must be a hex integer, #rgb/#rrggbb string, or RGB object.');
}

/**
 * Alpha-composite a foreground color over a background color.
 * @param {number|string|{r:number,g:number,b:number}} foreground
 * @param {number} alpha Foreground opacity in the inclusive range 0..1.
 * @param {number|string|{r:number,g:number,b:number}} [background=0x000000]
 * @returns {{r:number,g:number,b:number}}
 */
export function compositeColor(foreground, alpha, background = 0x000000) {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError('Alpha must be between 0 and 1.');
  }
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  const inverse = 1 - alpha;
  return {
    r: fg.r * alpha + bg.r * inverse,
    g: fg.g * alpha + bg.g * inverse,
    b: fg.b * alpha + bg.b * inverse,
  };
}

function linearChannel(channel) {
  const srgb = channel / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance for a supported color value. */
export function relativeLuminance(color) {
  const rgb = parseHexColor(color);
  return (
    0.2126 * linearChannel(rgb.r) +
    0.7152 * linearChannel(rgb.g) +
    0.0722 * linearChannel(rgb.b)
  );
}

/** WCAG contrast ratio, always returned brightest-to-darkest (1..21). */
export function contrastRatio(colorA, colorB) {
  const first = relativeLuminance(colorA);
  const second = relativeLuminance(colorB);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
