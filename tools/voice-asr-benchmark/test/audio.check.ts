import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav } from '../client/audio.ts'

test('WAV contains an exact mono PCM16 header and signed sample payload', () => {
  const samples = new Float32Array([-1, -0.5, 0, 0.5, 1])
  const encoded = encodeWav(samples), view = new DataView(encoded)
  const text = (offset: number, length: number) => new TextDecoder().decode(new Uint8Array(encoded, offset, length))
  assert.equal(encoded.byteLength, 54)
  assert.equal(text(0, 4), 'RIFF'); assert.equal(view.getUint32(4, true), 46)
  assert.equal(text(8, 4), 'WAVE'); assert.equal(text(12, 4), 'fmt ')
  assert.equal(view.getUint32(16, true), 16); assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint32(28, true), 32000); assert.equal(view.getUint16(32, true), 2)
  assert.equal(view.getUint16(34, true), 16); assert.equal(text(36, 4), 'data')
  assert.equal(view.getUint32(40, true), 10)
  assert.deepEqual(samples.map((_, i) => view.getInt16(44 + i * 2, true)), new Float32Array([-32768, -16384, 0, 16384, 32767]))
  samples.forEach((sample, i) => {
    const pcm = view.getInt16(44 + i * 2, true), decoded = pcm / (pcm < 0 ? 32768 : 32767)
    assert.ok(Math.abs(sample - decoded) <= 1 / 32767)
  })
})

test('WAV clips overrange samples and retains exact duration and size', () => {
  const samples = new Float32Array(16000 * 45); samples[0] = -2; samples[1] = 2
  const view = new DataView(encodeWav(samples))
  assert.equal(view.byteLength, 44 + 45 * 32000)
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(46, true), 32767)
  assert.equal(view.getUint32(40, true) / view.getUint32(28, true), 45)
})

test('WAV rejects empty, nonfinite samples and invalid sample rates', () => {
  for (const samples of [new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity])]) assert.throws(() => encodeWav(samples), /无效/)
  for (const rate of [0, -1, NaN, Infinity, 16000.5, 192001]) assert.throws(() => encodeWav(new Float32Array([0]), rate), /无效/)
})
