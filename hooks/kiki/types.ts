// Shared shapes for the Kiki scene's pieces (world.ts draws the sky, sea and
// city, hero.ts the witch, her broom and the cat; ../kiki.ts puts them in one
// SVG). Pixel art: one unit of the 320 x 180 viewBox is one pixel of the art.
// Pure types: no `$`, no DOM, no Node APIs.

/** The time of day the scene is painted for; the mod picks it from the clock. */
export type Phase = 'day' | 'sunset' | 'night'

/**
 * Switches for a calmer moving scene: everything else still moves (the sea,
 * the cloud strips, the stars, the moon, the wind and Kiki). Each one off (or
 * left out) changes nothing.
 * `stillBeam`: the lighthouse beam rests: its first frame and its lamp drawn
 * still, in their place among the near layers (inside the camera, when it moves).
 * `stillShoot`: the shooting star rests: it is left out.
 * `stillCam`: the camera rests: the world no longer bobs (Kiki still floats).
 */
export type Light = { stillBeam?: boolean; stillShoot?: boolean; stillCam?: boolean }

/** How a piece is asked for. `still` leaves out every animation: no CSS rules, no SMIL elements. */
export type Ask = { phase: Phase; still: boolean; light?: Light }

/**
 * A piece of the scene in the 320 x 180 viewBox: markup for the shared <defs>,
 * rules for the one shared <style> ('' when still), and what it draws.
 */
export type Layer = { defs: string; css: string; body: string }

/**
 * The world in two parts: `back`, everything under the hero (the sky, the
 * cloud range, the sea and the town, and all that moves on them, inside the
 * camera's groups), and `front`, what is drawn over the hero (may be '').
 * ../kiki.ts joins them round the hero into one picture, since the desktop
 * app never animates a stack of pictures. When still, the same parts with
 * nothing moving in them.
 */
export type World = { defs: string; css: string; back: string; front: string }
