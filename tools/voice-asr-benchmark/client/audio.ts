export function encodeWav(samples: Float32Array, rate = 16000): ArrayBuffer {
  if (!samples.length || !Number.isInteger(rate) || rate < 1 || rate > 192000 || samples.some(sample => !Number.isFinite(sample))) throw new Error('音频采样数据无效。')
  const data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data)
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true) })
  return data
}
export async function normalizeAudio(blob: Blob, maxSeconds: number): Promise<{ blob: Blob; duration: number }> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    if (!decoded.length || decoded.duration > maxSeconds + 0.2) throw new Error(`音频须在 ${maxSeconds} 秒以内。`)
    const frames = Math.min(Math.round(maxSeconds * 16000), Math.round(decoded.duration * 16000))
    const offline = new OfflineAudioContext(1, frames, 16000), source = offline.createBufferSource()
    source.buffer = decoded; source.connect(offline.destination); source.start()
    const rendered = await offline.startRendering()
    return { blob: new Blob([encodeWav(rendered.getChannelData(0))], { type: 'audio/wav' }), duration: frames / 16000 }
  } finally { await context.close() }
}
