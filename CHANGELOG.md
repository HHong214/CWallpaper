# Changelog

Newest first, headed by date. There is no version number: every pushed commit is an update.

## 2026-11-25

- The wallpaper now rests: after five minutes with no prompt and no turn running in the session, it stops moving and shows its still picture, and the black hole stops using the GPU. A prompt, a turn, `/cwallpaper` or a press in the settings pane wakes it. The new setting Rest when idle takes `off`, `5` or `15` minutes (default `5`); set it in the settings pane or on the plugin options screen. `off` never rests.
- `light` motion now rests Kiki's camera as well as the shooting star.
- Panels: how clear at 0 now leaves the panels as the app draws them, solid, with no glass.
- The black hole always asks for the dark scheme, whether App colours follow the wallpaper or not. Kiki is unchanged.
- A theme error that does not name the scene is shown once as a toast and not retried; the older-build retry keeps the colours.
- Another plugin's theme is told from this one's by its name, so a theme set by another plugin is no longer mistaken for this one's, and the reverse.
- The cat spinner hook is registered only when Kiki and the cat spinner are on.
- Kiki's picture redrawn for a new time of day is now followed by the wake draws.

## 2026-11-24

- CWallpaper now has a licence (MIT), and its README says what the licence does not cover.
- Show FPS is gone: its option, its row in the pane, its command and the number on screen.
- The black hole is redrawn: a broad level disc, white-hot next to the hole and dark red at the rim, a black circle with a thin bright ring, blue-white jets streaming up and down, and sparks spiralling in. Its view swings slowly from above the disc to edge-on and back over a minute.
- It is lighter to draw.
- At its highest view the hole is a whole black circle with its ring all round; the near half of the disc comes in over it only as the view drops.
- The black hole's calmer motion is calmer without nearly stopping: the disc still turns and the view still swings.

## 2026-11-23

The mod was rebuilt.

- The mod is now called CWallpaper, and its command is `/cwallpaper`. The old command is gone.
- The plugin page now names its author, HHong214.

- Every setting is now a plugin option, with its own screen in the app and a settings pane (`/cwallpaper settings`).
- Each wallpaper has settings of its own. Kiki has the time of day and the cat spinner. The black hole has its size and a calmer motion. The pane shows only the current wallpaper's, and a command for another wallpaper's setting says whose it is.
- The black hole is now a GPU shader. Its characters are finer (6 by 10 points), the light is really bent round the hole, and streaks, clumps and falling matter move through it. Its still picture, a real frame of the shader, shows with motion off, under Reduce Motion and on mobile.
- The black hole no longer moves or resizes as you type. When the window or a side panel changes, it fades out and comes back in its new place instead of jumping, and it fades in when the app starts. Single characters no longer flicker, and the frames-a-second number holds steady.
- Show FPS draws the frame rate of a wallpaper played on the GPU. It is drawn larger, at the top left of the chat, where the app's own panels do not cover it.
- The black hole is now seen from above its disc and rolled a little, so its front curves across below the hole and its far side arches over the top. The disc visibly turns, the inner part faster, with a bright arc travelling round the ring and matter streaming in from outside. Its middle is black.
- The black hole sits over the chat column.
- Pictures and videos of your own are gone. Wallpapers are made in this repository, as code.
- The mod lives in its own repository and installs from GitHub as `CWallpaper@cwallpaper`.
