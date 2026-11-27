import * as THREE from "three";

/** The parts of a three.js `Audio` that the one-shot cleanup uses. */
export interface OneShotAudio {
  onEnded(): void;
  disconnect(): unknown;
  gain: { disconnect(): void };
}

/** The parts of a three.js `Object3D` that the one-shot cleanup uses. */
export interface SoundParent<T> {
  remove(object: T): unknown;
}

/**
 * Make `sound` remove itself from `parent` and free its audio nodes when playback ends.
 *
 * Call this BEFORE `sound.play()`: three.js binds `source.onended = this.onEnded.bind(this)`
 * inside `play()`, so an `onEnded` that is set after `play()` never runs.
 */
export function attachOneShotCleanup<T extends OneShotAudio>(
  sound: T,
  parent: SoundParent<T>
) {
  const baseOnEnded = sound.onEnded.bind(sound);
  sound.onEnded = () => {
    baseOnEnded();
    parent.remove(sound);
    sound.disconnect();
    // The gain node stays connected to the listener input until it is disconnected.
    sound.gain.disconnect();
  };
}

/** Disconnect a sound that was stopped by hand (no `onended` event follows `stop()`). */
export function releaseSound(sound: OneShotAudio) {
  sound.disconnect();
  sound.gain.disconnect();
}

/** Play `buffer` once at the position of `parent`, then remove and disconnect the sound. */
export function playOneShotSound(
  listener: THREE.AudioListener,
  buffer: AudioBuffer,
  parent: THREE.Object3D,
  { refDistance, volume }: { refDistance: number; volume: number }
) {
  const sound = new THREE.PositionalAudio(listener);
  sound.setBuffer(buffer);
  sound.setRefDistance(refDistance);
  attachOneShotCleanup<THREE.PositionalAudio>(sound, parent);
  sound.play();
  sound.setVolume(volume);
  parent.add(sound);
  return sound;
}
