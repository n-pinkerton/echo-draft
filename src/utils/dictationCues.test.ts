import { beforeEach, describe, expect, it, vi } from "vitest";

type ScheduledOscillator = {
  type: string;
  frequency: {
    values: Array<{ value: number; time: number }>;
    ramps: Array<{ value: number; time: number }>;
  };
};

describe("dictation cues", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("uses unrelated signatures for start, process, and delivery", async () => {
    const oscillators: ScheduledOscillator[] = [];

    class FakeAudioContext {
      state = "running";
      currentTime = 10;
      destination = {};

      createOscillator() {
        const oscillator = {
          type: "sine",
          frequency: {
            values: [] as Array<{ value: number; time: number }>,
            ramps: [] as Array<{ value: number; time: number }>,
            setValueAtTime(value: number, time: number) {
              this.values.push({ value, time });
            },
            exponentialRampToValueAtTime(value: number, time: number) {
              this.ramps.push({ value, time });
            },
          },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(oscillator);
        return oscillator;
      }

      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
    }

    (window as any).AudioContext = FakeAudioContext;
    const { playCompletionCue, playStartCue, playStopCue, playWarningCue } =
      await import("./dictationCues");

    await playStartCue({ force: true, volume: 100 });
    expect(oscillators).toHaveLength(2);
    expect(oscillators.map((oscillator) => oscillator.frequency.values[0].value)).toEqual([
      440, 659.25,
    ]);

    await playStopCue({ force: true, volume: 100 });
    expect(oscillators).toHaveLength(4);
    expect(oscillators[2].frequency.values[0].value).toBe(783.99);
    expect(oscillators[2].frequency.ramps[0].value).toBe(261.63);
    expect(oscillators[3].frequency.values[0].value).toBe(174.61);

    await playCompletionCue({ force: true, volume: 100 });
    expect(oscillators).toHaveLength(8);
    expect(
      oscillators.slice(4, 7).map((oscillator) => oscillator.frequency.values[0].value)
    ).toEqual([523.25, 659.25, 783.99]);
    expect(oscillators[4].frequency.values[0].time).toBe(oscillators[5].frequency.values[0].time);
    expect(oscillators[7].frequency.values[0].value).toBe(196);

    await playWarningCue({ force: true, volume: 100 });
    expect(oscillators).toHaveLength(10);
    expect(oscillators.slice(8).map((oscillator) => oscillator.frequency.values[0].value)).toEqual([
      392, 329.63,
    ]);
  });

  it("respects disabled sounds while allowing explicit previews", async () => {
    const createOscillator = vi.fn(() => ({
      type: "sine",
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    (window as any).AudioContext = class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator = createOscillator;
      createGain = () => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      });
    };

    const { DICTATION_FEEDBACK_STORAGE_KEYS, playStartCue } = await import("./dictationCues");
    localStorage.setItem(DICTATION_FEEDBACK_STORAGE_KEYS.soundsEnabled, "false");

    await playStartCue();
    expect(createOscillator).not.toHaveBeenCalled();

    await playStartCue({ force: true, volume: 65 });
    expect(createOscillator).toHaveBeenCalledTimes(2);
  });

  it("uses the audible default volume when no stored volume exists", async () => {
    const createOscillator = vi.fn(() => ({
      type: "sine",
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    const peakGains: number[] = [];
    (window as any).AudioContext = class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator = createOscillator;
      createGain = () => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn((value: number) => peakGains.push(value)),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      });
    };

    const { playStartCue } = await import("./dictationCues");
    await playStartCue();

    expect(createOscillator).toHaveBeenCalledTimes(2);
    expect(peakGains.every((gain) => gain > 0.05)).toBe(true);
  });
});
