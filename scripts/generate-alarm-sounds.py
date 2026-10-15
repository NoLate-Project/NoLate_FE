#!/usr/bin/env python3
"""Generate NoLate's original alarm tones and their iOS notification variants.

The short files are four-second foreground/Android loops. The matching alert
files repeat the exact loop seven times (28 seconds), staying below iOS's
30-second custom notification sound limit. No samples or third-party melodies
are used; every waveform is synthesized here from sine-wave partials.
"""

from __future__ import annotations

import math
import shutil
import struct
import wave
from collections.abc import Callable, Iterable
from pathlib import Path


SAMPLE_RATE = 44_100
LOOP_SECONDS = 4
ALERT_REPETITIONS = 7
FRAME_COUNT = SAMPLE_RATE * LOOP_SECONDS
ROOT = Path(__file__).resolve().parents[1]
SOUND_DIR = ROOT / "assets" / "sounds"
ANDROID_RAW_DIR = ROOT / "modules" / "nolate-alarm" / "android" / "src" / "main" / "res" / "raw"

Buffer = list[float]
Frequency = float | Callable[[float], float]


def empty_buffer() -> Buffer:
    return [0.0] * FRAME_COUNT


def smooth_envelope(position: float, duration: float, attack: float, release: float) -> float:
    attack_level = min(1.0, position / max(attack, 1 / SAMPLE_RATE))
    release_level = min(1.0, (duration - position) / max(release, 1 / SAMPLE_RATE))
    level = max(0.0, min(attack_level, release_level))
    return math.sin(level * math.pi / 2) ** 2


def add_tone(
    buffer: Buffer,
    start: float,
    duration: float,
    frequency: Frequency,
    amplitude: float = 1.0,
    partials: Iterable[tuple[float, float]] = ((1.0, 1.0),),
    attack: float = 0.012,
    release: float = 0.045,
    decay: float = 0.0,
) -> None:
    start_frame = max(0, round(start * SAMPLE_RATE))
    end_frame = min(FRAME_COUNT, round((start + duration) * SAMPLE_RATE))
    if end_frame <= start_frame:
        return

    normalized_partials = tuple(partials)
    phases = [0.0] * len(normalized_partials)
    for frame in range(start_frame, end_frame):
        position = (frame - start_frame) / SAMPLE_RATE
        base_frequency = frequency(position) if callable(frequency) else frequency
        envelope = smooth_envelope(position, duration, attack, release)
        if decay > 0:
            envelope *= math.exp(-decay * position)
        sample = 0.0
        for index, (ratio, strength) in enumerate(normalized_partials):
            phases[index] += 2 * math.pi * base_frequency * ratio / SAMPLE_RATE
            sample += math.sin(phases[index]) * strength
        buffer[frame] += sample * amplitude * envelope


def synthesize_digital() -> Buffer:
    buffer = empty_buffer()
    partials = ((1.0, 1.0), (1.9, 0.23))
    for group in (0.08, 2.08):
        for offset, duration, frequency in (
            (0.00, 0.12, 1_180.0),
            (0.18, 0.12, 1_180.0),
            (0.42, 0.12, 1_480.0),
            (0.60, 0.31, 1_480.0),
        ):
            add_tone(buffer, group + offset, duration, frequency, 0.86, partials, 0.006, 0.025)
    return finalize(buffer, target_peak=0.84, drive=1.25)


def synthesize_klaxon() -> Buffer:
    buffer = empty_buffer()
    for start in (0.04, 0.84, 1.64, 2.44, 3.24):
        add_tone(
            buffer,
            start,
            0.56,
            310.0,
            0.90,
            partials=((1.0, 1.0), (370 / 310, 0.88), (3.0, 0.17), (1_110 / 310, 0.13)),
            attack=0.012,
            release=0.055,
        )
    # Sustained low/mid energy is perceived much louder than a short chime, so
    # keep extra peak headroom while preserving the urgent horn rhythm.
    return finalize(buffer, target_peak=0.55, drive=1.7)


def synthesize_triple() -> Buffer:
    buffer = empty_buffer()
    for group in (0.10, 1.35, 2.60):
        for offset, frequency in ((0.00, 1_450.0), (0.17, 1_450.0), (0.34, 2_100.0)):
            add_tone(
                buffer,
                group + offset,
                0.095,
                frequency,
                0.94,
                partials=((1.0, 1.0), (2.0, 0.19)),
                attack=0.006,
                release=0.018,
            )
    return finalize(buffer, target_peak=0.84, drive=1.5)


def synthesize_sweep() -> Buffer:
    buffer = empty_buffer()
    for group in (0.10, 1.35, 2.60):
        for offset in (0.00, 0.29):
            add_tone(
                buffer,
                group + offset,
                0.19,
                lambda position: 430.0 * (3_200.0 / 430.0) ** (position / 0.19),
                0.92,
                partials=((1.0, 1.0), (2.0, 0.12)),
                attack=0.007,
                release=0.035,
            )
    return finalize(buffer, target_peak=0.84, drive=1.35)


def synthesize_knock() -> Buffer:
    buffer = empty_buffer()
    for cycle in (0.08, 1.33, 2.58):
        for offset, amplitude in ((0.00, 0.94), (0.29, 0.78)):
            add_tone(
                buffer,
                cycle + offset,
                0.24,
                lambda position: 190.0 + 290.0 * math.exp(-18.0 * position),
                amplitude,
                partials=((1.0, 1.0), (690 / 480, 0.34), (2.0, 0.12)),
                attack=0.004,
                release=0.09,
                decay=5.0,
            )
    return finalize(buffer, target_peak=0.79, drive=1.4)


