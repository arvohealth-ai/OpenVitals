import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createHealthMcpServer } from "./index.js";

const server = createHealthMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
