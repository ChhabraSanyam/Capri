# IWSDK App

This project uses `iwsdk.config.json` for declarative scene, asset, component,
XR, and emulator configuration. Application systems remain explicit in
`src/main.ts`.

```sh
npm install
npm run dev
```

Use the Runtime and Editor controls in the managed browser to switch between
the running experience and its authored scene.

## Project layout

The composition root is `src/main.ts`. The single IWSDK system is `src/app/capri-system.ts`,
which calls `CapriApp.tick` (`src/app/app.ts`) with a fixed stage order. The 2D entry page is
`index.html`. It offers the microphone step (`src/ui/setup-page/mic-step.ts`) before Enter AR,
because a microphone prompt inside the AR session ends the session.

## Third-party assets

- Placeholder Avatar `public/models/capri.vrm`: "VRM1_Constraint_Twist_Sample" by pixiv Inc.,
  (c) 2022 pixiv Inc., licensed under the [VRM Public License 1.0](https://vrm.dev/licenses/1.0/).
  Source: https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample.
  Unmodified. Details in `docs/THIRD_PARTY.md`. To swap the Avatar, replace that file or change the
  path in `src/config/avatar-config.ts`.
- Voice lines `public/voice/*.mp3`: synthesised at development time with Piper and the voice
  `en_US-kristin-medium` (US English female, single speaker, trained from scratch by Bryce Beattie on
  public-domain LibriVox recordings, https://brycebeattie.com/files/tts/). Voice models:
  https://huggingface.co/rhasspy/piper-voices. Regenerate with `npm run voice` (setup in
  `docs/voice-engine.md`). Details in `docs/THIRD_PARTY.md`.

The full README is written in the submission task.

## Links

- Minimal scene walkthrough: https://iwsdk.dev/guides/01b-minimal-scene.html
- XR-enabled projects — IWER emulator controls: https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls
