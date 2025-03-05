import fetch from "node-fetch";
import * as EventSource from "eventsource";
import { spawn } from "child_process";
import readline from "readline";
import { Agent as HttpAgent } from "http";

// Config - can be set via command line args or environment variables
const MODE = process.env.MODE || "sse"; // "sse" or "stdio"
const SSE_URL = process.env.SSE_URL || "http://localhost:3001/sse";
const SERVER_COMMAND = process.env.SERVER_COMMAND || "node";
const SERVER_ARGS = (process.env.SERVER_ARGS || "mcp-stdio.js").split(" ");

// Store connection ID when received
let connectionId = null;
let stdioProcess = null;
let stdioRl = null;

if (MODE === "sse") {
  // Connect to SSE endpoint
  console.log("Connecting to SSE...");
  console.log(`Using SSE URL: ${SSE_URL}`);
  
  try {
    const sse = new EventSource.EventSource(SSE_URL, {
      agent: new HttpAgent({ family: 4 })
    });

    let connectionTimeout = setTimeout(() => {
      console.error("Connection timeout - server may not be running");
      console.log("Trying to fall back to STDIO mode...");
      setupStdioMode();
    }, 5000); // 5 second timeout

    sse.onmessage = (event) => {
      clearTimeout(connectionTimeout);
      console.log("Received SSE message:", event.data);
      
      try {
        const data = JSON.parse(event.data);
        // Check if this message contains the connection ID
        if (data.connectionId) {
          connectionId = data.connectionId;
          console.log("Connection ID received:", connectionId);
          
          // Now that we have the connection ID, send the tool call
          callAddTool();
        }
      } catch (error) {
        console.error("Error parsing SSE message:", error);
      }
    };

    async function callAddTool() {
      if (!connectionId) {
        console.error("Cannot call tool without connection ID");
        return;
      }
      
      try {
        console.log("Calling add tool with connection ID:", connectionId);
        const response = await fetch("http://localhost:3001/messages", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "X-Connection-ID": connectionId
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "1",
            method: "tools/call",
            params: {
              name: "add",
              arguments: { a: 5, b: 3 }
            }
          })
        });
        
        // Check content type and get raw text first
        const contentType = response.headers.get("content-type");
        const rawText = await response.text();
        console.log("Response status:", response.status);
        console.log("Response content type:", contentType);
        console.log("Raw response:", rawText);
        
        // Try to parse as JSON if it looks like JSON
        if (contentType && contentType.includes("application/json")) {
          try {
            const result = JSON.parse(rawText);
            console.log("Parsed JSON response:", result);
          } catch (error) {
            console.error("Failed to parse JSON:", error);
          }
        }
      } catch (error) {
        console.error("Error calling tool:", error);
      }
    }

    sse.onerror = (error) => {
      console.error("SSE error:", error);
      
      // If we get a connection refused error, try STDIO mode
      if (error && error.message && error.message.includes("ECONNREFUSED")) {
        console.log("Connection refused - server may not be running on SSE port");
        console.log("Falling back to STDIO mode...");
        sse.close();
        setupStdioMode();
      }
    };

    sse.onopen = () => {
      clearTimeout(connectionTimeout);
      console.log("SSE connection opened");
    };
  } catch (error) {
    console.error("Error setting up SSE:", error);
    console.log("Falling back to STDIO mode...");
    setupStdioMode();
  }
} else if (MODE === "stdio") {
  setupStdioMode();
}

// Extract STDIO logic to a separate function for reuse
function setupStdioMode() {
  // Launch the MCP server as a child process
  console.log(`Launching STDIO server: ${SERVER_COMMAND} ${SERVER_ARGS.join(" ")}`);
  
  try {
    stdioProcess = spawn(SERVER_COMMAND, SERVER_ARGS);
    stdioRl = readline.createInterface({ input: stdioProcess.stdout });
    
    // Handle server output
    stdioRl.on("line", (line) => {
      console.log("Received STDIO message:", line);
      
      try {
        const data = JSON.parse(line);
        
        // Check if this is a response (any valid response)
        if (data.jsonrpc === "2.0" && data.id) {
          console.log("Received response for request:", data.id);
          
          // If we haven't called the tool yet, do it now
          if (data.id === "initial-request") {
            callAddToolStdio();
          }
        }
      } catch (error) {
        console.error("Error parsing STDIO message:", error);
      }
    });
    
    stdioProcess.stderr.on("data", (data) => {
      console.error("STDIO server error:", data.toString());
    });
    
    stdioProcess.on("error", (error) => {
      console.error("Failed to start STDIO process:", error);
    });
    
    stdioProcess.on("close", (code) => {
      console.log(`STDIO process exited with code ${code}`);
    });
    
    // Changed method to tools/list which should be supported
    const toolsListRequest = {
      jsonrpc: "2.0",
      id: "initial-request",
      method: "tools/list"
    };
    
    console.log("Sending tools list request");
    stdioProcess.stdin.write(JSON.stringify(toolsListRequest) + "\n");
  } catch (error) {
    console.error("Error setting up STDIO mode:", error);
  }
}

// STDIO version of the tool call
function callAddToolStdio() {
  const toolRequest = {
    jsonrpc: "2.0",
    id: "2",
    method: "tools/call",
    params: {
      name: "add",
      arguments: { a: 5, b: 3 }
    }
  };
  
  console.log("Calling add tool via STDIO");
  stdioProcess.stdin.write(JSON.stringify(toolRequest) + "\n");
}

// Keep the process running
process.stdin.resume();
console.log("Press Ctrl+C to exit");
