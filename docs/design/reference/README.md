# Reference code

This is working code that shows exactly how the design behaves: states, motion, spacing and copy. It is a **reference, not production code**. It is plain React 18 with no build step. Rebuild it properly in `apps/web`: typed components, Tailwind, shadcn/Radix, and SDK data instead of the sample data.

| File                           | What it is                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bundle.js](bundle.js)         | The 15 design-system components as one classic script assigning `window.FairDrops`, written with `React.createElement`.                                                          |
| [bundle.css](bundle.css)       | Their styles. They use only the custom properties from [../tokens.css](../tokens.css). Class names are prefixed `fd-`.                                                           |
| [index.d.ts](index.d.ts)       | Props for every component, the same as in [../components.md](../components.md).                                                                                                  |
| [prototype.jsx](prototype.jsx) | The clickable prototype: every screen in [../screens](../screens/README.md), the player and host flows, and the desktop artboards. It uses sample data from the top of the file. |
| [prototype.css](prototype.css) | The prototype's own layout: the phone frame, screen scaffolding, and the `p-*` and `d-*` classes.                                                                                |

## Running the prototype locally

The prototype loads React 18.3.1, ReactDOM and Babel standalone from cdnjs, then `bundle.js`, then `prototype.jsx` as `text/babel`. An HTML page that includes, in order, the following runs it:

1. `tokens.css`, `bundle.css` and `prototype.css`;
2. a `<div id="app">`;
3. the three CDN scripts;
4. `bundle.js`;
5. `prototype.jsx`.

Add `?shot=<screen id>&theme=light|dark` to render a single screen with no chrome. That is how the screenshots in [../images](../images) were made. Screen ids are the image names, for example `results`, `h-prize` and `d-hosting`.

The live, shareable copy is on claude.ai (sign-in required):

- [prototype](https://claude.ai/artifact/GRWAd3HRxA6sWpa8nVigX1);
- [design system](https://claude.ai/artifact/MvJ9MEsFwJKGPtXQyW8Yk8).

## Known shortcuts to fix when rebuilding

- Sample data (names, amounts, naira estimates) is hard-coded.
- The stepper, chips and answer tiles are ad-hoc buttons. Use Radix primitives with proper keyboard support.
- `ThemeSwitch` in the bundle sets `data-theme` even for Auto. In the app, use `next-themes`, which removes it for System.
- Sounds are WebAudio blips. Replace them with real, short sound files: tap, tick, correct, wrong, win.
