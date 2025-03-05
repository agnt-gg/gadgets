import express from 'express';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import readline from 'readline';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3002;

// Store active STDIO processes
const processes = new Map();
// Store SSE clients for each process
const clients = new Map();

// Start a new STDIO process
app.post('/start', (req, res) => {
    try {
        const { command, args } = req.body;
        
        if (!command) {
            return res.status(400).json({ success: false, error: 'Command is required' });
        }
        
        const sessionId = uuidv4();
        const process = spawn(command, args || []);
        const rl = readline.createInterface({ input: process.stdout });
        
        // Store process and its output buffer
        processes.set(sessionId, {
            process,
            rl,
            outputBuffer: [],
            createdAt: Date.now()
        });
        
        // Set up event handlers
        rl.on('line', (line) => {
            console.log(`[${sessionId}] Output:`, line);
            
            // Store output in buffer
            const session = processes.get(sessionId);
            if (session) {
                session.outputBuffer.push({
                    time: Date.now(),
                    data: line
                });
                
                // Send to all connected clients
                const sessionClients = clients.get(sessionId) || [];
                for (const client of sessionClients) {
                    client.write(`data: ${JSON.stringify({ type: 'output', data: line })}\n\n`);
                }
            }
        });
        
        process.stderr.on('data', (data) => {
            const line = data.toString();
            console.log(`[${sessionId}] Error:`, line);
            
            // Store error in buffer
            const session = processes.get(sessionId);
            if (session) {
                session.outputBuffer.push({
                    time: Date.now(),
                    data: line,
                    isError: true
                });
                
                // Send to all connected clients
                const sessionClients = clients.get(sessionId) || [];
                for (const client of sessionClients) {
                    client.write(`data: ${JSON.stringify({ type: 'error', data: line })}\n\n`);
                }
            }
        });
        
        process.on('close', (code) => {
            console.log(`[${sessionId}] Process exited with code ${code}`);
            
            // Notify clients
            const sessionClients = clients.get(sessionId) || [];
            for (const client of sessionClients) {
                client.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
                client.end();
            }
            
            // Clean up
            processes.delete(sessionId);
            clients.delete(sessionId);
        });
        
        res.json({
            success: true,
            sessionId,
            message: 'STDIO process started'
        });
    } catch (error) {
        console.error('Error starting process:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Send a message to a STDIO process
app.post('/send/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = processes.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }
    
    try {
        const message = JSON.stringify(req.body);
        console.log(`[${sessionId}] Sending:`, message);
        
        session.process.stdin.write(message + '\n');
        
        res.json({
            success: true,
            message: 'Message sent'
        });
    } catch (error) {
        console.error(`[${sessionId}] Error sending message:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Terminate a STDIO process
app.post('/terminate/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = processes.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }
    
    try {
        session.process.kill();
        
        res.json({
            success: true,
            message: 'Process terminated'
        });
    } catch (error) {
        console.error(`[${sessionId}] Error terminating process:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Connect to a STDIO process events stream
app.get('/events/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = processes.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }
    
    // Set up SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Send all buffered output
    for (const output of session.outputBuffer) {
        const eventType = output.isError ? 'error' : 'output';
        res.write(`data: ${JSON.stringify({ type: eventType, data: output.data })}\n\n`);
    }
    
    // Add this client to the session's clients
    if (!clients.has(sessionId)) {
        clients.set(sessionId, []);
    }
    clients.get(sessionId).push(res);
    
    // Handle client disconnect
    req.on('close', () => {
        const sessionClients = clients.get(sessionId);
        if (sessionClients) {
            const index = sessionClients.indexOf(res);
            if (index !== -1) {
                sessionClients.splice(index, 1);
            }
        }
    });
});

// List all active sessions
app.get('/sessions', (req, res) => {
    const sessions = [];
    
    for (const [id, session] of processes.entries()) {
        sessions.push({
            id,
            createdAt: session.createdAt,
            uptime: Date.now() - session.createdAt
        });
    }
    
    res.json({
        success: true,
        sessions
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`STDIO Proxy server running on http://localhost:${PORT}`);
}); 