# MCP Demo

A simple testing environment for the Model Context Protocol (MCP).

## Overview

This demo project provides a test environment for MCP with:

- An SSE-based MCP server
- A stdio proxy for command-line integration
- A test client with a browser-based UI

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- npm (comes with Node.js)

### Installation

1. Clone this repository
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

### Running the Demo

Start all services with a single command:

```bash
npm start
```

This command starts:
- The MCP SSE server on port 3001
- The stdio proxy server on port 3002
- A static file server on port 8000 for the test client

### Accessing the Demo

Open your browser and navigate to:
```
http://localhost:8000/test-client.html
```

## Components

- **mcp-sse.js**: SSE-based Model Context Protocol server
- **stdio-proxy.js**: Proxy for command-line interface tools
- **test-client.html/js**: Browser-based UI for testing MCP functionality
- **mcp-stdio.js**: Helper for stdio-based MCP connections

## Testing

Run the test client via command line:

```bash
npm test
```

## License

MIT 