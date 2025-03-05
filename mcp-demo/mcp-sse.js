import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import cors from "cors";

// Set up Express server
const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;

// Create MCP server
const mcpServer = new McpServer({
  name: "Simple Demo",
  version: "1.0.0"
});

// Add a basic tool
mcpServer.tool("add", 
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: `${a + b}` }]
  })
);

// Active connections
const clients = new Map();

// Resources registry
const resources = {
  "mcp://sample-data": {
    uri: "mcp://sample-data",
    name: "Sample Data",
    description: "A sample data resource for testing",
    type: "application/json",
    content: {
      id: "123",
      name: "Test Resource",
      values: [1, 2, 3, 4, 5],
      metadata: {
        created: "2025-02-25T12:00:00Z",
        author: "System"
      }
    }
  }
};

// Prompts registry
const prompts = {
  "explain-code": {
    name: "explain-code",
    description: "Explains a piece of code in detail",
    arguments: [
      {
        name: "code",
        description: "The code to explain",
        required: true
      },
      {
        name: "language",
        description: "The programming language (e.g., JavaScript, Python)",
        required: false
      }
    ]
  },
  "fix-bug": {
    name: "fix-bug",
    description: "Helps identify and fix bugs in code",
    arguments: [
      {
        name: "code",
        description: "The buggy code",
        required: true
      },
      {
        name: "error",
        description: "Error message or description of the issue",
        required: true
      }
    ]
  },
  "summarize-document": {
    name: "summarize-document",
    description: "Summarizes a document or text",
    arguments: [
      {
        name: "text",
        description: "The text to summarize",
        required: true
      },
      {
        name: "length",
        description: "Desired summary length (short, medium, long)",
        required: false
      }
    ]
  }
};

// Add CORS middleware for all routes
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, X-Connection-ID, Connection-ID");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  console.log("Headers:", req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// Handle SSE connections
app.get("/sse", (req, res) => {
  console.log("SSE Request Headers:", req.headers);
  console.log("New SSE connection established");
  
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  
  // Generate client ID
  const clientId = Date.now().toString();
  clients.set(clientId, res);
  
  // Format according to SSE specification
  res.write(`event: connection\ndata: ${JSON.stringify({ 
    connectionId: clientId 
  })}\n\n`);
  
  // Also send a server info message
  const serverInfo = {
    jsonrpc: "2.0",
    id: "server.info",
    result: {
      name: "Simple Demo",
      version: "1.0.0",
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}  // Add prompts capability
      }
    }
  };
  
  // Send as regular SSE data message
  res.write(`data: ${JSON.stringify(serverInfo)}\n\n`);
  
  console.log(`Client ${clientId} connected, sent welcome and server info`);
  
  // Handle client disconnect
  req.on("close", () => {
    console.log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
  });
});

