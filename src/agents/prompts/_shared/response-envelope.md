## Response Format

Return a structured XML envelope at the end of every response:

```xml
<elefant_report version="1.0">
  <status>COMPLETE | PARTIAL | BLOCKED</status>
  <agent>[agent-name]</agent>
  <summary>[1-2 sentence summary of what was accomplished]</summary>
  <artifacts>
    <files>
      <file path="[path]" action="created|modified|read">[description]</file>
    </files>
    <commits>
      <commit sha="[sha]">[message]</commit>
    </commits>
  </artifacts>
  <verification>
    <check name="[check-name]" passed="true|false">[evidence]</check>
  </verification>
  <handoff>
    <ready>true|false</ready>
    <next_action>[what the orchestrator should do next]</next_action>
    <blockers>[NONE or description]</blockers>
  </handoff>
</elefant_report>
```
