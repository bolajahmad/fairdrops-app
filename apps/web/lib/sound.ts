const KEY = "fairdrops-sound";
const listeners = new Set<() => void>();

let unlocked = false;
let enabled = true;

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadSoundPreference(): boolean {
  if (typeof window === "undefined") return true;
  enabled = window.localStorage.getItem(KEY) !== "off";
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, on ? "on" : "off");
  for (const listener of listeners) listener();
}

export function unlockSound(): void {
  unlocked = true;
}

/** Short game blip. Stays silent until the first pointer and while muted. */
export function playBlip(frequency = 660): void {
  if (!unlocked || !enabled || typeof window === "undefined") return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = "triangle";
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.06);
  oscillator.onended = () => {
    void context.close();
  };
}
