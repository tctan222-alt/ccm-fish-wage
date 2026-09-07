import { createHash } from 'node:crypto'
import type { AudioInput, AudioMetadata } from '../shared/types.ts'

export const MAX_DURATION_SECONDS = 45
export const MAX_AUDIO_BYTES = 44 + 16000 * 2 * MAX_DURATION_SECONDS

/** Accept only the canonical WAV produced locally by the browser. Never transcode per provider. */
export function readAudio(base64: unknown, sampleId: string): { input: AudioInput; metadata: AudioMetadata } {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error('音频必须是有效的 WAV base64。')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.toString('base64') !== base64 || bytes.length <= 44 || bytes.length > MAX_AUDIO_BYTES) throw new Error('音频为空或超过 45 秒。')
  const valid = bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) === bytes.length - 8
    && bytes.toString('latin1', 8, 16) === 'WAVEfmt ' && bytes.readUInt32LE(16) === 16
    && bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(22) === 1 && bytes.readUInt32LE(24) === 16000
    && bytes.readUInt32LE(28) === 32000 && bytes.readUInt16LE(32) === 2 && bytes.readUInt16LE(34) === 16
    && bytes.toString('latin1', 36, 40) === 'data' && bytes.readUInt32LE(40) === bytes.length - 44 && (bytes.length - 44) % 2 === 0
  if (!valid) throw new Error('只接受本地转换的 16 kHz 单声道 PCM16 WAV。')
  const durationMs = (bytes.length - 44) / 32
  const input: AudioInput = { bytes, mimeType: 'audio/wav', fileName: `${sampleId}.wav`, sampleRate: 16000, channels: 1, durationMs }
  return { input, metadata: { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mimeType: input.mimeType, sampleRate: input.sampleRate, channels: input.channels, durationMs, fileName: input.fileName } }
}
