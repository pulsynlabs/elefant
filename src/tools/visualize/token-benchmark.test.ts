import { describe, it, expect } from 'bun:test'
import { fixtures } from './token-benchmark-fixtures.js'

/** Estimate token count using chars/4 heuristic */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

describe('Token efficiency benchmark (MH8)', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: visualize call ≤70% of markdown token count`, () => {
      const vizJson = JSON.stringify(fixture.vizCall)
      const vizTokens = estimateTokens(vizJson)
      const mdTokens = estimateTokens(fixture.markdownEquiv)
      
      const ratio = vizTokens / mdTokens
      
      console.log(`[${fixture.name}]`)
      console.log(`  Viz call: ${vizTokens} tokens (${vizJson.length} chars)`)
      console.log(`  Markdown: ${mdTokens} tokens (${fixture.markdownEquiv.length} chars)`)
      console.log(`  Ratio: ${(ratio * 100).toFixed(1)}% (target: ≤70%)`)
      
      expect(ratio).toBeLessThanOrEqual(0.70)
    })
  }
  
  it('all fixtures have valid viz type', () => {
    const validTypes = ['mermaid', 'table', 'stat-grid', 'code', 'research-card', 'loading', 'comparison']
    for (const f of fixtures) {
      expect(validTypes).toContain((f.vizCall as { type: string }).type)
    }
  })
})
