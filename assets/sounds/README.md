# NoLate alarm sounds

`nolate_departure_chime.wav` is an original NoLate sound synthesized entirely from
sine waves. It does not contain samples, melodies, or recordings from external
sources and may be used by the NoLate project without attribution.

The file is a four-second, mono, 44.1 kHz, 16-bit PCM WAV. Its short ascending
C-G-C signal repeats twice and begins and ends at zero amplitude so it can loop
without an audible click.

`nolate_departure_alert.wav` repeats the same original four-second signal seven
times for a 28-second iOS local-notification alert. It remains below Apple's
30-second custom-notification-sound limit while the short file stays available
for foreground looping.

Android packages identical copies as `res/raw/nolate_departure_chime.wav` and
`res/raw/nolate_departure_alert.wav`.

`nolate_alarm_bell.wav` and `nolate_alarm_beep.wav` are additional four-second
NoLate alarm choices. They are also synthesized from sine waves only: the bell
uses short harmonic strikes, while the beep uses a repeating two-harmonic pulse.
Neither file contains third-party samples or melodies.

Their matching `*_alert.wav` files repeat the corresponding four-second sound
for 28 seconds so iOS can use the selected tone as a bundled notification sound.
