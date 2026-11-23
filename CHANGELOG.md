# Changelog

Newest first, headed by date. There is no version number: every pushed commit is an update.

## 2026-11-23

The mod was rebuilt.

- Every setting is now a plugin option, with its own screen in the app and a settings pane (`/wallpaper settings`).
- Each wallpaper has settings of its own. Kiki has the time of day and the cat spinner. The black hole has its size and a calmer motion. The pane shows only the current wallpaper's, and a command for another wallpaper's setting says whose it is.
- The black hole is now a GPU shader. Its characters are finer (6 by 10 points), the light is really bent round the hole, and streaks, clumps and falling matter move through it. Its still picture, a real frame of the shader, shows with motion off, under Reduce Motion and on mobile.
- Show FPS draws the frame rate of a wallpaper played on the GPU.
- The black hole sits over the chat column.
- Pictures and videos of your own are gone. Wallpapers are made in this repository, as code.
- The mod lives in its own repository and installs from GitHub as `wallpaper@cwallpaper`.
