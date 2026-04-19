# Changelog

## Unreleased

### Added

- Added `permission:ask` veto semantics with `allow | ask | deny` hook status support.
- Added permission lifecycle SSE events: `permission.asked` and `permission.resolved`.
- Added tests covering veto short-circuit behavior (`allow`, `deny`), ask-path approval routing, and first-hook-wins status handling.
- Added hook documentation and plugin example for policy-based permission control.
