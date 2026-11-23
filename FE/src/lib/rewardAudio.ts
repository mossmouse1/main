const MUTE_KEY = 'parkdex:reward-muted';
let context: AudioContext | undefined;
let muted: boolean | undefined;

export function isRewardMuted(): boolean {
  if (muted !== undefined) return muted;
  try {
    muted = localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    muted = false;
  }
  return muted;
}

export function setRewardMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, String(value));
  } catch {
    // The current session still honors the toggle.
  }
}

export function prepareRewardAudio(): Promise<AudioContext | null> {
  if (isRewardMuted()) return Promise.resolve(null);
  try {
    const { AudioContext, webkitAudioContext } = window as Window & { AudioContext?: typeof globalThis.AudioContext; webkitAudioContext?: typeof globalThis.AudioContext };
    const Audio = AudioContext ?? webkitAudioContext;
    if (!Audio) return Promise.resolve(null);
    context ??= new Audio();
    const audio = context;
    // Resume inside the confirmation tap. Schedule notes only after saving succeeds.
    return audio.resume().then(() => audio, () => null);
  } catch {
    return Promise.resolve(null);
  }
}

export async function playRewardAudio(prepared: Promise<AudioContext | null>) {
  const audio = await prepared;
  if (!audio || audio.state !== 'running' || isRewardMuted()) return;

  const start = audio.currentTime + 0.015;
  const melody = [523.25, 659.25, 783.99, 1046.5];
  melody.forEach((pitch, i) => {
    const at = start + i * 0.087;
    for (const [ratio, volume, decay] of [[1, 0.12, 0.23], [4, 0.029, 0.082], [9.1, 0.009, 0.05]]) {
      const tone = audio.createOscillator();
      const level = audio.createGain();
      tone.frequency.value = pitch * ratio;
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(volume, at + 0.009);
      level.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      tone.connect(level).connect(audio.destination);
      tone.onended = () => { tone.disconnect(); level.disconnect(); };
      tone.start(at);
      tone.stop(at + decay + 0.012);
    }
  });
}
