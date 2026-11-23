// The wallpaper mod's session values ($.state), which outlive a reload of its
// code (every change of an option reloads it). Settings are never kept here:
// they are the plugin's options.

/** True while the settings pane the mod opened is up (a person's or the mod's close sets it false). */
export type WallpaperPaneOpen = boolean
/** True once the mod has set the look this session and not cleared it since. */
export type WallpaperLookSet = boolean

declare module 'claude-code' {
  interface PluginState {
    wallpaper: { paneOpen: WallpaperPaneOpen; lookSet: WallpaperLookSet }
  }
}
