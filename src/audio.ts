export type Playback = { startsAt: number; endsAt: number; finished: Promise<void>; stop: () => void };

export function scheduleChord(context: BaseAudioContext, notes: readonly number[], at: number): Playback {
  const startsAt = Math.max(context.currentTime, at);
  const duration = 2.6;
  const bus = context.createGain();
  bus.connect(context.destination);
  const oscillators: OscillatorNode[] = [];
  const envelopes: GainNode[] = [];
  const partials = [1, 0.42, 0.18, 0.1, 0.045];
  const endsAt = startsAt + duration + Math.max(0, notes.length - 1) * 0.018;
  let stopped = false;
  const finished = new Promise<void>(resolve => {
    let remaining = notes.length * partials.length;
    const disconnect = () => { for (const envelope of envelopes) envelope.disconnect(); bus.disconnect(); resolve(); };
    for (const [string, midi] of notes.entries()) {
      const start = startsAt + string * 0.018;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      for (const [partial, weight] of partials.entries()) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency * (partial + 1);
        oscillator.detune.value = string % 2 === 0 ? -1.2 : 1.2;
        const peak = 0.34 * weight / Math.max(1, notes.length);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(peak, start + 0.004);
        envelope.gain.exponentialRampToValueAtTime(0.00001, start + duration / (1 + partial * 0.38));
        envelope.gain.setValueAtTime(0, start + duration);
        oscillator.connect(envelope); envelope.connect(bus);
        oscillator.start(start); oscillator.stop(start + duration);
        oscillator.onended = () => { oscillator.disconnect(); if (--remaining === 0) disconnect(); };
        oscillators.push(oscillator); envelopes.push(envelope);
      }
    }
    if (!remaining) disconnect();
  });
  return {
    startsAt,
    endsAt,
    finished,
    stop() {
      if (stopped) return;
      stopped = true;
      bus.disconnect();
      for (const oscillator of oscillators) oscillator.stop(context.currentTime);
    },
  };
}