def synthesize_crystal() -> Buffer:
    buffer = empty_buffer()
    for cycle in (0.08, 2.08):
        for offset, frequency, amplitude in (
            (0.00, 2_800.0, 0.78),
            (0.38, 2_050.0, 0.82),
            (0.80, 1_370.0, 0.88),
        ):
            add_tone(
                buffer,
                cycle + offset,
                0.62,
                frequency,
                amplitude,
                partials=((1.0, 1.0), (math.sqrt(2), 0.22), (2.03, 0.10)),
                attack=0.006,
                release=0.15,
                decay=3.3,
            )
    return finalize(buffer, target_peak=0.79, drive=1.1)


def synthesize_siren() -> Buffer:
    buffer = empty_buffer()
    for cycle in (0.03, 1.33, 2.63):
        add_tone(
            buffer,
            cycle,
            0.55,
            lambda position: 610.0 + 470.0 * (position / 0.55),
            0.96,
            partials=((1.0, 1.0), (2.0, 0.24), (3.0, 0.08)),
            attack=0.018,
            release=0.045,
        )
        add_tone(
            buffer,
            cycle + 0.63,
            0.55,
            lambda position: 1_080.0 - 470.0 * (position / 0.55),
            0.96,
            partials=((1.0, 1.0), (2.0, 0.24), (3.0, 0.08)),
            attack=0.018,
            release=0.045,
        )
    # The near-continuous sweep already sounds forceful; a lower peak keeps a
    # 28-second notification from becoming distorted or needlessly harsh.
    return finalize(buffer, target_peak=0.50, drive=1.55)


def finalize(buffer: Buffer, target_peak: float, drive: float) -> Buffer:
    shaped = [math.tanh(sample * drive) / math.tanh(drive) for sample in buffer]
    peak = max(abs(sample) for sample in shaped)
    if peak == 0:
        raise ValueError("cannot normalize an empty alarm sound")
    scale = target_peak / peak
    result = [sample * scale for sample in shaped]

    # Guard against clicks even when a pattern lands close to the loop boundary.
    fade_frames = round(0.012 * SAMPLE_RATE)
    for index in range(fade_frames):
        level = math.sin(index / fade_frames * math.pi / 2) ** 2
        result[index] *= level
        result[-1 - index] *= level
    result[0] = 0.0
    result[-1] = 0.0
    return result


def pcm16_frames(buffer: Buffer) -> bytes:
    return b"".join(
        struct.pack("<h", max(-32_768, min(32_767, round(sample * 32_767))))
        for sample in buffer
    )


def write_wav(path: Path, frames: bytes, repetitions: int = 1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(frames * repetitions)


def repair_legacy_bell_loop_boundary() -> None:
    """Apply a one-time short tail fade to the older bell loop if needed."""
    short_path = SOUND_DIR / "nolate_alarm_bell.wav"
    if not short_path.exists():
        return
    with wave.open(str(short_path), "rb") as source:
        if (
            source.getnchannels(),
            source.getsampwidth(),
            source.getframerate(),
            source.getnframes(),
        ) != (1, 2, SAMPLE_RATE, FRAME_COUNT):
            raise ValueError(f"unexpected legacy bell format: {short_path}")
        frames = source.readframes(FRAME_COUNT)
    samples = list(struct.unpack(f"<{FRAME_COUNT}h", frames))
    if samples[-1] == 0:
        return
    fade_frames = round(0.012 * SAMPLE_RATE)
    for index in range(fade_frames):
        level = math.sin((fade_frames - 1 - index) / (fade_frames - 1) * math.pi / 2) ** 2
        frame = FRAME_COUNT - fade_frames + index
        samples[frame] = round(samples[frame] * level)
    samples[-1] = 0
    repaired_frames = struct.pack(f"<{FRAME_COUNT}h", *samples)
    write_wav(short_path, repaired_frames)
    write_wav(SOUND_DIR / "nolate_alarm_bell_alert.wav", repaired_frames, ALERT_REPETITIONS)
    ANDROID_RAW_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(short_path, ANDROID_RAW_DIR / short_path.name)
    print("repaired nolate_alarm_bell.wav loop boundary")


def main() -> None:
    repair_legacy_bell_loop_boundary()
    sounds = {
        "digital": synthesize_digital,
        "klaxon": synthesize_klaxon,
        "triple": synthesize_triple,
        "sweep": synthesize_sweep,
        "knock": synthesize_knock,
        "crystal": synthesize_crystal,
        "siren": synthesize_siren,
    }
    for name, synthesize in sounds.items():
        frames = pcm16_frames(synthesize())
        short_path = SOUND_DIR / f"nolate_alarm_{name}.wav"
        alert_path = SOUND_DIR / f"nolate_alarm_{name}_alert.wav"
        write_wav(short_path, frames)
        write_wav(alert_path, frames, ALERT_REPETITIONS)
        ANDROID_RAW_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(short_path, ANDROID_RAW_DIR / short_path.name)
        print(f"generated {short_path.name} and {alert_path.name}")


if __name__ == "__main__":
    main()
