// Kiki: pixel art of a young witch and her black cat floating on a broom toward
// a seaside city. The world (./world) draws the sky, the sea and the city;
// the hero (./hero) draws the witch, her broom and the cat. This file puts
// them in one SVG picture, bottom to top. Pure: a phase in, a picture out.
// No `$`, no JSX, no DOM, no Node APIs, so a preview script can import it too.
//
// Why one picture: the app draws each picture of a stack as an image of its
// own, the size of the window, and in the desktop app a stack of them never
// moved, while the same scene as one picture did. The art is written in
// painter's order (./pixels), which keeps the whole scene within the size
// one picture may have.
import type { Ask, Light, Phase } from './types.ts'
import { world } from './world.ts'
import { hero } from './hero.ts'

export type { Light, Phase }

/** A picture: an SVG, and whether anything in it moves. */
export type KikiLayer = { source: string; moves: boolean }
/** The scene: its one picture (in a list, as the hook takes every scene), and what it shows. */
export type KikiScene = { layers: KikiLayer[]; alt: string }

const WHO = 'Pixel art of a young witch with a red bow and her black cat floating on a short broom toward a seaside city'

const ALT: Record<Phase, string> = {
  day: `${WHO}, under a blue sky with fluffy clouds.`,
  sunset: `${WHO}, under a warm sky with the sun setting over the sea.`,
  night: `${WHO}, at night: stars and the moon above, lit windows in the city.`,
}

// The art is filled rectangles on the pixel grid (./pixels). No
// shape-rendering="crispEdges", not even on a group: the desktop app never
// animates a picture that sets it. Edges sit on whole units, so at a
// whole-number scale they stay sharp all the same.
const OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">'

/** The scene's SVG. */
function svg(defs: string, css: string, body: string): string {
  return `${OPEN}${defs ? `<defs>${defs}</defs>` : ''}${css ? `<style>${css}</style>` : ''}${body}</svg>`
}

// The same ask always gives the same picture, built once: a redraw then costs
// nothing to make.
const made = new Map<string, KikiScene>()

/**
 * The scene for a phase of the day, as one picture; `still` leaves out every
 * animation; `light` holds some moving parts still (./types).
 */
export function kikiScene(phase: Phase, still = false, light?: Light): KikiScene {
  const on = light ? (['stillBeam', 'stillShoot', 'stillCam'] as const).filter(k => light[k] === true) : []
  const key = `${phase}|${still}|${on.join('+')}`
  const kept = made.get(key)
  if (kept) return kept
  const ask: Ask = on.length > 0 && light ? { phase, still, light } : { phase, still }
  const w = world(ask)
  const h = hero(ask)
  // Bottom to top: the world under the camera (sky, clouds, sea, town, gulls,
  // wind); Kiki and the cat, outside the camera, with their own float; the
  // world's front layer.
  const body = w.back + h.body + w.front
  const layers: KikiLayer[] = [{ source: svg(w.defs + h.defs, w.css + h.css, body), moves: !still }]
  const scene = { layers, alt: ALT[phase] }
  made.set(key, scene)
  return scene
}
