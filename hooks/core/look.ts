// Sets the look and decides what to do when the app refuses it. Pure: no engine
// import, no clock, no store; the two outside calls are handed in, so the plugin
// tests can make them fail. Never throws and never changes the look it is given.

/** What `$.theme.set` takes, as far as this file reads it. */
export type Look = { backdrop?: { scene?: string; id?: string; [key: string]: unknown }; [key: string]: unknown }

export type LookIo = {
  set: (look: Look) => Promise<{ isDrawn: boolean; reason?: string }>
  toast: (text: string) => void
}

export type LookSet = { isSet: boolean; why: string }

const textOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The same look with the scene named `id`, as Claude Code before 2.1.323 reads it; the colours and the rest are kept. */
function older(look: Look): Look {
  const { scene, ...rest } = look.backdrop ?? {}
  return { ...look, backdrop: { id: scene, ...rest } }
}

/**
 * Sets the look. An answer is taken as it comes: `why` is '' when drawn, else the
 * app's reason. An error that names `scene` (a build that names it `id`) is
 * followed by one more call with the older name; any other error is shown once as
 * a toast and not tried again.
 */
export async function setLook(io: LookIo, look: Look): Promise<LookSet> {
  let sending = look
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const set = await io.set(sending)
      return { isSet: true, why: set.isDrawn ? '' : String(set.reason ?? '') }
    } catch (err) {
      const why = textOf(err)
      if (attempt === 0 && /scene/i.test(why)) {
        sending = older(look)
        continue
      }
      try {
        io.toast(`The wallpaper could not be set: ${why}`)
      } catch {
        // Nothing more to tell.
      }
      return { isSet: false, why }
    }
  }
  return { isSet: false, why: 'not set' }
}
