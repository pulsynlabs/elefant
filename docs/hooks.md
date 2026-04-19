# Hooks

## `permission:ask` veto semantics

The `permission:ask` hook can now return a veto decision through `status`:

- `status: 'deny'` → hard-blocks immediately (`source: 'hook'`) and skips the WebSocket approval prompt.
- `status: 'allow'` → auto-approves immediately (`source: 'hook'`) and skips the WebSocket approval prompt.
- `status: 'ask'` or no `status` → keeps the existing approval behavior (`approval:request` / `approval:response`) based on risk.

### Hook context

`permission:ask` handlers receive:

- `tool`
- `args`
- `conversationId`
- `sessionId?`
- `projectId?`
- `agent?`
- `risk`

Handlers may return partial output including:

- `classification?: 'low' | 'medium' | 'high'`
- `status?: 'allow' | 'ask' | 'deny'`
- `reason?: string`

When multiple hooks set `status`, the first non-`undefined` value in hook execution order wins.

### Resolution source

Permission decisions include `source`:

- `hook` → decision came from veto hook status.
- `user` → decision came from WebSocket approval response.
- `default` → decision came from built-in risk policy (e.g., low/medium auto-approve or no-WS high-risk deny).

### Plugin example: deny `bash` for planner agent

```ts
api.on('permission:ask', (ctx) => {
	if (ctx.tool === 'bash' && ctx.agent === 'planner') {
		return {
			status: 'deny',
			reason: 'Planner agent is not allowed to execute bash',
		}
	}

	return {}
})
```
