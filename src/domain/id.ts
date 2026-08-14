function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes)
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return bytes
}

/** Generates an RFC 9562 UUIDv7 with millisecond-sortable timestamp bits. */
export function createUuidV7(now: Date | number = Date.now()): string {
  const timestamp = typeof now === 'number' ? now : now.getTime()
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
    throw new RangeError('UUID timestamp is outside the supported range')
  }

  const bytes = randomBytes(16)
  let time = Math.floor(timestamp)
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256
    time = Math.floor(time / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
