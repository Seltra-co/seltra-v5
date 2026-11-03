let audioContext: AudioContext | null = null

export function unlockCompletionTone() {
  if (typeof window === 'undefined') return
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return
  audioContext ??= new AudioContextClass()
  if (audioContext.state === 'suspended') void audioContext.resume()
}

export function soundEffectsEnabled() {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem('seltra:sound-effects') !== 'off'
}

export function setSoundEffectsEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('seltra:sound-effects', enabled ? 'on' : 'off')
}

export function playCompletionTone() {
  if (!soundEffectsEnabled() || typeof window === 'undefined') return
  unlockCompletionTone()
  if (!audioContext) return
  if (audioContext.state === 'suspended') {
    void audioContext.resume().then(() => playCompletionTone())
    return
  }
  const context = audioContext
  const now = context.currentTime + 0.02
  const gain = context.createGain()
  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = -12
  limiter.knee.value = 8
  limiter.ratio.value = 12
  limiter.attack.value = 0.003
  limiter.release.value = 0.18
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.85, now + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
  gain.connect(limiter)
  limiter.connect(context.destination)
  ;[523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(frequency, now + index * 0.16)
    oscillator.connect(gain)
    oscillator.start(now + index * 0.16)
    oscillator.stop(now + 0.78 + index * 0.08)
  })
}
