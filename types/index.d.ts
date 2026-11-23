// The wallpaper mod's session values ($.state), which outlive a reload of its
// code (every change of an option reloads it). Settings are never kept here:
// they are the plugin's options.

/** True while the settings pane the mod opened is up (a person's or the mod's close sets it false). */
export type WallpaperPaneOpen = boolean
/** True once the mod has set the look this session and nobody has set or cleared a theme since. */
export type WallpaperLookSet = boolean
/** One option still to write: its manifest key and the value. */
export type WallpaperPendingWrite = { key: string; value: boolean | string | number }

declare module 'claude-code' {
  interface PluginState {
    wallpaper: {
      paneOpen: WallpaperPaneOpen
      lookSet: WallpaperLookSet
      /**
       * The writes of one change still to make, in order (`wallpaper`, then `on`): saved before
       * the first, each taken off as it is made, so the reload the first causes cannot cut the
       * change in two; a start makes what it finds and empties the list.
       */
      pendingWrites: WallpaperPendingWrite[]
    }
  }
}
