# Voice engine decision (task 13.1)

**Decision:** the dev-time Voice_Script uses **Piper** (local neural text-to-speech), chosen by the user.
This resolves Open Item 1 in the design. The other options (macOS `say`, a cloud service) are not used.

Piper runs only at development time inside `tools/voice-script/`. It never ships in the runtime bundle
and the app has no runtime TTS dependency (Requirements 16.1, 16.7).

## Setup (checked on macOS arm64, 2026)

Prerequisites: `uv` (or Python 3.10+ with `venv`) and `ffmpeg`. Both were already installed on the
development Mac (`ffmpeg` 9.0.1 with `libmp3lame`, `libopus`, and `aac`; no `libvorbis`, so use Opus for
`.ogg`). If `ffmpeg` is missing: `brew install ffmpeg`.

```sh
# 1. Isolated environment (git-ignored)
uv venv --python 3.12 tools/voice-script/.venv
uv pip install --python tools/voice-script/.venv/bin/python piper-tts      # piper-tts 1.8.0

# 2. Voice model (about 63 MB, git-ignored) and its MODEL_CARD
tools/voice-script/.venv/bin/python -m piper.download_voices \
  --data-dir tools/voice-script/.cache/voices en_US-kristin-medium
curl -sL https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/MODEL_CARD \
  -o tools/voice-script/.cache/voices/en_US-kristin-medium.MODEL_CARD

# 3. Synthesise and encode (text -> wav -> mp3)
tools/voice-script/.venv/bin/python -m piper --data-dir tools/voice-script/.cache/voices \
  -m en_US-kristin-medium -f out.wav -- 'Hi, I am Capri!'
ffmpeg -y -i out.wav -ac 1 -c:a libmp3lame -b:a 64k out.mp3
```

The CLI reloads the model on each call (about 1 s per line on Apple silicon), so task 13.19 can call it
once per changed line, or use the Python API (`piper.PiperVoice.load(...)`) to load once and loop.
`tools/voice-script/.venv/` and `tools/voice-script/.cache/` are listed in `.gitignore`. Model files are
never committed.

Piper package: `piper-tts` from https://github.com/OHF-Voice/piper1-gpl (engine licence GPL-3.0-or-later).
The engine is a dev tool that is not distributed with Capri, so its licence does not apply to the app.
Voices come from https://huggingface.co/rhasspy/piper-voices.

## Chosen voice

| Field | Value |
|---|---|
| Voice | `en_US-kristin-medium` (US English, female, single speaker, 22,050 Hz, medium quality) |
| Training | Trained from scratch (no base voice), so there is no inherited licence chain |
| Dataset | LibriVox audiobook recordings, https://librivox.org |
| Dataset licence | Public domain (from the voice's `MODEL_CARD`) |
| Voice author | Bryce Beattie, notes at https://brycebeattie.com/files/tts/ |
| Attribution | Not required. Capri credits it anyway in the README third-party list. |

Why this voice: Piper's own licensing notes warn that voices fine-tuned from `lessac` inherit a
research-only dataset licence. Kristin is trained from scratch on public-domain recordings, and Piper's
commercial-use list names it. This keeps the shipped audio free of licence obligations.

Piper makes no licence grant over voice models and takes no position on whether synthesised audio is a
derivative of the training data. Treat that as a residual, low risk for a personal project.

Whether Kristin sounds "youthful and expressive" has not been judged by ear. Sample files for
listening are in `tools/voice-script/.cache/test/` (`kristin.*`, `kathleen.wav`).

### Alternative if the user dislikes the sound

`en_US-kathleen-medium` (female, dataset CC0). Its model was fine-tuned from `en_US-hifi_tts_92-medium`
(Cori Samuel, Hi-Fi TTS reader 92, CC BY 4.0), so shipping its audio would need a credit line: "Voice
data: Hi-Fi Multi-Speaker English TTS Dataset, NVIDIA Corporation, CC BY 4.0, https://www.openslr.org/109/".
Other public-domain en_US voices: `en_US-ljspeech-high`, `en_US-norman-medium` (male), `en_US-john-medium` (male).
Avoid `en_US-lessac-*`, `en_US-amy-*`, and `en_US-hfc_female-*` (restrictive or undocumented licences).
If the voice changes, update this file and `docs/THIRD_PARTY.md`.

## Test result (task 13.1 feasibility check)

Line: "Hi, I'm Capri! Okay, the lamp is on. Easy peasy." Voice: `en_US-kristin-medium`, Piper 1.8.0.

| Step | Result |
|---|---|
| Piper to WAV | 196,140 bytes, 22,050 Hz mono, 4.45 s, whole CLI run about 0.9 s |
| WAV to MP3 (`libmp3lame`, 64 kbps) | 36,405 bytes, mono, 4.45 s. This is the format the design specifies |
| WAV to OGG (`libopus`, 32 kbps) | 18,364 bytes, mono, 4.45 s |
| WAV to M4A (`aac`, 64 kbps) | 39,465 bytes, mono, 4.45 s |

At about 36 KB per 4.5 s line, a library of roughly 60 to 80 short lines stays within a few MB.

## For task 13.19

- Implement `engines/piper.ts` as a `VoiceEngine` that shells out to `tools/voice-script/.venv/bin/python -m piper`.
  Fail with a clear message that points here when the venv or model is missing.
- Encode with `ffmpeg` to mono MP3 at about 64 kbps, as in the design.
- Include the `MODEL_CARD` content (voice name, public-domain dataset, author) in the README third-party list.

## Loudness (task 27.3)

Piper lines come out between -17.9 and -13.6 LUFS integrated, with mp3 true peaks up to +3.0 dBTP.
`npm run voice` measures every mp3 with `ffmpeg -af ebur128=peak=true` and writes `loudnessLufs`,
`truePeakDb`, and `gainDb` into `public/voice/index.json`. The app applies `gainDb` when it plays the line,
so every line plays at -16 LUFS. The mp3 files are not re-encoded. A kept line is measured once and the
stored value is reused after that, so the script stays idempotent.

`npm run audio:report` prints the per-line measurements, then renders the app's audio graph offline in
headless Chromium and meters the voice, chirp, hack cues, the hack sequence, and a worst-case overlap.
The bus levels and the limiter are `AUDIO_MIX` in `src/config/constants.ts`. To try other levels without
editing that file, run `node .tmp/audio-mix/bin/render-mix.mjs --mix '{"sfxGain":0.4}'` after one
`npm run audio:report`.
