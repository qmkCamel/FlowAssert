import { createHash } from 'node:crypto'

/** Content identity without importing storage ownership or recovery machinery. */
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
