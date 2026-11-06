# Third-party notices

Tele's source is licensed under the [MIT License](LICENSE), copyright 2026 Jian. Tele uses these npm packages. The source checkout's `package-lock.json` records exact development versions and dependency trees. Each installed dependency includes its own license text. Pi and TypeBox are supplied by the host rather than bundled in Tele.

| Package | Use | License |
| --- | --- | --- |
| zod | Runtime document validation | MIT |
| esbuild | Production bundling | MIT |
| TypeScript | Type checking | Apache-2.0 |
| @types/node | Node.js type declarations | MIT |
| tsx | TypeScript test execution | MIT |
| Playwright | Optional browser verification | Apache-2.0 |
| @earendil-works/pi-coding-agent | Host API types and disposable Pi verification runtime | MIT |
| typebox | Host-provided Pi tool parameter schemas | MIT |

[TwoMoons](https://github.com/moayuisuda/two-moons) is the original upstream product reference for connecting guitar fingering diagrams with browser playback. It is licensed GPL-3.0. The local reference checkout was the [kyn0v/two-moons](https://github.com/kyn0v/two-moons) fork. Tele uses it only as a reference and imports or copies none of its source, audio samples, images, or fonts. The UI, SVG diagrams, and Web Audio synthesis in this repository are independent implementations.

These notices preserve third-party attribution. Tele's MIT license does not replace third-party licenses.
