# Hello MCP

Minimal MCP App server for testing UI rendering in Claude.

One tool (`show_widget`) linked to one UI resource (`ui://hello/world`) serving a simple HTML widget.

Uses `@mcp-ui/server` with the `mcpApps` adapter for automatic lifecycle handshake injection.

## Deploy

Railway auto-deploys from `main`. Healthcheck at `/healthz`, MCP endpoint at `/mcp`.