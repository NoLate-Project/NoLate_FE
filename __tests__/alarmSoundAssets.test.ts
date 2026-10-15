export {};

type BinaryBuffer = {
  length: number;
  toString(encoding: "ascii", start: number, end: number): string;
  readUInt32LE(offset: number): number;
  readUInt16LE(offset: number): number;
  readInt16LE(offset: number): number;
  subarray(start: number, end?: number): BinaryBuffer;
  equals(other: BinaryBuffer): boolean;
};

const fs = jest.requireActual("fs") as {
  readFileSync(filePath: string): BinaryBuffer;
};
const crypto = jest.requireActual("crypto") as {
  createHash(algorithm: string): {
    update(data: BinaryBuffer): { digest(encoding: "hex"): string };
  };
};

const SAMPLE_RATE = 44_100;
const BYTES_PER_SAMPLE = 2;
const SHORT_SECONDS = 4;
const ALERT_REPETITIONS = 7;
const ALERT_SECONDS = SHORT_SECONDS * ALERT_REPETITIONS;
const SOUND_ROOT = "assets/sounds";
const ANDROID_RAW_ROOT =
  "modules/nolate-alarm/android/src/main/res/raw";

const SOUND_ASSETS = [
  ["nolate_departure_chime.wav", "nolate_departure_alert.wav"],
  ["nolate_alarm_bell.wav", "nolate_alarm_bell_alert.wav"],
  ["nolate_alarm_beep.wav", "nolate_alarm_beep_alert.wav"],
  ["nolate_alarm_crystal.wav", "nolate_alarm_crystal_alert.wav"],
  ["nolate_alarm_digital.wav", "nolate_alarm_digital_alert.wav"],
  ["nolate_alarm_klaxon.wav", "nolate_alarm_klaxon_alert.wav"],
  ["nolate_alarm_knock.wav", "nolate_alarm_knock_alert.wav"],
  ["nolate_alarm_siren.wav", "nolate_alarm_siren_alert.wav"],
  ["nolate_alarm_sweep.wav", "nolate_alarm_sweep_alert.wav"],
  ["nolate_alarm_triple.wav", "nolate_alarm_triple_alert.wav"],
] as const;

type Wav = {
  bytes: BinaryBuffer;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  data: BinaryBuffer;
};

function parseWav(filePath: string): Wav {
  const bytes = fs.readFileSync(filePath);
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`${filePath} is not a RIFF/WAVE file`);
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error(`${filePath} has an invalid RIFF size`);
  }

  let format: Omit<Wav, "bytes" | "data"> | undefined;
  let data: BinaryBuffer | undefined;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > bytes.length) {
      throw new Error(`${filePath} has a truncated ${chunkId} chunk`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error(`${filePath} has an invalid fmt chunk`);
      }
      format = {
        audioFormat: bytes.readUInt16LE(chunkStart),
        channels: bytes.readUInt16LE(chunkStart + 2),
        sampleRate: bytes.readUInt32LE(chunkStart + 4),
        byteRate: bytes.readUInt32LE(chunkStart + 8),
        blockAlign: bytes.readUInt16LE(chunkStart + 12),
        bitsPerSample: bytes.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      data = bytes.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format || !data) {
    throw new Error(`${filePath} is missing a fmt or data chunk`);
  }
  return { bytes, ...format, data };
}

function expectPcm16Mono(wav: Wav, seconds: number): void {
  expect(wav.audioFormat).toBe(1);
  expect(wav.channels).toBe(1);
  expect(wav.sampleRate).toBe(SAMPLE_RATE);
  expect(wav.bitsPerSample).toBe(16);
  expect(wav.blockAlign).toBe(BYTES_PER_SAMPLE);
  expect(wav.byteRate).toBe(SAMPLE_RATE * BYTES_PER_SAMPLE);
  expect(wav.data.length).toBe(
    SAMPLE_RATE * seconds * BYTES_PER_SAMPLE,
  );
}

function expectCleanBoundaries(wav: Wav): void {
  let peak = 0;
  for (let offset = 0; offset < wav.data.length; offset += BYTES_PER_SAMPLE) {
    peak = Math.max(peak, Math.abs(wav.data.readInt16LE(offset)));
  }

  expect(wav.data.readInt16LE(0)).toBe(0);
  expect(wav.data.readInt16LE(wav.data.length - BYTES_PER_SAMPLE)).toBe(0);
  expect(peak).toBeLessThan(32_767);
}

describe("alarm sound asset contract", () => {
  it("defines exactly ten distinct short and alert asset pairs", () => {
    expect(SOUND_ASSETS).toHaveLength(10);
    expect(new Set(SOUND_ASSETS.map(([shortFile]) => shortFile)).size).toBe(10);
    expect(new Set(SOUND_ASSETS.map(([, alertFile]) => alertFile)).size).toBe(10);
  });

  it.each(SOUND_ASSETS)(
    "keeps %s and %s in the canonical WAV format",
    (shortFile, alertFile) => {
      const short = parseWav(`${SOUND_ROOT}/${shortFile}`);
      const alert = parseWav(`${SOUND_ROOT}/${alertFile}`);

      expectPcm16Mono(short, SHORT_SECONDS);
      expectPcm16Mono(alert, ALERT_SECONDS);

      expectCleanBoundaries(short);
      expectCleanBoundaries(alert);
    },
  );

  it.each(SOUND_ASSETS)(
    "builds %s's alert payload from exactly seven short payloads",
    (shortFile, alertFile) => {
      const short = parseWav(`${SOUND_ROOT}/${shortFile}`);
      const alert = parseWav(`${SOUND_ROOT}/${alertFile}`);
      for (let repetition = 0; repetition < ALERT_REPETITIONS; repetition += 1) {
        const start = repetition * short.data.length;
        const repeatedChunk = alert.data.subarray(start, start + short.data.length);
        expect(repeatedChunk.equals(short.data)).toBe(true);
      }
    },
  );

  it.each(SOUND_ASSETS)(
    "keeps the Android raw copy of %s byte-for-byte identical",
    shortFile => {
      const canonical = fs.readFileSync(`${SOUND_ROOT}/${shortFile}`);
      const android = fs.readFileSync(`${ANDROID_RAW_ROOT}/${shortFile}`);

      expect(android.equals(canonical)).toBe(true);
    },
  );

  it("keeps all ten short PCM payload hashes unique", () => {
    const hashes = SOUND_ASSETS.map(([shortFile]) =>
      crypto
        .createHash("sha256")
        .update(parseWav(`${SOUND_ROOT}/${shortFile}`).data)
        .digest("hex"),
    );

    expect(new Set(hashes).size).toBe(SOUND_ASSETS.length);
  });
});
