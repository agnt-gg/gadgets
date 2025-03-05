import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create an MCP server
const server = new McpServer({
  name: "Demo",
  version: "1.0.0"
});

// Add an addition tool
server.tool("add",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }]
  })
);

server.tool("subtract",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a - b) }]
  })
);

// Add sample data resource (matching the one in mcp-sse.js)
server.resource(
  "sample-data",
  "mcp://sample-data",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      name: "Sample Data",
      description: "A sample data resource for testing",
      type: "application/json",
      text: JSON.stringify({
        id: "123",
        name: "Test Resource",
        values: [1, 2, 3, 4, 5],
        metadata: {
          created: "2025-02-25T12:00:00Z",
          author: "System"
        }
      })
    }]
  })
);

// Add a dynamic greeting resource
server.resource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  async (uri, { name }) => ({
    contents: [{
      uri: uri.href,
      text: `Hello, ${name}!`
    }]
  })
);

// Add prompts (matching those in mcp-sse.js)
server.prompt(
  "explain-code",
  { 
    code: z.string(), 
    language: z.string().optional() 
  },
  ({ code, language }) => {
    const langText = language ? language : "code";
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please explain this ${langText} code in detail:\n\n\`\`\`${langText}\n${code}\n\`\`\`\n\nPlease provide a thorough explanation covering:\n1. What the code does\n2. How it works step by step\n3. Any patterns or techniques used\n4. Potential edge cases or issues`
        }
      }]
    };
  }
);

server.prompt(
  "fix-bug",
  { 
    code: z.string(), 
    error: z.string() 
  },
  ({ code, error }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `I have a bug in my code. Here's the problematic code:\n\n\`\`\`\n${code}\n\`\`\`\n\nThe error or issue I'm encountering is:\n${error}\n\nPlease help me:\n1. Identify the cause of the bug\n2. Provide a fixed version of the code\n3. Explain what was wrong and how your solution fixes it`
      }
    }]
  })
);

server.prompt(
  "summarize-document",
  { 
    text: z.string(), 
    length: z.string().optional() 
  },
  ({ text, length }) => {
    const lengthGuidance = length ? 
      `Please provide a ${length} summary.` : 
      "Please provide a concise summary.";
      
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Please summarize the following text:\n\n${text}\n\n${lengthGuidance} Include the main points and key takeaways.`
        }
      }]
    };
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);