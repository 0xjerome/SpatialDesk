# Meta VR Start preparation: SpatialDesk AI

Materials prepared for an application to Meta's developer programme for Quest. Everything below describes the project as it is; nothing here claims review, acceptance, adoption or certification. Submission itself requires the account owner (Jerome Ssenyonga) to accept programme terms, which this document does not do.

Official programme pages could not be fetched from the environment that produced this document, so programme-specific requirements must be checked by the applicant on developers.meta.com before submitting.

## Product

**SpatialDesk AI** is a local-first productivity workspace for Meta Quest and the browser. Tasks, notes, projects and research live in one workspace that works as an ordinary web app and as hand-driven panels in mixed reality, built on WebXR and Meta's Immersive Web SDK (IWSDK 1.0.1).

- Repository: <https://github.com/0xjerome/SpatialDesk>
- Live URL: not yet deployed (a Render blueprint is in the repository; see README).
- Maintainer: Jerome Ssenyonga (@0xjerome), Kampala.

## Target user and problem

People who do focused knowledge work and already keep tasks, notes and reference material in several apps. On a headset today that material is reachable only through flat browser windows that are not designed for hands or for spatial arrangement. SpatialDesk puts the person's own work in front of them as panels they can place, point at and pinch, and keeps the same data available in a normal browser when they take the headset off.

## Why mixed reality

- Passthrough keeps the real desk, keyboard and colleagues visible while the workspace floats where the person wants it.
- Panels are physical objects: a grab bar above each panel lets the person move it with a pinch or trigger; the list and the detail stay side by side instead of in tabs.
- Hands-first input: point and pinch for everything, controllers as the always-available alternative, voice for quick capture.
- Nothing is lost between contexts: the browser app and the immersive panels share one store, so a task completed in XR is done in the browser the moment the session ends.

## Implemented today

- Workspace home, tasks (priority, due date, project, filters, sort, undo), notes with autosave, projects with progress computed from real tasks, research items with validated links and tags.
- Settings: theme, JSON export/import with validation, delete-all with confirmation, plain-language privacy summary.
- Optional assistant (server-side Claude via a Node proxy): organise tasks, draft tasks from a note, summarise text, break a project into steps. Suggestions are validated twice and never saved without an explicit action.
- Voice commands through the browser's Web Speech API with confirmation before any change.
- Immersive workspace: two UIKit panels (list with tabs, paging, quick add and task toggles; detail with actions), grabbable panel bars, in-panel voice flow, Exit, clean disposal and re-entry. Mixed reality (`immersive-ar`) first, VR fallback.

## Evidence

| Item                       | Status            | Evidence                                                                                                       |
| -------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit and integration tests | 107 pass          | `npm test`, CI on `main`                                                                                       |
| End-to-end journeys        | 22 pass           | `npm run test:e2e`, includes production build, multi-tab, emulated XR enter/exit/re-enter                      |
| Emulated Quest 3 session   | pass              | IWER emulator via `@iwsdk/vite-plugin-dev`; `immersive-ar`, alpha-blend, two hands and two controllers present |
| Dependency audit           | 0 findings        | `npm audit`                                                                                                    |
| Physical Quest test        | **not performed** | see `docs/quest-testing.md`                                                                                    |
| Live deployment            | **not performed** | Render blueprint prepared                                                                                      |
| Live assistant call        | **not performed** | no API key available in the build environment                                                                  |

## Demo script (3 minutes)

1. Browser: open the workspace, create the project "Launch", add two tasks with due dates, write a note. Show the home overview counting the real items.
2. Spatial view: press _Preview in browser_; show the same tasks in the list panel, select one, complete it from the detail panel; close the preview and show the task is done in the browser list.
3. Headset: open the same URL in the Quest Browser, press _Enter mixed reality_, pinch a task row, grab the bar and move the panel, press _Voice_, say "add a task to charge the controllers", confirm, press _Exit_. Show the new task in the browser.
4. Settings: export the JSON, explain that data stays on the device and that the assistant is optional.

## Screenshots

`docs/screenshots/workspace.png`, `docs/screenshots/tasks.png`, `docs/screenshots/spatial-preview.png` are genuine captures from the browser app and the browser 3D preview. No headset capture exists yet.

## Known limitations and outstanding requirements

- No physical-device verification yet: hand-tracking comfort, system keyboard inside UIKit text fields, Quest Browser speech support and frame rate are unmeasured.
- No cloud sync; data is per device (export/import to move it).
- The immersive runtime is a 6.6 MB download (1.7 MB with gzip, which the server applies), loaded only when the Spatial view is opened.
- Controller models load from the WebXR Input Profiles CDN; offline they are absent but input still works.
- No licence file has been chosen yet.
