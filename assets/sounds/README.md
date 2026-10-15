# NoLate alarm sounds

NoLate ships ten original alarm choices:

| ID | Korean label | Short file |
| --- | --- | --- |
| `CHIME` | 차임 | `nolate_departure_chime.wav` |
| `BELL` | 벨 | `nolate_alarm_bell.wav` |
| `BEEP` | 비프 | `nolate_alarm_beep.wav` |
| `DIGITAL` | 디지털 | `nolate_alarm_digital.wav` |
| `CRYSTAL` | 크리스털 | `nolate_alarm_crystal.wav` |
| `KNOCK` | 노크 | `nolate_alarm_knock.wav` |
| `TRIPLE` | 3연속 | `nolate_alarm_triple.wav` |
| `SWEEP` | 상승 신호 | `nolate_alarm_sweep.wav` |
| `SIREN` | 사이렌 | `nolate_alarm_siren.wav` |
| `KLAXON` | 경적 | `nolate_alarm_klaxon.wav` |

Every sound is synthesized from mathematical waveforms and contains no samples,
recordings, or third-party melodies. The seven sounds after the original three
are reproducible with:

```sh
python3 scripts/generate-alarm-sounds.py
```

Short files are four-second, mono, 44.1 kHz, 16-bit PCM WAV loops. Android
packages byte-identical short files in the alarm module's `res/raw` directory.
The app also uses the short files for its in-app preview and full-screen alarm.

Each matching `*_alert.wav` file is the same four-second signal repeated seven
times without re-encoding. These 28-second variants are bundled into the iOS app
for local notifications and stay below Apple's 30-second custom-sound limit.

`SIREN` and `KLAXON` are deliberately more persistent than the other choices,
but retain additional peak headroom to avoid clipping and excessive harshness.