// The key change: accept POST requests at multiple endpoints
// Handle MCP messages at the expected URLs
app.post(["/messages", "/message"], async (req, res) => {
  try {
    // Get connection ID from headers or query parameters
    const connectionId = 
      req.headers["x-connection-id"] || 
      req.headers["connection-id"] || 
      req.query.connectionId;
    
    console.log("Looking for connection ID:", connectionId);
    console.log("Available clients:", Array.from(clients.keys()));
    
    // If no connection ID but we have only one client, use that
    let clientRes;
    if (!connectionId) {
      if (clients.size === 1) {
        // Use the only available client
        const onlyClientId = Array.from(clients.keys())[0];
        console.log(`No connection ID provided, using only available client: ${onlyClientId}`);
        clientRes = clients.get(onlyClientId);
      } else {
        console.error("Missing connection ID and multiple clients available");
        return res.status(400).json({ error: "Missing connection ID" });
      }
    } else if (!clients.has(connectionId)) {
      console.error(`Invalid connection ID: ${connectionId}`);
      return res.status(400).json({ error: "Invalid connection ID" });
    } else {
      clientRes = clients.get(connectionId);
    }
    
    const request = req.body;
    let response;
    
    console.log(`Processing method: ${request.method}`);
    
    // Process different MCP methods
    switch (request.method) {
      case "server/info":
        response = {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            name: "Simple Demo",
            version: "1.0.0",
            capabilities: {
              tools: {},
              resources: {},
              prompts: {}  // Add prompts capability
            }
          }
        };
        break;
        
      case "tools/list":
        response = {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [
              {
                name: "add",
                description: "Adds two numbers together",
                inputSchema: {
                  type: "object",
                  properties: {
                    a: { type: "number" },
                    b: { type: "number" }
                  },
                  required: ["a", "b"]
                }
              }
            ]
          }
        };
        break;
        
      case "tools/call":
        if (request.params?.name === "add") {
          const { a, b } = request.params.arguments;
          const sum = Number(a) + Number(b);
          
          response = {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{ type: "text", text: String(sum) }]
            }
          };
        } else {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: "Tool not found"
            }
          };
        }
        break;
        
      case "resources/list":
        const resourcesList = Object.values(resources).map(r => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          type: r.type
        }));
        
        response = {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            resources: resourcesList
          }
        };
        break;
        
      case "resources/get":
        const { uri } = request.params || {};
        
        if (!uri) {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: "Resource URI is required"
            }
          };
          break;
        }
        
        const resource = resources[uri];
        
        if (!resource) {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: `Resource not found: ${uri}`
            }
          };
          break;
        }
        
        response = {
          jsonrpc: "2.0",
          id: request.id,
          result: resource
        };
        break;
        
      case "prompts/list":
        console.log("Listing prompts...");
        response = {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            prompts: Object.values(prompts)
          }
        };
        break;
        
      case "prompts/get":
        console.log("Getting prompt...");
        const { name, arguments: args = {} } = request.params || {};
        
        if (!name) {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: "Prompt name is required"
            }
          };
          break;
        }
        
        const prompt = prompts[name];
        
        if (!prompt) {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: `Prompt not found: ${name}`
            }
          };
          break;
        }
        
        // Check required arguments
        const missingArgs = prompt.arguments
          .filter(arg => arg.required && !args[arg.name])
          .map(arg => arg.name);
          
        if (missingArgs.length > 0) {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: `Missing required arguments: ${missingArgs.join(", ")}`
            }
          };
          break;
        }
        
        // Generate prompt messages based on the prompt type
        let messages = [];
        
        if (name === "explain-code") {
          const language = args.language || "code";
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Please explain this ${language} code in detail:\n\n\`\`\`${language}\n${args.code}\n\`\`\`\n\nPlease provide a thorough explanation covering:\n1. What the code does\n2. How it works step by step\n3. Any patterns or techniques used\n4. Potential edge cases or issues`
              }
            }
          ];
        } else if (name === "fix-bug") {
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `I have a bug in my code. Here's the problematic code:\n\n\`\`\`\n${args.code}\n\`\`\`\n\nThe error or issue I'm encountering is:\n${args.error}\n\nPlease help me:\n1. Identify the cause of the bug\n2. Provide a fixed version of the code\n3. Explain what was wrong and how your solution fixes it`
              }
            }
          ];
        } else if (name === "summarize-document") {
          const lengthGuidance = args.length ? 
            `Please provide a ${args.length} summary.` : 
            "Please provide a concise summary.";
            
          messages = [
            {
              role: "user",
              content: {
                type: "text",
                text: `Please summarize the following text:\n\n${args.text}\n\n${lengthGuidance} Include the main points and key takeaways.`
              }
            }
          ];
        }
        
        response = {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            description: prompt.description,
            messages: messages
          }
        };
        break;
        
      default:
        response = {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Method ${request.method} not found`
          }
        };
    }
    
    console.log("Sending response:", JSON.stringify(response, null, 2));
    
    // Send response via SSE
    clientRes.write(`data: ${JSON.stringify(response)}\n\n`);
    
    // Respond to the POST request
    return res.json({ status: "success" });
  } catch (error) {
    console.error("Error processing message:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Connect to SSE at http://localhost:${PORT}/sse`);
  console.log(`Post messages to http://localhost:${PORT}/messages or /message`);
});