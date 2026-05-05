export interface BenchmarkFixture {
  name: string
  vizCall: object   // the visualize tool call JSON
  markdownEquiv: string  // equivalent markdown representation (prose style)
}

export const fixtures: BenchmarkFixture[] = [
  {
    name: 'stat-grid (8 items)',
    vizCall: {
      type: 'stat-grid',
      data: {
        items: [
          { label: 'Tests', value: 462, delta: 12, trend: 'up' },
          { label: 'Coverage', value: '91%', trend: 'up' },
          { label: 'Build Time', value: '14.4s', delta: -2, trend: 'down' },
          { label: 'Bundle', value: '2.1MB', trend: 'flat' },
          { label: 'Errors', value: 0, trend: 'flat' },
          { label: 'Warnings', value: 3, delta: -5, trend: 'down' },
          { label: 'Dependencies', value: 142, trend: 'flat' },
          { label: 'Outdated', value: 12, delta: 3, trend: 'up' }
        ]
      },
      intent: 'Show build metrics'
    },
    markdownEquiv: `## Build Metrics

**Tests**: The test suite contains 462 tests, which is an increase of 12 from the previous run. The trend is upward.

**Coverage**: Code coverage is currently at 91%. The trend is upward.

**Build Time**: The build completes in 14.4 seconds, which is 2 seconds faster than before. The trend is downward.

**Bundle**: The bundle size is 2.1MB. The trend is flat with no significant change.

**Errors**: There are currently 0 errors. The trend is flat.

**Warnings**: There are 3 warnings, which is 5 fewer than the previous count. The trend is downward.

**Dependencies**: The project has 142 dependencies. The trend is flat.

**Outdated**: There are 12 outdated dependencies, which is 3 more than before. The trend is upward.`
  },
  {
    name: 'table (4 cols, 6 rows)',
    vizCall: {
      type: 'table',
      data: {
        cols: ['Provider', 'Model', 'Context', 'Price'],
        rows: [
          { Provider: 'Anthropic', Model: 'claude-3-5-sonnet', Context: '200K', Price: '$3/$15' },
          { Provider: 'OpenAI', Model: 'gpt-4o', Context: '128K', Price: '$5/$15' },
          { Provider: 'Google', Model: 'gemini-1.5-pro', Context: '1M', Price: '$3.50/$10.50' },
          { Provider: 'Mistral', Model: 'mistral-large', Context: '32K', Price: '$2/$6' },
          { Provider: 'Cohere', Model: 'command-r-plus', Context: '128K', Price: '$3/$15' },
          { Provider: 'AI21', Model: 'jamba-1.5-large', Context: '256K', Price: '$2/$8' }
        ]
      },
      intent: 'Compare LLM providers'
    },
    markdownEquiv: `## LLM Provider Comparison

**Anthropic** offers the claude-3-5-sonnet model with a 200K context window. Pricing is $3 per million input tokens and $15 per million output tokens.

**OpenAI** offers the gpt-4o model with a 128K context window. Pricing is $5 per million input tokens and $15 per million output tokens.

**Google** offers the gemini-1.5-pro model with a 1M context window. Pricing is $3.50 per million input tokens and $10.50 per million output tokens.

**Mistral** offers the mistral-large model with a 32K context window. Pricing is $2 per million input tokens and $6 per million output tokens.

**Cohere** offers the command-r-plus model with a 128K context window. Pricing is $3 per million input tokens and $15 per million output tokens.

**AI21** offers the jamba-1.5-large model with a 256K context window. Pricing is $2 per million input tokens and $8 per million output tokens.`
  },
  {
    name: 'field-notes-card (4 cards)',
    vizCall: {
      type: 'field-notes-card',
      data: {
        cards: [
          { title: 'OpenCode Architecture', summary: 'Effect-TS service composition with plugin hooks.', url: 'fieldnotes://02-tech/opencode', confidence: 0.9, tags: ['opencode', 'effect-ts', 'plugins'] },
          { title: 'GoopSpec Workflow', summary: 'Spec-driven development via behavioral hooks.', url: 'fieldnotes://02-harness/goopspec', confidence: 0.85, tags: ['goopspec', 'spec-driven'] },
          { title: 'Pi Extension API', summary: 'Minimal runtime with JSONL session tree.', url: 'fieldnotes://02-harness/pi', confidence: 0.75, tags: ['pi', 'extension-api'] },
          { title: 'Claude Code Hooks', summary: 'Permission model with sub-agent system.', url: 'fieldnotes://02-tech/claude-code', confidence: 0.8, tags: ['claude', 'hooks', 'agents'] }
        ]
      },
      intent: 'Show research findings'
    },
    markdownEquiv: `### Research Findings on Agent Platforms

**OpenCode Architecture** (confidence level: high, approximately 90%)
This research finding covers OpenCode's architecture which uses Effect-TS service composition with plugin hooks for lifecycle management. The implementation demonstrates how functional programming patterns can be applied to agent runtime design. Relevant tags include: opencode, effect-ts, plugins. Source reference: fieldnotes://02-tech/opencode

**GoopSpec Workflow** (confidence level: high, approximately 85%)
This research finding covers GoopSpec's workflow which enforces spec-driven development via behavioral hooks and markdown state files. The system provides a structured approach to agent task management with clear contracts. Relevant tags include: goopspec, spec-driven. Source reference: fieldnotes://02-harness/goopspec

**Pi Extension API** (confidence level: medium, approximately 75%)
This research finding covers Pi's extension API which keeps the runtime minimal with JSONL session tree and clean extension interface. The design philosophy emphasizes simplicity in the core with extensibility at the edges. Relevant tags include: pi, extension-api. Source reference: fieldnotes://02-harness/pi

**Claude Code Hooks** (confidence level: high, approximately 80%)
This research finding covers Claude Code's hooks which provide a permission model with sub-agent system and event-based hooks. The architecture enables fine-grained control over agent capabilities. Relevant tags include: claude, hooks, agents. Source reference: fieldnotes://02-tech/claude-code`
  },
  {
    name: 'comparison (2 sides, 6 items each)',
    vizCall: {
      type: 'comparison',
      data: {
        left: { 
          title: 'Approach A: Inline rendering', 
          items: [
            'Renders in transcript flow without context switch',
            'Simpler routing logic and implementation',
            'Lower implementation cost and maintenance',
            'Faster initial page load performance',
            'Native scroll behavior maintained',
            'Mobile-friendly responsive design'
          ] 
        },
        right: { 
          title: 'Approach B: Side panel', 
          items: [
            'Separate dedicated view for focused work',
            'Preserves chat readability and context',
            'More complex routing and state management',
            'Two-pane layout required for implementation',
            'Better suited for large content blocks',
            'Export-friendly format for sharing'
          ] 
        }
      },
      intent: 'Compare rendering approaches'
    },
    markdownEquiv: `## Approach Comparison: Inline vs Side Panel

### Approach A: Inline Rendering

This approach renders content directly in the transcript flow, which means users do not experience any context switch when viewing visualizations. The routing logic remains simpler and easier to maintain over time. Implementation costs are lower due to reduced complexity. Initial page load performance is faster because no additional panels need to be initialized. The native scroll behavior is fully maintained. The design is mobile-friendly and responsive across all device sizes.

### Approach B: Side Panel

This approach provides a separate dedicated view specifically designed for focused work on visualizations. The main chat readability is preserved and not cluttered with rich content. However, this requires more complex routing logic and additional state management. A two-pane layout is required for proper implementation. This approach is better suited for displaying large content blocks that would overwhelm the chat. The format is export-friendly for sharing visualizations externally.`
  }
]
