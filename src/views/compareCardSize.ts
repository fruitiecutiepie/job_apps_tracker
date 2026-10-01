/**
 * How big a card on the Compare board may be made, in CSS pixels.
 *
 * A card starts at no size of its own: it takes a share of the row (`--compare-card` wide
 * at the least) and hugs its note up to `--compare-card-height`, which is what lets two
 * notes sit side by side on a laptop and be read without scrolling either one. Resizing
 * gives it a width or a height of its own, and resetting takes that away again — `null`
 * means "the default", never a number standing in for it, so a card put back follows the
 * row again rather than keeping whatever width the default happened to measure.
 *
 * Display state, like the pane widths in the notes panel: it lasts while the stage is on
 * screen and never reaches a saved note.
 */

export interface CardSize {
  width: number | null;
  height: number | null;
}

export const DEFAULT_CARD_SIZE: CardSize = Object.freeze({ width: null, height: null });

/** Narrow enough for three on a laptop, wide enough that a bullet still reads as a line. */
export const MIN_CARD_WIDTH = 240;
/** The header and a few lines of note, below which a card is only its own title. */
export const MIN_CARD_HEIGHT = 160;
/** A drag has to stop somewhere; this is past any screen the note is likely to be read on. */
export const MAX_CARD_HEIGHT = 2400;

export const CARD_STEP = 16;
export const CARD_STEP_LARGE = 64;

export function clampCardWidth(width: number, available: number): number {
  const ceiling = Math.max(MIN_CARD_WIDTH, available);
  return Math.round(Math.min(ceiling, Math.max(MIN_CARD_WIDTH, width)));
}

export function clampCardHeight(height: number): number {
  return Math.round(Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, height)));
}
