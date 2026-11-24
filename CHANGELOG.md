# Changelog

Newest first, headed by date. There is no version number: every pushed commit is an update.

## 2026-11-24

- CWallpaper now has a licence (MIT), and its README says what the licence does not cover.
- Show FPS is gone: its option, its row in the pane, its command and the number on screen.
- The black hole is redrawn: a broad level disc, white-hot next to the hole and dark red at the rim, a black circle with a thin bright ring, blue-white jets streaming up and down, and sparks spiralling in. Its view swings slowly from above the disc to edge-on and back over a minute.
- It is lighter to draw.

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
