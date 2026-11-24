<p align="center"><img src="docs/wordmark.svg" alt="CWallpaper" width="360"></p>

CWallpaper is a mod for the Claude desktop app. It gives the app a moving wallpaper behind the conversation and repaints the app in colours that match it.

Wallpapers are drawn by code, so each one is made here, by an agent that follows [CLAUDE.md](CLAUDE.md).

## Wallpapers

| Name | What it is | How it is drawn |
|---|---|---|
| `kiki` | Pixel art of a young witch and her black cat on a broom, flying toward a seaside city. It follows your clock from day to sunset to night. | An SVG the app animates itself |
| `blackhole` | An ASCII black hole: a broad level disc, white-hot next to the hole and dark red at its rim, round a black circle with a thin bright ring, with blue-white jets streaming up and down and sparks spiralling in. The view swings slowly from above the disc to edge-on and back over a minute. Fine characters. | A GPU shader over a still SVG |

With motion off, under Reduce Motion, and on mobile, the black hole shows its still picture.

## Install

On the command line:

```
claude plugin marketplace add https://github.com/HHong214/CWallpaper.git
claude plugin install CWallpaper@cwallpaper
```

Then run `/reload-plugins` in the app.

## Update

The plugin has no version number, so every pushed commit is an update. In the app, run `/plugin marketplace update cwallpaper`, then `/reload-plugins`. Or switch on auto-update for the `cwallpaper` marketplace and the app does it by itself.

## Use

`/cwallpaper` with no words shows what is drawn and draws it afresh. `/cwallpaper help` lists every command. `/cwallpaper settings` opens the settings in a pane. Every setting is also a plugin option, on the app's plugin options screen.

| Command | Setting | Takes |
|---|---|---|
| `/cwallpaper kiki`, `/cwallpaper blackhole` | Wallpaper | the wallpaper's name |
| `/cwallpaper on`, `/cwallpaper off` | Wallpaper: on | on or off |
| `/cwallpaper motion <word>` | Motion | `smooth`, `light` or `off` |
| `/cwallpaper clear <n>` | Panels: how clear | 0 to 100 |
| `/cwallpaper blur <n>` | Panels: blur | 0 to 40 |
| `/cwallpaper dim <n>` | Scene: dim | 0 to 80 |
| `/cwallpaper colors on\|off` | App colours follow the wallpaper | on or off |
| `/cwallpaper time <word>` | Kiki: time of day | `auto`, `day`, `sunset` or `night` |
| `/cwallpaper spinner on\|off` | Kiki: cat spinner | on or off |
| `/cwallpaper size <word>` | Black hole: size | `small`, `medium` or `large` |
| `/cwallpaper calm on\|off` | Black hole: calmer motion | on or off |

A wallpaper's own settings work only while it is the wallpaper.

Fine characters (the black hole's are 6 by 10 points) vanish behind a blurred panel. Keep Panels: blur low, about 1, to see them.

## Make a wallpaper

Read [CLAUDE.md](CLAUDE.md). It takes an agent from nothing to a finished wallpaper, with the app's limits, the tools in `tools/` and the checks to run. [CHANGELOG.md](CHANGELOG.md) lists what changed and when.

## Licence

MIT: see [LICENSE](LICENSE). It covers the code and the pixel drawings, but not Kiki's character or setting: the Kiki wallpaper is fan art inspired by an existing animated film, and they belong to their rights holders.

CWallpaper is not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic.
