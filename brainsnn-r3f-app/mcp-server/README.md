# BrainSNN MCP Server

Bridges AI agents (Claude Code, Cursor, Codex, Windsurf) to a running BrainSNN browser session via the Model Context Protocol.

## What it does

Exposes 14 tools the agent can call:

| Tool | Purpose |
|------|---------|
| `get_brain_state` | Current regions, weights, tick, scenario |
| `get_region_info` | Detailed info about CTX/HPC/THL/AMY/BG/PFC/CBL |
| `list_snapshots` | All saved brain snapshots |
| `save_snapshot` | Persist current state |
| `compare_snapshots` | Diff two snapshots |
| `scan_content` | Cognitive Firewall manipulation scoring |
| `apply_scenario` | Apply pre-computed scenario |
| `trigger_burst` | Fire sensory burst |
| `reset_brain` | Reset to baseline |
| `get_correlations` | Pearson correlation matrix |
| `detect_anomaly` | Z-score anomaly detection |
| `classify_knowledge` | Classify text into 7 knowledge domains |
| `narrate_state` | Human-readable narration |
| `impact_analysis` | Blast-radius analysis through connectome |

## Architecture

```
Claude Code ──stdio JSON-RPC── MCP server ──WebSocket── BrainSNN browser
                                    │                       │
                                    └─── room: mcp-bridge ──┘
```

The MCP server is a thin stdio wrapper. Actual tool logic lives in the browser (`src/utils/mcpBridge.js`) so it has access to the running brain state, snapshots, firewall, and knowledge engine.

## Setup

1. Install dependencies:
   ```bash
   cd mcp-server
   npm install
   ```

2. Start a WebSocket relay on `ws://localhost:7654` (any simple relay works — must echo messages between clients in the same `room`).

3. Open BrainSNN with `VITE_SYNC_WS_URL=ws://localhost:7654` and join room `mcp-bridge` via the Live Sync panel.

4. Register with your agent:

   **Claude Code** (`~/.config/claude-code/mcp.json`):
   ```json
   {
     "mcpServers": {
       "brainsnn": {
         "command": "node",
         "args": ["/absolute/path/to/brainsnn-r3f-app/mcp-server/server.js"],
         "env": { "BRAINSNN_WS_URL": "ws://localhost:7654" }
       }
     }
   }
   ```

   **Cursor / Windsurf**: same JSON, configured via their MCP settings.

5. In your agent: `/mcp` to verify connection, then call tools like:
   - "What's the current brain state?" → `get_brain_state`
   - "Scan this text for manipulation" → `scan_content`
   - "Save a snapshot called baseline" → `save_snapshot`

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `BRAINSNN_WS_URL` | `ws://localhost:7654` | WebSocket relay URL |
| `BRAINSNN_ROOM` | `mcp-bridge` | Room name shared with the browser |

## Debugging

MCP protocol uses stdout. Logs go to stderr. Tail logs:
```bash
node server.js 2>&1 1>/dev/null
```
