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
  const now = audioContext.currentTime
  const gain = audioContext.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.78)
  gain.connect(audioContext.destination)
  ;[523.25, 659.25].forEach((frequency, index) => {
    const oscillator = audioContext!.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    oscillator.connect(gain)
    oscillator.start(now + index * 0.18)
    oscillator.stop(now + 0.72 + index * 0.06)
  })
}
