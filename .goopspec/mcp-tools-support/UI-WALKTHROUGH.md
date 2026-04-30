# MCP Settings UI — Manual Walkthrough

## Prerequisites
- Elefant desktop running, daemon connected

## Steps
1. Open Settings → MCP tab
   - Expected: "No MCP servers configured" empty state

2. Click "Add Server"
   - Select transport: stdio
   - Name: filesystem-test
   - Command: bunx @modelcontextprotocol/server-filesystem /tmp
   - Click Save
   - Expected: server appears in list with status "connecting" then "connected"
   - Expected: tool count shows e.g. "14 tools"

3. Expand server row
   - Expected: tool list loads with names and descriptions
   - Pin one tool
   - Expected: pin icon fills; tool marked as pinned

4. Click "Browse Registry"
   - Expected: Curated tab shows Anthropic servers
   - Switch to Community tab — Smithery servers with paging
   - Switch to Bundled — 30+ entries
   - Search "github" — filters results
   - Click "Add" on an entry — form pre-fills

5. Toggle enable/disable on server
   - Expected: status transitions to "disabled"

6. Edit server — change name
   - Expected: list updates with new name

7. Delete server
   - Expected: server removed from list
