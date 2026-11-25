// The wallpapers and how to find one. Pure: no engine import, no clock, no
// store, never throws.
//
// A wallpaper is one folder under hooks/wallpapers/ whose index.ts exports a
// `Wallpaper`, listed in WALLPAPERS below. Adding one touches nothing else of
// the core: its options reach the manifest (tools/sync-manifest.mjs), the
// commands, the pane and the Backdrop from this list.
import type { OptionSpec, Settings } from './options.ts'
import { kiki } from '../wallpapers/kiki/index.ts'
import { blackhole } from '../wallpapers/blackhole/index.ts'

export type { OptionSpec, Settings }

/** What a shader wallpaper's `scene` is handed: the scene `sceneFor` gave. */
export type ShaderScene = { kind: 'shader'; id: string; values: Record<string, number>; source: string; alt: string }

/**
 * The element constructors of the surface that draws the Backdrop, as
 * `$.ui.resolve(e)` gives them: `Shader` and `Svg` on the desktop and mobile.
 */
export type SceneKit = { Shader?: unknown; Svg?: unknown; [element: string]: unknown }

export type Wallpaper = {
  id: string
  label: string
  /** Other words `/cwallpaper` takes for it, whatever the letter case. */
  aliases: readonly string[]
  /** `svg`: the app animates the SVG itself; `shader`: a GPU shader over a still SVG. */
  kind: 'svg' | 'shader'
  /** Its own options, with SHORT keys ('time'); the manifest keys are `<id><Key>`. */
  options: readonly OptionSpec[]
  /** The colour scheme the look asks for whatever the person's own mode is; none leaves the person's. */
  scheme?: 'light' | 'dark'
  /** What `makeColors` takes (its `label`, its `roles`, its anchors). */
  colors(settings: Settings): object
  /** The SVG, at most 124,000 characters; a shader wallpaper's still picture. No animation with motion off. */
  svg(settings: Settings, now: number): string
  /** False when settings.motion is 'off'. */
  moves(settings: Settings): boolean
  /** A shader wallpaper's numbers for its shader, at most 8 names (the scene adds dim and speed). */
  values?(settings: Settings): Record<string, number>
  /**
   * A shader wallpaper's Backdrop tree, called by the Backdrop hook with the
   * surface's elements and the scene. The `Shader` element's `module` must be a
   * string literal in the wallpaper's own file, relative to it, as the engine
   * reads it off the source; a file the core imports holds no JSX, so it is
   * written with the global `h`:
   *   scene: (kit, s) => h(kit.Shader as never, { module: './shader.ts', values: s.values },
   *     h(kit.Svg as never, { source: s.source, alt: s.alt }))
   * Without it, a shader wallpaper's still picture is drawn alone.
   */
  scene?(kit: SceneKit, scene: ShaderScene): unknown
  /** What the picture shows, for those who cannot see it. */
  alt?(settings: Settings, now: number): string
  /** The text added after the app's spinner word in this mode, or undefined to leave it as the app draws it. */
  spinner?(settings: Settings, mode: string): string | undefined
}

export const WALLPAPERS: readonly Wallpaper[] = Object.freeze([kiki, blackhole])

/** A wallpaper by id or alias, whatever the letter case; undefined for anything else. */
export function findWallpaper(name: string, wallpapers: readonly Wallpaper[] = WALLPAPERS): Wallpaper | undefined {
  if (typeof name !== 'string') return undefined
  const word = name.trim().toLowerCase()
  if (word === '' || !Array.isArray(wallpapers)) return undefined
  return wallpapers.find(w => w && (w.id.toLowerCase() === word || (Array.isArray(w.aliases) && (w.aliases as readonly unknown[]).some(a => typeof a === 'string' && a.toLowerCase() === word))))
}

/** The wallpaper a settings' `wallpaper` names, else the first of the list. */
export function currentWallpaper(settings: { wallpaper?: unknown } | undefined, wallpapers: readonly Wallpaper[] = WALLPAPERS): Wallpaper | undefined {
  if (!Array.isArray(wallpapers)) return undefined
  const id = settings && typeof settings === 'object' ? settings.wallpaper : undefined
  return wallpapers.find(w => w && w.id === id) ?? wallpapers[0]
}
