// Web Audio API Synthesizer for Space-Cockpit Sound FX
// Generates audio programmatically with zero dependencies or assets loading.

let audioCtx: AudioContext | null = null;
let muted = localStorage.getItem('perry-audio-mute') === 'true';
const subscribers = new Set<(muted: boolean) => void>();

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    // Standard AudioContext or Webkit equivalent
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  // If browser suspended audio context, resume on user interaction
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(val: boolean) {
  muted = val;
  localStorage.setItem('perry-audio-mute', String(val));
  subscribers.forEach(cb => cb(muted));
}

export function subscribeMuteChange(cb: (muted: boolean) => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// Helper to create oscillators with volume envelopes
function playSynth(options: {
  type: OscillatorType;
  freqStart: number;
  freqEnd?: number;
  duration: number; // in seconds
  volume: number;
  decayType?: 'linear' | 'exponential';
  detune?: number;
}) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  // Make sure state is resumed
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  try {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = options.type;
    osc.frequency.setValueAtTime(options.freqStart, ctx.currentTime);
    
    if (options.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(options.freqEnd, ctx.currentTime + options.duration);
    }
    
    if (options.detune !== undefined) {
      osc.detune.setValueAtTime(options.detune, ctx.currentTime);
    }

    gainNode.gain.setValueAtTime(options.volume, ctx.currentTime);
    
    if (options.decayType === 'exponential') {
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + options.duration);
    } else {
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + options.duration);
    }

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + options.duration);
  } catch (e) {
    // Silently catch audio context errors (e.g. browser security blocks before user clicks)
  }
}

// 1. Subtle Hover tick (gentle triangle chip)
export function playHoverSound() {
  playSynth({
    type: 'triangle',
    freqStart: 880,
    freqEnd: 440,
    duration: 0.04,
    volume: 0.015,
    decayType: 'exponential'
  });
}

// 2. High-Tech Click (sharp sinus wave sweep)
export function playClickSound() {
  playSynth({
    type: 'sine',
    freqStart: 1200,
    freqEnd: 600,
    duration: 0.08,
    volume: 0.04,
    decayType: 'exponential'
  });
}

// 3. Tab Navigation / Menu transition (double sci-fi pip)
export function playSelectSound() {
  playSynth({
    type: 'sine',
    freqStart: 440,
    freqEnd: 880,
    duration: 0.12,
    volume: 0.03,
    decayType: 'exponential'
  });
  
  // Second delayed pitch pip
  setTimeout(() => {
    if (muted) return;
    playSynth({
      type: 'sine',
      freqStart: 1320,
      freqEnd: 1760,
      duration: 0.06,
      volume: 0.025,
      decayType: 'exponential'
    });
  }, 60);
}

// 4. Comms Msg Received (cyber notification chime)
export function playCommsRecvSound() {
  playSynth({
    type: 'sine',
    freqStart: 587.33, // D5
    freqEnd: 1174.66, // D6
    duration: 0.15,
    volume: 0.04,
    decayType: 'exponential'
  });
  
  setTimeout(() => {
    if (muted) return;
    playSynth({
      type: 'sine',
      freqStart: 880, // A5
      freqEnd: 1760, // A6
      duration: 0.22,
      volume: 0.035,
      decayType: 'exponential'
    });
  }, 80);
}

// 5. Comms Msg Sent (descending telemetry lock)
export function playCommsSendSound() {
  playSynth({
    type: 'sine',
    freqStart: 1500,
    freqEnd: 300,
    duration: 0.2,
    volume: 0.035,
    decayType: 'exponential'
  });
}

// 6. Startup/Boot sound (cyber synth pip)
export function playBootChime(index: number) {
  const notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];
  const freq = notes[index % notes.length];
  playSynth({
    type: 'sine',
    freqStart: freq,
    freqEnd: freq * 1.5,
    duration: 0.1,
    volume: 0.02,
    decayType: 'exponential'
  });
}

// 7. Startup Complete (futuristic landing confirmation tone)
export function playBootFinish() {
  playSynth({
    type: 'sine',
    freqStart: 523.25, // C5
    freqEnd: 1046.50, // C6
    duration: 0.25,
    volume: 0.035,
    decayType: 'exponential'
  });
  setTimeout(() => {
    if (muted) return;
    playSynth({
      type: 'sine',
      freqStart: 1318.51, // E6
      freqEnd: 2093.00, // C7
      duration: 0.4,
      volume: 0.03,
      decayType: 'exponential'
    });
  }, 120);
}
