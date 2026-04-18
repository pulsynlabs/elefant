import { describe, it, expect } from 'bun:test'
import type { App } from './app.ts'

describe('App type export', () => {
  it('App type is exported and usable', () => {
    // Type-level check — if this compiles, the type is valid
    type _Check = App extends never ? false : true
    const _valid: _Check = true
    expect(_valid).toBe(true)
  })
})
