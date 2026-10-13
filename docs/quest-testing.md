# Testing SpatialDesk AI on a Meta Quest

This guide covers what has to happen on a physical headset before the immersive
experience can be called verified. Everything in the automated suite runs
against the IWER emulator; none of it proves comfort, tracking quality or
performance on real hardware.

## Prerequisites

- Meta Quest 2, 3, 3S or Pro with the Meta Quest Browser up to date.
- Hand tracking enabled in **Settings > Movement tracking** if you want to test pinch input (controllers always work).
- The development machine and the headset on the same Wi-Fi network, **or** a USB cable and `adb` for the loopback route.
- Node 22 and the repository installed (`npm install`).

## Option A: LAN with the Vite dev server (fastest)

1. Start the API server in one terminal: `npm run dev:server`.
2. Start the dev server in another: `npm run dev`. It prints a `Network:` URL such as `https://192.168.1.20:8081/`.
3. In the Quest Browser open that URL. Accept the one-time warning about the self-signed development certificate (WebXR requires HTTPS; the plugin generates a local certificate).
4. Open **Spatial** in the sidebar. The device check should show _WebXR API: Available_ and _Mixed reality: Supported_.
5. Press **Enter mixed reality** and accept the browser permission prompt.

The emulator is **not** injected on a real headset (the plugin skips any `OculusBrowser` user agent), so what you see is the native WebXR session.

## Option B: USB with ADB reverse (no certificate warning)

```sh
adb devices                         # the headset must show as "device"
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
SPATIALDESK_DEV_HTTPS=false npm run dev   # plain HTTP is a secure context on localhost
```

Then open `http://localhost:8081/` in the Quest Browser.

## Option C: Production build

```sh
npm run build
ANTHROPIC_API_KEY=... node server/index.js   # serves dist/ and /api on port 8787
```

Expose port 8787 over HTTPS (reverse proxy, tunnel, or hosting provider) and open the public URL in the Quest Browser.

## What to verify on the headset

Record the outcome of each item; the README's verification table should only be updated from these observations.

| Check           | Expected                                                               | Notes                                                                                                                               |
| --------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Session entry   | Passthrough appears with two panels about 1 m ahead at eye height      | If AR is unavailable the app falls back to VR with a dark gradient dome                                                             |
| Hand tracking   | Pointing at a panel shows a ray; pinching activates buttons and rows   | Requires hand tracking enabled on the device                                                                                        |
| Controllers     | Trigger activates, grip is unused                                      | Controller models load from the WebXR Input Profiles CDN; they need internet access                                                 |
| Move a panel    | Pinch (or trigger) on the blue bar above a panel and move the hand     | `DistanceGrabbable` in `MoveFromTarget` mode                                                                                        |
| Tabs            | Home, Tasks, Notes, Projects, Research switch the list                 |                                                                                                                                     |
| Complete a task | The round toggle marks it done; the status line confirms               | Check the browser app afterwards: the change is shared                                                                              |
| Quick add       | Pinch the text field, type with the system keyboard, press Add         | Text entry relies on the Quest Browser raising its keyboard for the hidden HTML input used by UIKit; this is the least certain item |
| Voice           | Press Voice, speak "add a task to buy batteries", confirm              | Depends on Web Speech API availability in the Quest Browser; if unavailable the button is hidden and Settings explains why          |
| Exit            | Press Exit in the panel or use the system menu                         | The 2D app must show the same data afterwards                                                                                       |
| Re-entry        | Enter again from the Spatial view                                      | Second session must start cleanly                                                                                                   |
| Comfort         | Text readable at the default panel size, no judder while moving panels | Note frame rate from the Quest performance HUD if available                                                                         |

## Automated control from a connected headset

IWSDK ships a CLI that can drive a paired headset (pose, select, ECS queries) once the project runs through the managed dev session:

```sh
npm run dev:managed
npx @iwsdk/cli --help
```

See the IWSDK documentation for `runtime pair-headset` and native XR control. It is an optional workflow; the manual checks above are sufficient for a first verification.
