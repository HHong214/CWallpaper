<p align="center"><img src="docs/wordmark.svg" alt="CWallpaper" width="360"></p>

CWallpaper is a mod for the Claude desktop app. It gives the app a moving wallpaper behind the conversation and repaints the app in colours that match it.

The repository is private. Wallpapers are drawn by code, so each one is made here, by an agent that follows [CLAUDE.md](CLAUDE.md).

## Wallpapers

| Name | What it is | How it is drawn |
|---|---|---|
| `kiki` | Pixel art of a young witch and her black cat on a broom, flying toward a seaside city. It follows your clock from day to sunset to night. | An SVG the app animates itself |
| `blackhole` | An ASCII black hole: a gold ring, its disc bent over and under it, matter falling in. Fine characters, light bent by the hole. | A GPU shader over a still SVG |

With motion off, under Reduce Motion, and on mobile, the black hole shows its still picture.

## Install

On the command line:

```
claude plugin marketplace add https://github.com/HHong214/CWallpaper.git
claude plugin install wallpaper@cwallpaper
```

Then run `/reload-plugins` in the app.

## Update

The plugin has no version number, so every pushed commit is an update. In the app, run `/plugin marketplace update cwallpaper`, then `/reload-plugins`. Or switch on auto-update for the `cwallpaper` marketplace and the app does it by itself.

## Use

`/wallpaper` with no words shows what is drawn and draws it afresh. `/wallpaper help` lists every command. `/wallpaper settings` opens the settings in a pane. Every setting is also a plugin option, on the app's plugin options screen.

| Command | Setting | Takes |
|---|---|---|
| `/wallpaper kiki`, `/wallpaper blackhole` | Wallpaper | the wallpaper's name |
| `/wallpaper on`, `/wallpaper off` | Wallpaper: on | on or off |
| `/wallpaper motion <word>` | Motion | `smooth`, `light` or `off` |
| `/wallpaper clear <n>` | Panels: how clear | 0 to 100 |
| `/wallpaper blur <n>` | Panels: blur | 0 to 40 |
| `/wallpaper dim <n>` | Scene: dim | 0 to 80 |
| `/wallpaper colors on\|off` | App colours follow the wallpaper | on or off |
| `/wallpaper fps on\|off` | Show FPS (a GPU wallpaper only) | on or off |
| `/wallpaper time <word>` | Kiki: time of day | `auto`, `day`, `sunset` or `night` |
| `/wallpaper spinner on\|off` | Kiki: cat spinner | on or off |
| `/wallpaper size <word>` | Black hole: size | `small`, `medium` or `large` |
| `/wallpaper calm on\|off` | Black hole: calmer motion | on or off |

A wallpaper's own settings work only while it is the wallpaper.

Fine characters (the black hole's are 6 by 10 points) vanish behind a blurred panel. Keep Panels: blur low, about 1, to see them.

## Make a wallpaper

Read [CLAUDE.md](CLAUDE.md). It takes an agent from nothing to a finished wallpaper, with the app's limits, the tools in `tools/` and the checks to run. [CHANGELOG.md](CHANGELOG.md) lists what changed and when.
