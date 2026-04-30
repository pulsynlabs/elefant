import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

function getProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

async function main() {
  const transport = new StdioClientTransport({
    command: "bunx",
    args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
    env: getProcessEnv(),
  })

  const client = new Client({ name: "elefant-spike", version: "0.1.0" })

  try {
    console.log("Connecting to filesystem MCP server...")
    await client.connect(transport)
    console.log("Connected!")

    const tools = await client.listTools()
    console.log("Tools:", tools.tools.map((tool) => tool.name))

    if (tools.tools.length > 0) {
      const toolToCall = tools.tools.find((tool) => tool.name === "list_directory") ?? tools.tools[0]
      const args = toolToCall.name === "list_directory" ? { path: "/tmp" } : {}

      try {
        const result = await client.callTool({ name: toolToCall.name, arguments: args })
        console.log(`Tool result for ${toolToCall.name}:`, JSON.stringify(result).slice(0, 200))
      } catch (error) {
        console.log("Tool call error (expected if args wrong):", error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    await client.close()
    console.log("Done!")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
