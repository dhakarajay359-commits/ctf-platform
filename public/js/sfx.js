// Cyberpunk Sound Effects using Web Audio API (No external files needed)
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq, type, duration, vol) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

window.playHoverSound = () => {
  if (window.zenModeActive) return;
  playTone(800, 'sine', 0.05, 0.01);
};

window.playClickSound = () => {
  if (window.zenModeActive) return;
  playTone(1200, 'square', 0.05, 0.02);
  setTimeout(() => playTone(800, 'square', 0.05, 0.02), 30);
};

window.playAlertSound = () => {
  if (window.zenModeActive) return;
  // Deep bass siren
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 1.5);
  
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.5);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 1.5);
};

// Bind to DOM
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.challenge-card')) {
      playHoverSound();
    }
  });
  
  document.body.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.challenge-card')) {
      playClickSound();
    }
  });
});
