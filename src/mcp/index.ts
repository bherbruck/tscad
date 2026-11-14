/**
 * `tscad mcp`: an MCP server so agents (Claude Code, Claude Desktop, ...) can design CAD with
 * tscad. See docs/mcp.md.
 */
export { createMcpHandler, PROTOCOL_VERSION, runMcpServer, type McpServerOptions } from "./server";
export { TOOLS, type Content, type ToolDef, type ToolResult } from "./tools";
export { elementsMarkdown, lookupReference, partsMarkdown, referenceEntries, referenceNames, type Entry, type Member } from "./reference";
export { GUIDE } from "./guide";

if (import.meta.main) await runMcpServer();
import { runMcpServer } from "./server";
