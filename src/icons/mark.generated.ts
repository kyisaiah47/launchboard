/* GENERATED FILE. DO NOT EDIT, AND DO NOT DRAW THIS MARK ANYWHERE ELSE.
 *
 * A sync script writes this file from one shared mark registry. The registry holds the only
 * source drawing of this app's mark. The browser tab, this app's header and the product tile
 * on the studio site all use that one drawing. To change the mark, edit it in the registry and
 * run the sync again. Edits made here are overwritten.
 *
 * A gate fails the nightly check when this file stops matching the registry. It also fails
 * when a component draws the mark by hand.
 */
export const MARK_SLUG = "launchboard";
export const MARK_VIEWBOX = "0 0 32 32";
export const MARK_WIDTH = 32;
export const MARK_HEIGHT = 32;
/** The root <svg>'s own fill, where the registry file sets one. */
export const MARK_ROOT_FILL: string | null = null;
/** The ink the glyph is painted in, this product's accent. null when it draws in currentColor. */
export const MARK_INK: string | null = "#2f6fdb";
/** Everything inside the registry file's own <svg>. */
export const MARK_INNER = "<rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#0a0a0a\"/><g transform=\"translate(2.5 2.5) scale(0.84375)\"><path d=\"M2 16a14 14 0 1 0 28 0a14 14 0 1 0 -28 0z M6 16a10 10 0 1 1 20 0a10 10 0 1 1 -20 0z\" fill-rule=\"evenodd\" fill=\"#2f6fdb\" fill-opacity=\"0.62\"></path><path d=\"M14 9h4v5h4v4h-8z\" fill=\"#2f6fdb\"></path></g>";
/** The plate the family paints behind the glyph, where this mark has one. */
export const MARK_PLATE: string | null = "<rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#0a0a0a\"/>";
/** The glyph without that plate, for a header that paints its own ground. */
export const MARK_GLYPH = "<g transform=\"translate(2.5 2.5) scale(0.84375)\"><path d=\"M2 16a14 14 0 1 0 28 0a14 14 0 1 0 -28 0z M6 16a10 10 0 1 1 20 0a10 10 0 1 1 -20 0z\" fill-rule=\"evenodd\" fill=\"#2f6fdb\" fill-opacity=\"0.62\"></path><path d=\"M14 9h4v5h4v4h-8z\" fill=\"#2f6fdb\"></path></g>";
/** The registry file entire, for a header that injects the whole mark. */
export const MARK_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" width=\"32\" height=\"32\"><rect width=\"32\" height=\"32\" rx=\"7\" fill=\"#0a0a0a\"/><g transform=\"translate(2.5 2.5) scale(0.84375)\"><path d=\"M2 16a14 14 0 1 0 28 0a14 14 0 1 0 -28 0z M6 16a10 10 0 1 1 20 0a10 10 0 1 1 -20 0z\" fill-rule=\"evenodd\" fill=\"#2f6fdb\" fill-opacity=\"0.62\"></path><path d=\"M14 9h4v5h4v4h-8z\" fill=\"#2f6fdb\"></path></g></svg>";

/** The same markup with the ink swapped, for a header that recolours the mark. */
export function markInner(color?: string): string {
  return color && MARK_INK ? MARK_INNER.split(MARK_INK).join(color) : MARK_INNER;
}

/** The glyph alone, ink swapped the same way. */
export function markGlyph(color?: string): string {
  return color && MARK_INK ? MARK_GLYPH.split(MARK_INK).join(color) : MARK_GLYPH;
}
