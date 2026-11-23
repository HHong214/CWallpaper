# Changelog

Newest first, headed by date. There is no version number: every pushed commit is an update.

## 2026-11-23

The mod was rebuilt.

- The mod is now called CWallpaper, and its command is `/cwallpaper`. The old command is gone.
- The plugin page now names its author, HHong214.

- Every setting is now a plugin option, with its own screen in the app and a settings pane (`/cwallpaper settings`).
- Each wallpaper has settings of its own. Kiki has the time of day and the cat spinner. The black hole has its size and a calmer motion. The pane shows only the current wallpaper's, and a command for another wallpaper's setting says whose it is.
- The black hole is now a GPU shader. Its characters are finer (6 by 10 points), the light is really bent round the hole, and streaks, clumps and falling matter move through it. Its still picture, a real frame of the shader, shows with motion off, under Reduce Motion and on mobile.
- The black hole no longer moves or resizes as you type. When the window or a side panel changes, it fades out and comes back in its new place instead of jumping, and it fades in when the app starts. Single characters no longer flicker, and the frames-a-second number holds steady.
- Show FPS draws the frame rate of a wallpaper played on the GPU.
- The black hole sits over the chat column.
- Pictures and videos of your own are gone. Wallpapers are made in this repository, as code.
- The mod lives in its own repository and installs from GitHub as `CWallpaper@cwallpaper`.
