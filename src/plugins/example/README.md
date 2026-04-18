# Example Elefant Plugin

This plugin demonstrates the `ElefantPluginAPI` surface:

- Subscribes to `project:open`
- Registers a simple `hello` tool
- Registers a `greet` command
- Logs plugin lifecycle messages

## Entrypoint

`src/plugins/example/index.ts` exports a default plugin factory:

```ts
export default function elefantExamplePlugin(api: ElefantPluginAPI): void
```

The loader can import this plugin directly as a module entrypoint.
