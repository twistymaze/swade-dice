import { describe, expect, it, vi } from "vitest";
import { attachOneShotCleanup, releaseSound } from "./oneShotSound";

/** Fake sound that binds `onEnded` inside `play()` like three.js `Audio.play`. */
class FakeSound {
  isPlaying = false;
  disconnect = vi.fn();
  gain = { disconnect: vi.fn() };
  private ended: (() => void) | null = null;
  onEnded() {
    this.isPlaying = false;
  }
  play() {
    this.isPlaying = true;
    this.ended = this.onEnded.bind(this);
  }
  /** Simulate the AudioBufferSourceNode `ended` event. */
  end() {
    this.ended?.();
  }
}

class FakeGroup {
  children: FakeSound[] = [];
  add(sound: FakeSound) {
    this.children.push(sound);
  }
  remove(sound: FakeSound) {
    this.children = this.children.filter((c) => c !== sound);
  }
}

describe("collision sound cleanup", () => {
  it("removes and disconnects the sound when playback ends", () => {
    const group = new FakeGroup();
    const sound = new FakeSound();
    attachOneShotCleanup(sound, group);
    sound.play();
    group.add(sound);
    expect(group.children).toHaveLength(1);

    sound.end();

    expect(group.children).toHaveLength(0);
    expect(sound.disconnect).toHaveBeenCalledTimes(1);
    expect(sound.gain.disconnect).toHaveBeenCalledTimes(1);
    // The three.js base onEnded still runs.
    expect(sound.isPlaying).toBe(false);
  });

  it("documents the old bug: onEnded set after play() never runs", () => {
    const group = new FakeGroup();
    const sound = new FakeSound();
    sound.play();
    sound.onEnded = () => group.remove(sound);
    group.add(sound);
    sound.end();
    expect(group.children).toHaveLength(1);
  });

  it("25 plays leave no children after all end", () => {
    const group = new FakeGroup();
    const sounds = Array.from({ length: 25 }, () => {
      const sound = new FakeSound();
      attachOneShotCleanup(sound, group);
      sound.play();
      group.add(sound);
      return sound;
    });
    expect(group.children).toHaveLength(25);
    sounds.forEach((s) => s.end());
    expect(group.children).toHaveLength(0);
  });

  it("releaseSound disconnects a sound stopped by hand", () => {
    const sound = new FakeSound();
    releaseSound(sound);
    expect(sound.disconnect).toHaveBeenCalledTimes(1);
    expect(sound.gain.disconnect).toHaveBeenCalledTimes(1);
  });
});
