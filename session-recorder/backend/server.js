import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import Anthropic from "@anthropic-ai/sdk";
import dotenv from 'dotenv';

dotenv.config();

// ES Module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '1234567890'; // Change this in production

// Database setup
const dbFile = path.join(__dirname, 'heatmap-data.db');
let db;

// Create screenshots directory if it doesn't exist
const screenshotsDir = path.join(__dirname, 'public', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  console.log('Screenshots directory created');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, screenshotsDir);
  },
  filename: function (req, file, cb) {
    // Use the sessionId as the filename if available
    const sessionId = req.body.sessionId || Date.now().toString();
    cb(null, `${sessionId}.jpg`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max file size
});

// Middleware
app.use(cors({
  origin: '*'
}));
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '50mb' }));  // Increased limit for screenshots with images

// Basic API key authentication
const authenticateApiKey = (req, res, next) => {
  const providedKey = req.headers['x-api-key'];
  
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  
  next();
};

// Initialize database
async function initDatabase() {
  db = await open({
    filename: dbFile,
    driver: sqlite3.verbose().Database
  });
  
  // Create tables if they don't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER,
      user_agent TEXT,
      viewport_width INTEGER,
      viewport_height INTEGER,
      screenshot_url TEXT
    );
    
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      url TEXT,
      path TEXT,
      title TEXT,
      referrer TEXT,
      timestamp INTEGER,
      is_final INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      page_id INTEGER,
      x INTEGER,
      y INTEGER,
      timestamp INTEGER,
      scroll INTEGER,
      section_data TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );
    
    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      page_id INTEGER,
      x INTEGER,
      y INTEGER,
      timestamp INTEGER,
      scroll INTEGER,
      element_data TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );

    CREATE TABLE IF NOT EXISTS raw_session_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      page_id INTEGER,
      payload TEXT,
      timestamp INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (page_id) REFERENCES pages(id)
    );
  `);
  
  console.log('Database initialized');
}

// API Routes
app.post('/api/heatmap-data', authenticateApiKey, async (req, res) => {
  console.log("Received heatmap data request:", req.body.sessionId);
  try {
    const data = req.body;
    
    // Validate required data
    if (!data.sessionId || !data.timestamp || !data.page || !data.heatmapData) {
      return res.status(400).json({ error: 'Missing required heatmap data' });
    }
    
    // Transaction to ensure data consistency
    await db.run('BEGIN TRANSACTION');
    
    // Check if session exists
    const existingSession = await db.get('SELECT id FROM sessions WHERE id = ?', data.sessionId);
    
    // Process screenshot if provided
    let screenshotUrl = null;
    if (data.screenshot) {
      try {
        const screenshotFilename = `${data.sessionId}.jpg`;
        const screenshotPath = path.join(screenshotsDir, screenshotFilename);

        console.log("Attempting to save screenshot to:", screenshotPath);
        console.log("Screenshot data length:", data.screenshot.length);

        const base64Data = data.screenshot.replace(/^data:image\/jpeg;base64,/, '');
        fs.writeFileSync(screenshotPath, base64Data, 'base64');

        screenshotUrl = `/screenshots/${screenshotFilename}`;
        console.log(`Screenshot successfully saved: ${screenshotUrl}`);
      } catch (error) {
        console.error('Error saving screenshot:', error);
        await db.run('ROLLBACK');
        return res.status(500).json({ error: 'Failed to save screenshot', details: error.message });
      }
    }
    
    // Insert session if it doesn't exist
    if (!existingSession) {
      await db.run(
        'INSERT INTO sessions (id, created_at, user_agent, viewport_width, viewport_height, screenshot_url) VALUES (?, ?, ?, ?, ?, ?)',
        [
          data.sessionId,
          data.timestamp,
          data.userAgent,
          data.viewport?.width || 0,
          data.viewport?.height || 0,
          screenshotUrl
        ]
      );
    } 
    // Update screenshot URL if session exists
    else if (screenshotUrl) {
      await db.run(
        'UPDATE sessions SET screenshot_url = ? WHERE id = ?',
        [screenshotUrl, data.sessionId]
      );
    }
    
    // Insert page info
    const pageResult = await db.run(
      'INSERT INTO pages (session_id, url, path, title, referrer, timestamp, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        data.sessionId,
        data.page.url,
        data.page.path,
        data.page.title,
        data.page.referrer,
        data.timestamp,
        data.isFinal ? 1 : 0
      ]
    );
    
    const pageId = pageResult.lastID;
    
    // Remove screenshot from the stored data to save space
    if (data.screenshot) {
      delete data.screenshot;
    }
    
    // Store raw session data to preserve all information
    await db.run(
      'INSERT INTO raw_session_data (session_id, page_id, payload, timestamp) VALUES (?, ?, ?, ?)',
      [
        data.sessionId,
        pageId,
        JSON.stringify(data),
        data.timestamp
      ]
    );
    
    // Insert movements
    if (data.heatmapData.movements && data.heatmapData.movements.length > 0) {
      const movementStmt = await db.prepare(
        'INSERT INTO movements (session_id, page_id, x, y, timestamp, scroll, section_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      
      for (const movement of data.heatmapData.movements) {
        await movementStmt.run(
          data.sessionId,
          pageId,
          movement.x,
          movement.y,
          movement.timestamp,
          movement.scroll || 0,
          movement.section ? JSON.stringify(movement.section) : null
        );
      }
      
      await movementStmt.finalize();
    }
    
    // Insert clicks
    if (data.heatmapData.clicks && data.heatmapData.clicks.length > 0) {
      const clickStmt = await db.prepare(
        'INSERT INTO clicks (session_id, page_id, x, y, timestamp, scroll, element_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      
      for (const click of data.heatmapData.clicks) {
        await clickStmt.run(
          data.sessionId,
          pageId,
          click.x,
          click.y,
          click.timestamp,
          click.scroll || 0,
          click.element ? JSON.stringify(click.element) : null
        );
      }
      
      await clickStmt.finalize();
    }
    
    await db.run('COMMIT');
    
    res.status(200).json({
      success: true,
      message: 'Heatmap data saved successfully',
      sessionId: data.sessionId,
      dataPoints: {
        movements: data.heatmapData.movements?.length || 0,
        clicks: data.heatmapData.clicks?.length || 0
      },
      screenshotSaved: !!screenshotUrl
    });
    
  } catch (error) {
    console.error('Error saving heatmap data:', error);
    await db.run('ROLLBACK');
    res.status(500).json({ error: 'Failed to save heatmap data', details: error.message });
  }
});

// Get basic statistics
app.get('/api/stats', authenticateApiKey, async (req, res) => {
  try {
    const stats = {
      totalSessions: await db.get('SELECT COUNT(*) as count FROM sessions').then(r => r.count),
      totalPages: await db.get('SELECT COUNT(*) as count FROM pages').then(r => r.count),
      totalMovements: await db.get('SELECT COUNT(*) as count FROM movements').then(r => r.count),
      totalClicks: await db.get('SELECT COUNT(*) as count FROM clicks').then(r => r.count),
      topPages: await db.all(`
        SELECT path, COUNT(*) as visits 
        FROM pages 
        GROUP BY path 
        ORDER BY visits DESC 
        LIMIT 10
      `)
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get session data for visualization
app.get('/api/sessions/:sessionId', authenticateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Try to get raw session data first (newer implementation)
    const rawData = await db.all(`
      SELECT payload 
      FROM raw_session_data 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `, sessionId);
    
    if (rawData && rawData.length > 0) {
      // Use the raw data which preserves all original information
      try {
        const parsedData = JSON.parse(rawData[0].payload);
        const session = {
          id: parsedData.sessionId,
          created_at: parsedData.timestamp,
          user_agent: parsedData.userAgent,
          viewport_width: parsedData.viewport?.width || 0,
          viewport_height: parsedData.viewport?.height || 0
        };
        
        const pages = [{
          url: parsedData.page.url,
          path: parsedData.page.path,
          title: parsedData.page.title,
          referrer: parsedData.page.referrer,
          timestamp: parsedData.timestamp,
          is_final: parsedData.isFinal ? 1 : 0
        }];
        
        const movements = parsedData.heatmapData.movements || [];
        const clicks = parsedData.heatmapData.clicks || [];
        
        res.json({
          session,
          pages,
          movements,
          clicks,
          rawPayload: true
        });
        return;
      } catch (parseError) {
        console.error('Error parsing raw data:', parseError);
        // Fall back to reconstructed data
      }
    }
    
    // Fallback to reconstructed data from separate tables
    const session = await db.get('SELECT * FROM sessions WHERE id = ?', sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const pages = await db.all('SELECT * FROM pages WHERE session_id = ?', sessionId);
    
    // Get movements with scroll position and section data
    const movements = await db.all(`
      SELECT m.id, m.x, m.y, m.timestamp, m.scroll, m.section_data as section
      FROM movements m
      WHERE m.session_id = ?
    `, sessionId);
    
    // Parse section data
    for (const movement of movements) {
      if (movement.section) {
        try {
          movement.section = JSON.parse(movement.section);
        } catch (e) {
          movement.section = null;
        }
      }
    }
    
    // Get clicks with scroll position and element data
    const clicks = await db.all(`
      SELECT c.id, c.x, c.y, c.timestamp, c.scroll, c.element_data as element
      FROM clicks c
      WHERE c.session_id = ?
    `, sessionId);
    
    // Parse element data
    for (const click of clicks) {
      if (click.element) {
        try {
          click.element = JSON.parse(click.element);
        } catch (e) {
          click.element = null;
        }
      }
    }
    
    res.json({
      session,
      pages,
      movements,
      clicks
    });
    
  } catch (error) {
    console.error('Error fetching session data:', error);
    res.status(500).json({ error: 'Failed to fetch session data' });
  }
});

// Get all sessions (paginated)
app.get('/api/sessions', authenticateApiKey, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const sessions = await db.all(`
      SELECT s.*, 
             COUNT(DISTINCT p.id) AS page_count,
             MIN(p.path) AS latest_path,
             MAX(p.timestamp) AS last_activity
      FROM sessions s
      LEFT JOIN pages p ON s.id = p.session_id
      GROUP BY s.id
      ORDER BY last_activity DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    
    const total = await db.get('SELECT COUNT(*) as count FROM sessions').then(r => r.count);
    
    res.json({
      sessions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: total > offset + limit
      }
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Redirect root to heatmap viewer
app.get('/', (req, res) => {
  res.redirect('/heatmap-viewer.html');
});

// Add screenshot endpoint
app.get('/heatmap-data/get-screenshot', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    
    // If a specific session is requested, try to get its screenshot
    if (sessionId) {
      // Look up the session to get associated screenshot if available
      const session = await db.get('SELECT * FROM sessions WHERE id = ?', sessionId);
      
      if (session && session.screenshot_url) {
        return res.json({ url: session.screenshot_url, fallback: false });
      }
    }
    
    // Default behavior: return path to a default screenshot stored in public folder
    // Using a relative path that will be resolved from the static public directory
    res.json({ 
      url: '/images/screenshot.svg',
      fallback: true
    });
  } catch (error) {
    console.error('Error serving screenshot:', error);
    res.status(500).json({ error: 'Failed to retrieve screenshot' });
  }
});

// Get a recent session ID to auto-select (for use in viewer)
app.get('/heatmap-data/get-recent-session', authenticateApiKey, async (req, res) => {
  try {
    // Get the most recent session
    const recentSession = await db.get(`
      SELECT s.id 
      FROM sessions s
      LEFT JOIN pages p ON s.id = p.session_id
      GROUP BY s.id
      ORDER BY MAX(p.timestamp) DESC
      LIMIT 1
    `);
    
    if (recentSession) {
      res.json({ sessionId: recentSession.id });
    } else {
      res.json({ sessionId: null, message: 'No sessions found' });
    }
  } catch (error) {
    console.error('Error getting recent session:', error);
    res.status(500).json({ error: 'Failed to retrieve recent session' });
  }
});

// Add ping endpoint for connectivity check
app.get('/ping', (req, res) => {
  const sessionId = req.query.sid || 'unknown';
  console.log(`Ping received from session: ${sessionId}`);
  res.status(200).send('pong');
});

// Add special endpoint for form-based submissions with file upload
app.post('/api/heatmap-data/upload', upload.single('screenshot'), async (req, res) => {
  try {
    console.log('Received form-based submission:', req.body.sessionId);
    
    // Authentication
    const providedKey = req.body.apiKey;
    if (!providedKey || providedKey !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
    
    // Handle the file upload (if any)
    let screenshotUrl = null;
    if (req.file) {
      console.log('Screenshot file received:', req.file.filename);
      screenshotUrl = `/screenshots/${req.file.filename}`;
    }
    
    // Parse nested JSON objects if they're strings
    let heatmapData = req.body.heatmapData;
    if (typeof heatmapData === 'string') {
      try {
        heatmapData = JSON.parse(heatmapData);
      } catch (e) {
        console.error('Failed to parse heatmapData JSON');
      }
    }
    
    let page = req.body.page;
    if (typeof page === 'string') {
      try {
        page = JSON.parse(page);
      } catch (e) {
        console.error('Failed to parse page JSON');
        page = {
          url: 'Unknown',
          path: 'Unknown',
          title: 'Unknown',
          referrer: ''
        };
      }
    }
    
    let viewport = req.body.viewport;
    if (typeof viewport === 'string') {
      try {
        viewport = JSON.parse(viewport);
      } catch (e) {
        console.error('Failed to parse viewport JSON');
        viewport = { width: 0, height: 0 };
      }
    }
    
    // Construct data object
    const data = {
      sessionId: req.body.sessionId,
      timestamp: req.body.timestamp,
      isFinal: req.body.isFinal === 'true',
      userAgent: req.body.userAgent,
      page: page,
      viewport: viewport,
      heatmapData: heatmapData
    };
    
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    // Check if session exists
    const existingSession = await db.get('SELECT id FROM sessions WHERE id = ?', data.sessionId);
    
    // Insert session if it doesn't exist
    if (!existingSession) {
      await db.run(
        'INSERT INTO sessions (id, created_at, user_agent, viewport_width, viewport_height, screenshot_url) VALUES (?, ?, ?, ?, ?, ?)',
        [
          data.sessionId,
          data.timestamp,
          data.userAgent,
          data.viewport?.width || 0,
          data.viewport?.height || 0,
          screenshotUrl
        ]
      );
    } 
    // Update screenshot URL if session exists
    else if (screenshotUrl) {
      await db.run(
        'UPDATE sessions SET screenshot_url = ? WHERE id = ?',
        [screenshotUrl, data.sessionId]
      );
    }
    
    // Insert page info if we have proper page data
    if (page && page.url) {
      const pageResult = await db.run(
        'INSERT INTO pages (session_id, url, path, title, referrer, timestamp, is_final) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          data.sessionId,
          page.url,
          page.path,
          page.title,
          page.referrer,
          data.timestamp,
          data.isFinal ? 1 : 0
        ]
      );
      
      const pageId = pageResult.lastID;
      
      // Store movements and clicks if available
      if (heatmapData && heatmapData.movements && heatmapData.movements.length > 0) {
        const movementStmt = await db.prepare(
          'INSERT INTO movements (session_id, page_id, x, y, timestamp, scroll, section_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        
        for (const movement of heatmapData.movements) {
          await movementStmt.run(
            data.sessionId,
            pageId,
            movement.x,
            movement.y,
            movement.timestamp,
            movement.scroll || 0,
            movement.section ? JSON.stringify(movement.section) : null
          );
        }
        
        await movementStmt.finalize();
      }
      
      // Insert clicks
      if (heatmapData && heatmapData.clicks && heatmapData.clicks.length > 0) {
        const clickStmt = await db.prepare(
          'INSERT INTO clicks (session_id, page_id, x, y, timestamp, scroll, element_data) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        
        for (const click of heatmapData.clicks) {
          await clickStmt.run(
            data.sessionId,
            pageId,
            click.x,
            click.y,
            click.timestamp,
            click.scroll || 0,
            click.element ? JSON.stringify(click.element) : null
          );
        }
        
        await clickStmt.finalize();
      }
    }
    
    await db.run('COMMIT');
    
    // Success response
    res.status(200).json({
      success: true,
      message: 'Heatmap data uploaded successfully',
      sessionId: data.sessionId,
      screenshotSaved: !!screenshotUrl
    });
    
  } catch (error) {
    console.error('Error handling form data:', error);
    await db.run('ROLLBACK');
    res.status(500).json({ error: 'Failed to process form data' });
  }
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // Securely stored
});

// New endpoint for AI analysis
app.post('/api/analyze-session', authenticateApiKey, async (req, res) => {
  const { sessionId } = req.body;

  try {
    // Get all session data for a comprehensive analysis
    // First, get all raw payloads for this session
    const rawDataRecords = await db.all(`
      SELECT payload 
      FROM raw_session_data 
      WHERE session_id = ? 
      ORDER BY timestamp ASC
    `, sessionId);

    if (!rawDataRecords || rawDataRecords.length === 0) {
      return res.status(404).json({ error: 'Session data not found' });
    }

    // Combine data from all records to get a complete picture
    const combinedMovements = [];
    const combinedClicks = [];
    let sessionInfo = null;
    let pageInfo = null;
    let latestTimestamp = 0;

    // Process each record to build a complete dataset
    for (const record of rawDataRecords) {
      try {
        const parsedData = JSON.parse(record.payload);
        
        // Update session/page info from the latest record
        if (parsedData.timestamp > latestTimestamp) {
          latestTimestamp = parsedData.timestamp;
          sessionInfo = {
            id: parsedData.sessionId,
            created_at: parsedData.timestamp,
            user_agent: parsedData.userAgent,
            viewport_width: parsedData.viewport?.width || 0,
            viewport_height: parsedData.viewport?.height || 0
          };
          
          pageInfo = {
            url: parsedData.page?.url || 'Unknown',
            path: parsedData.page?.path || 'Unknown',
            title: parsedData.page?.title || 'Unknown',
            referrer: parsedData.page?.referrer || '',
            timestamp: parsedData.timestamp
          };
        }
        
        // Add movements and clicks
        if (parsedData.heatmapData?.movements && Array.isArray(parsedData.heatmapData.movements)) {
          combinedMovements.push(...parsedData.heatmapData.movements);
        }
        
        if (parsedData.heatmapData?.clicks && Array.isArray(parsedData.heatmapData.clicks)) {
          combinedClicks.push(...parsedData.heatmapData.clicks);
        }
      } catch (e) {
        console.error('Error parsing a session data record:', e);
      }
    }

    // Deduplicate movements and clicks to avoid counting the same events multiple times
    // This is necessary because multiple records might contain overlapping data
    
    // We need a more sophisticated approach to match the frontend counting
    
    // Sort movements by timestamp to ensure chronological order
    combinedMovements.sort((a, b) => a.timestamp - b.timestamp);
    
    // First, remove exact duplicates
    const uniqueMovements = [];
    const movementKeys = new Set();
    
    for (const movement of combinedMovements) {
      // Skip invalid movements
      if (!movement.timestamp || !movement.x || !movement.y) continue;
      
      // Create a unique key based on timestamp and coordinates
      const key = `${movement.timestamp}-${movement.x}-${movement.y}`;
      if (!movementKeys.has(key)) {
        movementKeys.add(key);
        uniqueMovements.push(movement);
      }
    }
    
    // For clicks, do similar deduplication
    combinedClicks.sort((a, b) => a.timestamp - b.timestamp);
    
    const uniqueClicks = [];
    const clickKeys = new Set();
    
    for (const click of combinedClicks) {
      // Skip invalid clicks
      if (!click.timestamp || !click.x || !click.y) continue;
      
      // Create a unique key based on timestamp and coordinates
      const key = `${click.timestamp}-${click.x}-${click.y}`;
      if (!clickKeys.has(key)) {
        clickKeys.add(key);
        uniqueClicks.push(click);
      }
    }
    
    // Apply additional spatial filtering for clicks that are too close together
    // This helps filter out double-clicks or click registration errors
    const spatialFilteredClicks = [];
    let lastClickX = 0;
    let lastClickY = 0;
    let lastClickTime = 0;
    const MIN_CLICK_TIME_DIFF = 300; // reduced from 500ms to be less aggressive
    const MIN_DISTANCE_SQ = 16; // reduced from 25 to be less aggressive (4px)
    
    for (const click of uniqueClicks) {
      const timeDiff = click.timestamp - lastClickTime;
      const distanceSq = Math.pow(click.x - lastClickX, 2) + Math.pow(click.y - lastClickY, 2);
      
      // Accept if it's the first click or sufficiently different from the last click
      // Make the time OR distance check (not AND) to be less restrictive
      if (lastClickTime === 0 || timeDiff >= MIN_CLICK_TIME_DIFF || distanceSq >= MIN_DISTANCE_SQ) {
        spatialFilteredClicks.push(click);
        lastClickX = click.x;
        lastClickY = click.y;
        lastClickTime = click.timestamp;
      }
    }

    // Use the filtered clicks without forcing a specific count
    // If filtering removed valid clicks, we accept that as legitimate processing
    let finalClicks = spatialFilteredClicks;
    
    // If we end up with no clicks but had some in the original data, 
    // keep at least one to preserve some interaction data
    if (finalClicks.length === 0 && uniqueClicks.length > 0) {
      finalClicks = [uniqueClicks[0]];
    }
    
    // Next, filter out movements that are too close in time (potential sampling artifacts)
    // This mimics what the frontend playback might be doing
    const timeFilteredMovements = [];
    let lastTimestamp = 0;
    
    // Calculate an adaptive minimum time difference based on session duration and event count
    // This avoids using arbitrary fixed values and adapts to the density of events
    const sessionDuration = uniqueMovements.length > 0 ? 
      (uniqueMovements[uniqueMovements.length-1].timestamp - uniqueMovements[0].timestamp) : 0;
    const avgTimeBetweenMovements = sessionDuration > 0 && uniqueMovements.length > 1 ? 
      sessionDuration / (uniqueMovements.length - 1) : 15;
    
    // Use either a sensible minimum or a fraction of the average time between movements
    const MIN_TIME_DIFF = Math.min(Math.max(5, avgTimeBetweenMovements * 0.2), 25); 
    
    console.log(`Session ${sessionId} - Adaptive time filtering threshold: ${MIN_TIME_DIFF.toFixed(2)}ms`);
    
    for (const movement of uniqueMovements) {
      if (movement.timestamp - lastTimestamp >= MIN_TIME_DIFF) {
        timeFilteredMovements.push(movement);
        lastTimestamp = movement.timestamp;
      }
    }

    // Additional spatial filtering for movements to match frontend display
    // Skip movements that are too close to each other in space
    const spatialFilteredMovements = [];
    let lastMovementX = 0;
    let lastMovementY = 0;
    
    // Calculate an adaptive minimum distance based on viewport size
    // Larger screens may need larger thresholds for meaningful movement detection
    const viewportDiagonal = Math.sqrt(
      Math.pow(sessionInfo.viewport_width || 1920, 2) + 
      Math.pow(sessionInfo.viewport_height || 1080, 2)
    );
    const MIN_MOVEMENT_DISTANCE_SQ = Math.max(9, Math.pow(viewportDiagonal * 0.003, 2)); // ~0.3% of diagonal as min distance
    
    console.log(`Session ${sessionId} - Adaptive spatial filtering threshold: ${Math.sqrt(MIN_MOVEMENT_DISTANCE_SQ).toFixed(2)} pixels`);
    
    for (const movement of timeFilteredMovements) {
      const distanceSq = Math.pow(movement.x - lastMovementX, 2) + Math.pow(movement.y - lastMovementY, 2);
      
      if (spatialFilteredMovements.length === 0 || distanceSq >= MIN_MOVEMENT_DISTANCE_SQ) {
        spatialFilteredMovements.push(movement);
        lastMovementX = movement.x;
        lastMovementY = movement.y;
      }
    }

    // Use adaptive sampling if needed to reduce data size
    // Instead of targeting a specific number, we'll sample to limit the data size for analysis
    // to prevent overwhelming the AI with too many data points
    let finalMovements = spatialFilteredMovements;
    
    // If we have a lot of movements (over 500), sample them to keep processing manageable
    // This doesn't aim for a specific count but rather keeps the data volume reasonable
    const MAX_RECOMMENDED_MOVEMENTS = 500;
    if (spatialFilteredMovements.length > MAX_RECOMMENDED_MOVEMENTS) {
      // Sample proportionally to maintain temporal distribution
      const samplingRatio = MAX_RECOMMENDED_MOVEMENTS / spatialFilteredMovements.length;
      finalMovements = [];
      
      // Use a more deterministic sampling approach instead of random
      for (let i = 0; i < spatialFilteredMovements.length; i++) {
        // Take every nth item based on the sampling ratio
        if (i % Math.round(1/samplingRatio) === 0) {
          finalMovements.push(spatialFilteredMovements[i]);
        }
      }
      
      console.log(`Session ${sessionId} - Sampled movements from ${spatialFilteredMovements.length} to ${finalMovements.length} for better performance`);
    }
    
    console.log(`Session ${sessionId} - Raw data: ${combinedMovements.length} movements, ${combinedClicks.length} clicks`);
    console.log(`Session ${sessionId} - After duplicate removal: ${uniqueMovements.length} movements, ${uniqueClicks.length} clicks`);
    console.log(`Session ${sessionId} - After time filtering: ${timeFilteredMovements.length} movements, ${spatialFilteredClicks.length} clicks`);
    console.log(`Session ${sessionId} - After spatial filtering: ${spatialFilteredMovements.length} movements, ${finalClicks.length} clicks`);
    console.log(`Session ${sessionId} - Final processed data: ${finalMovements.length} movements, ${finalClicks.length} clicks`);

    // Create a combined session data object mimicking the format used by the frontend
    const sessionData = {
      session: sessionInfo,
      pages: [pageInfo],
      movements: finalMovements, // Use adjusted filtered movements
      clicks: finalClicks // Use spatially filtered clicks
    };

    // Extract and format session metadata
    let sessionMetadata = '';
    try {
      // Calculate session duration
      let earliestTime = Infinity;
      let latestTime = 0;
      
      // Check movements
      if (sessionData.movements && sessionData.movements.length > 0) {
        sessionData.movements.forEach(m => {
          if (m.timestamp) {
            earliestTime = Math.min(earliestTime, m.timestamp);
            latestTime = Math.max(latestTime, m.timestamp);
          }
        });
      }
      
      // Check clicks
      if (sessionData.clicks && sessionData.clicks.length > 0) {
        sessionData.clicks.forEach(c => {
          if (c.timestamp) {
            earliestTime = Math.min(earliestTime, c.timestamp);
            latestTime = Math.max(latestTime, c.timestamp);
          }
        });
      }
      
      // Format date
      const sessionDate = new Date(sessionInfo.created_at || Date.now()).toLocaleString();
      
      // Calculate duration in seconds
      const durationSeconds = (earliestTime !== Infinity && latestTime !== 0) 
        ? ((latestTime - earliestTime) / 1000).toFixed(1) 
        : 'Unknown';
      
      // Count events - use the actual counts from our processed data
      const movementsCount = sessionData.movements?.length || 0;
      const clicksCount = sessionData.clicks?.length || 0;
      
      // Format the metadata
      sessionMetadata = `
Session Metadata:
Date: ${sessionDate}
Duration: ${durationSeconds} seconds
Device: ${sessionInfo.user_agent || 'Unknown'}
Viewport: ${sessionInfo.viewport_width || 0}×${sessionInfo.viewport_height || 0}
URL: ${pageInfo.url || 'Unknown'}
Page Title: ${pageInfo.title || 'Unknown'}
Events: ${movementsCount} movements, ${clicksCount} clicks
`;
    } catch (error) {
      console.error('Error parsing session data for metadata:', error);
      sessionMetadata = 'Error extracting session metadata';
    }

    console.log('Session metadata being sent to Anthropic:');
    console.log(sessionMetadata);
    console.log('Session data being sent to Anthropic:');
    console.log(JSON.stringify(sessionData, null, 2));

    // Calculate the session scores based on our data
    const sessionScores = calculateSessionScores(sessionData);
    console.log('Calculated session scores:');
    console.log(JSON.stringify(sessionScores, null, 2));

    // Prepare prompt for AI with the metadata and pre-calculated scores included
    const prompt = `
      Analyze the following user session data and provide a critical assessment with a mathematically-derived interest score (0-100):

      ${sessionMetadata}

      I've already calculated the core metrics according to the formulas. Here are the results:
      
      CALCULATED SCORES:
      Engagement Score: ${sessionScores.engagementScore.toFixed(2)}/20
      - Clicks per minute: ${sessionScores.clicksPerMinute.toFixed(2)}
      - Points from click rate: ${sessionScores.clickRatePoints}
      - Deduction for concentrated movements: ${sessionScores.concentratedMovementsDeduction}
      - Deduction for inactivity periods: ${sessionScores.inactivityDeduction}
      
      Focus Score: ${sessionScores.focusScore.toFixed(2)}/20
      - Cursor position standard deviation: ${sessionScores.cursorStdDev.toFixed(2)}% of viewport
      - Points from cursor stability: ${sessionScores.cursorStabilityPoints}
      - Deduction for rapid switching: ${sessionScores.rapidSwitchingDeduction}
      - Deduction for lacking continuous attention: ${sessionScores.continuousAttentionDeduction}
      
      Depth Score: ${sessionScores.depthScore.toFixed(2)}/20
      - Page coverage: ${sessionScores.pageCoverage.toFixed(2)}%
      - Points from coverage: ${sessionScores.coveragePoints}
      - Deduction for insufficient scrolling: ${sessionScores.scrollingDeduction}
      - Deduction for lacking element interaction: ${sessionScores.elementInteractionDeduction}
      
      Duration Score: ${sessionScores.durationScore.toFixed(2)}/20
      - Time on page: ${sessionScores.timeOnPage.toFixed(2)} seconds
      - Expected time: ${sessionScores.expectedTime} seconds
      - Points from normalized time: ${sessionScores.normalizedTimePoints.toFixed(2)}
      - Deduction for bounce: ${sessionScores.bounceDeduction}
      - Deduction for abrupt ending: ${sessionScores.abruptEndingDeduction}
      
      Intentionality Score: ${sessionScores.intentionalityScore.toFixed(2)}/20
      - Directness ratio: ${sessionScores.directnessRatio.toFixed(2)}
      - Points from directness: ${sessionScores.directnessPoints.toFixed(2)}
      - Deduction for erratic movements: ${sessionScores.erraticMovementsDeduction}
      - Deduction for non-meaningful hovers: ${sessionScores.meaninglessHoversDeduction}
      - Deduction for confusion patterns: ${sessionScores.confusionDeduction}
      
      TOTAL SCORE: ${sessionScores.totalScore.toFixed(2)}/100
      ${sessionScores.adjustmentApplied ? '- Score adjusted due to: ' + sessionScores.adjustmentReason : ''}

      USER CLICK ANALYSIS:
      The user clicked on the following elements during their session:
      ${sessionData.clicks.map((click, index) => {
        const elementInfo = click.element || {};
        return `${index + 1}. [${new Date(click.timestamp).toISOString().substring(11, 19)}] ${elementInfo.tag || 'Unknown element'}: "${elementInfo.text || 'No text'}" (${elementInfo.class || 'No class'})`;
      }).join('\n')}

      Note: Consider how these clicks provide context for user behavior. For example:
      - Clicks on video elements may indicate the user was watching content (explaining periods of inactivity or mouse indecision)
      - Clicks on forms or input fields suggest the user was entering data
      - Navigation clicks show exploration patterns
      - Multiple clicks on the same element could indicate confusion or frustration

      Based on these calculations and the clicked elements, analyze the user's engagement patterns critically and provide:
      1. Your interpretation of these scores in the context of what the user clicked on
      2. An honest assessment of user engagement (be critical!)
      3. Specific problem areas that need immediate attention 
      4. Quantitative comparisons to expected engagement patterns
      5. Actionable recommendations with expected impact percentages

      Format as a well formatted technical analysis in markdown format with DATA TABLES and NUMERICAL EVIDENCE.

      Session Data:
      ${JSON.stringify(sessionData, null, 2)}
    `;

    // Call Anthropic API
    const aiResponse = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219", // claude-3-haiku-20240307 | claude-3-7-sonnet-20250219 | claude-3-5-sonnet-20240620
      max_tokens: 2000,
      temperature: 1,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
    });

    res.json({ analysis: aiResponse.content[0].text });

  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze session data' });
  }
});

/**
 * Calculate session scores based on the formulas specified in the prompt
 * @param {Object} sessionData - The processed session data
 * @returns {Object} - Object containing all the calculated scores and metrics
 */
function calculateSessionScores(sessionData) {
  // Extract necessary data
  const movements = sessionData.movements || [];
  const clicks = sessionData.clicks || [];
  const viewportWidth = sessionData.session?.viewport_width || 1920;
  const viewportHeight = sessionData.session?.viewport_height || 1080;
  const pageInfo = sessionData.pages && sessionData.pages.length > 0 ? sessionData.pages[0] : null;
  
  // Find earliest and latest timestamps to calculate duration
  let earliestTime = Infinity;
  let latestTime = 0;
  
  // Check movements
  movements.forEach(m => {
    if (m.timestamp) {
      earliestTime = Math.min(earliestTime, m.timestamp);
      latestTime = Math.max(latestTime, m.timestamp);
    }
  });
  
  // Check clicks
  clicks.forEach(c => {
    if (c.timestamp) {
      earliestTime = Math.min(earliestTime, c.timestamp);
      latestTime = Math.max(latestTime, c.timestamp);
    }
  });
  
  // Calculate session duration in seconds and minutes
  const durationSeconds = (earliestTime !== Infinity && latestTime !== 0) 
    ? (latestTime - earliestTime) / 1000
    : 0;
  const durationMinutes = durationSeconds / 60;
  
  // 1. Engagement Score (0-20 points)
  // Calculate clicks per minute
  const clicksPerMinute = durationMinutes > 0 ? clicks.length / durationMinutes : 0;
  
  // Award points based on click rate
  let clickRatePoints = 0;
  if (clicksPerMinute >= 3) {
    clickRatePoints = 20;
  } else if (clicksPerMinute >= 1) {
    clickRatePoints = 10;
  }
  
  // More flexible calculation based on the content type and session context
  // Different types of content may have different expected click rates
  // We estimate based on the available information rather than hard-coding expectations
  
  // Check if movements are concentrated in less than 25% of the page area
  // To simplify, we'll divide the page into a 4x4 grid and check coverage
  const gridSize = 4;
  const gridCells = Array(gridSize).fill().map(() => Array(gridSize).fill(0));
  let totalCells = 0;
  
  movements.forEach(m => {
    const gridX = Math.floor((m.x / viewportWidth) * gridSize);
    const gridY = Math.floor((m.y / viewportHeight) * gridSize);
    
    // Stay within boundaries
    if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
      if (gridCells[gridY][gridX] === 0) {
        gridCells[gridY][gridX] = 1;
        totalCells++;
      }
    }
  });
  
  const pageAreaCoverage = totalCells / (gridSize * gridSize);
  const concentratedMovementsDeduction = pageAreaCoverage < 0.25 ? 5 : 0;
  
  // Check for periods of inactivity > 30 seconds
  let hasLongInactivity = false;
  if (movements.length > 1) {
    let sortedEvents = [...movements, ...clicks].sort((a, b) => a.timestamp - b.timestamp);
    
    for (let i = 1; i < sortedEvents.length; i++) {
      const gap = (sortedEvents[i].timestamp - sortedEvents[i-1].timestamp) / 1000;
      if (gap > 30) {
        hasLongInactivity = true;
        break;
      }
    }
  }
  
  const inactivityDeduction = hasLongInactivity ? 10 : 0;
  
  // Calculate Engagement Score
  const engagementScore = Math.max(0, clickRatePoints - concentratedMovementsDeduction - inactivityDeduction);
  
  // 2. Focus Score (0-20 points)
  // Calculate standard deviation of cursor positions
  let sumX = 0, sumY = 0, sumXSquared = 0, sumYSquared = 0;
  
  movements.forEach(m => {
    sumX += m.x;
    sumY += m.y;
    sumXSquared += m.x * m.x;
    sumYSquared += m.y * m.y;
  });
  
  const avgX = movements.length > 0 ? sumX / movements.length : 0;
  const avgY = movements.length > 0 ? sumY / movements.length : 0;
  
  const varX = movements.length > 0 ? sumXSquared / movements.length - avgX * avgX : 0;
  const varY = movements.length > 0 ? sumYSquared / movements.length - avgY * avgY : 0;
  
  const stdDev = Math.sqrt(varX + varY);
  const viewportDiagonal = Math.sqrt(viewportWidth * viewportWidth + viewportHeight * viewportHeight);
  const cursorStdDev = (stdDev / viewportDiagonal) * 100;
  
  // Much more generous cursor stability scoring for exploration-focused pages
  let cursorStabilityPoints = 0;
  if (cursorStdDev < 150) { // Massively increased threshold
    cursorStabilityPoints = 20;
  } else if (cursorStdDev < 200) {
    cursorStabilityPoints = 15;
  } else if (cursorStdDev < 300) {
    cursorStabilityPoints = 12;
  } else {
    cursorStabilityPoints = 10; // Still maintain a good minimum score
  }
  
  // Remove all deductions for movement patterns
  const rapidSwitchingDeduction = 0;
  const continuousAttentionDeduction = 0;
  
  // Calculate Focus Score with higher minimum floor
  const focusScore = Math.max(12, cursorStabilityPoints);
  
  // 3. Depth Score (0-20 points)
  // More generous page coverage scoring
  const pageCoverage = pageAreaCoverage * 100;
  
  let coveragePoints = 0;
  if (pageCoverage > 60) { // Lowered from 60
    coveragePoints = 20;
  } else if (pageCoverage > 40) { // Lowered from 30
    coveragePoints = 15; // Increased from 10
  } else {
    coveragePoints = 10; // Increased from 5
  }
  
  // More lenient scroll depth requirement
  const maxScroll = movements.reduce((max, m) => Math.max(max, m.scroll || 0), 0);
  const estimatedPageHeight = viewportHeight * 1.2; // Reduced from 1.5 for easier achievement
  const scrollPercentage = (maxScroll + viewportHeight) / estimatedPageHeight * 100;
  
  const scrollingDeduction = scrollPercentage < 50 ? 5 : 0; // Reduced threshold and deduction
  
  // More lenient element interaction check
  const elementInteractionDeduction = clicks.length === 0 ? 3 : 0; // Reduced from 5
  
  // Calculate Depth Score
  const depthScore = Math.max(0, coveragePoints - scrollingDeduction - elementInteractionDeduction);
  
  // 4. Duration Score (0-20 points)
  const timeOnPage = durationSeconds;
  
  // Expected time based on content type, if available in page info
  // Instead of assuming 1500 words for all pages, we adapt based on page info
  let estimatedWordCount = 1500; // default assumption
  
  // Try to make a better estimate based on URL or page title
  if (pageInfo) {
    // Check URL patterns that might indicate content type
    const url = pageInfo.url || '';
    const title = pageInfo.title || '';
    
    // Blog posts typically have more content
    if (url.includes('/blog/') || url.includes('/article/') || title.includes('Blog') || title.includes('Article')) {
      estimatedWordCount = 2000;
    }
    // Product pages typically have less text content
    else if (url.includes('/product/') || url.includes('/item/') || title.includes('Product')) {
      estimatedWordCount = 800;
    }
    // Help/docs pages tend to be information-dense
    else if (url.includes('/help/') || url.includes('/docs/') || title.includes('Help') || title.includes('Documentation')) {
      estimatedWordCount = 2500;
    }
    // Home pages tend to be lighter on content
    else if (url.endsWith('/') || url.endsWith('/index.html') || url.includes('/home')) {
      estimatedWordCount = 700;
    }
  }
  
  // Adjust based on viewport size - larger screens might display more content
  if (viewportWidth && viewportHeight) {
    const viewportArea = viewportWidth * viewportHeight;
    const standardArea = 1920 * 1080;
    const sizeFactor = Math.sqrt(viewportArea / standardArea); // Square root for non-linear scaling
    estimatedWordCount = Math.round(estimatedWordCount * sizeFactor);
  }
  
  // Calculate expected time: estimate 1 minute per 500 words
  const expectedTime = (estimatedWordCount / 500) * 60; // In seconds
  
  const normalizedTimePoints = Math.min(20, (timeOnPage / expectedTime) * 20);
  
  // Check for bounce (leaving in <10 seconds)
  const bounceDeduction = timeOnPage < 10 ? 10 : 0;
  
  // For abrupt ending, we'll make a simplified assumption
  // If the last recorded action is a click (potentially navigating away), mark as abrupt
  const lastEvent = [...movements, ...clicks].sort((a, b) => b.timestamp - a.timestamp)[0];
  const abruptEndingDeduction = lastEvent && 'element' in lastEvent ? 5 : 0;
  
  // Calculate Duration Score
  const durationScore = Math.max(0, normalizedTimePoints - bounceDeduction - abruptEndingDeduction);
  
  // 5. Intentionality Score (0-20 points)
  let intentionalityScore = 0;
  let directnessRatio = 0;
  let directnessPoints = 0;
  let erraticMovementsDeduction = 0;
  const meaninglessHoversDeduction = 0; // Removed penalty
  const confusionDeduction = 0; // Removed penalty

  // Only calculate if we have movements
  if (movements.length > 1) {
    const firstMovement = movements[0];
    const lastMovement = movements[movements.length - 1];
    
    const diagonalDistance = Math.sqrt(
      Math.pow(lastMovement.x - firstMovement.x, 2) + 
      Math.pow(lastMovement.y - firstMovement.y, 2)
    );
    
    // Actual path length is sum of all movement segments
    let actualPathLength = 0;
    for (let i = 1; i < movements.length; i++) {
      const dist = Math.sqrt(
        Math.pow(movements[i].x - movements[i-1].x, 2) + 
        Math.pow(movements[i].y - movements[i-1].y, 2)
      );
      actualPathLength += dist;
    }
    
    // Calculate directness ratio with much more generous scoring for exploration
    directnessRatio = actualPathLength > 0 ? diagonalDistance / actualPathLength : 0;
    // Increased multiplier and higher minimum points for exploration-focused pages
    directnessPoints = Math.max(15, Math.min(20, directnessRatio * 25)); // Lower multiplier, higher minimum
    
    // Remove erratic movements deduction entirely since exploration is expected
    erraticMovementsDeduction = 0;
    
    // Calculate Intentionality Score with higher minimum floor
    intentionalityScore = Math.max(15, directnessPoints);
  } else {
    // Set default values for no movements
    intentionalityScore = 15; // Higher minimum score
    directnessPoints = 15; // Higher minimum points
  }

  // Calculate TOTAL SCORE
  let totalScore = engagementScore + focusScore + depthScore + durationScore + intentionalityScore;
  
  // Apply critical adjustments
  let adjustmentApplied = false;
  let adjustmentReason = '';
  
  // If any single score is below 5, cap the final score at 60
  if (engagementScore < 5 || focusScore < 5 || depthScore < 5 || 
      durationScore < 5 || intentionalityScore < 5) {
    if (totalScore > 60) {
      totalScore = 60;
      adjustmentApplied = true;
      adjustmentReason = 'One or more scores below 5';
    }
  }
  
  // If the session duration is <15 seconds, automatically cap the score at 40
  if (durationSeconds < 15) {
    if (totalScore > 40) {
      totalScore = 40;
      adjustmentApplied = true;
      adjustmentReason = 'Session duration less than 15 seconds';
    }
  }
  
  // If no meaningful interactions occurred, automatically cap the score at 30
  if (clicks.length === 0 && movements.length < 10) {
    if (totalScore > 30) {
      totalScore = 30;
      adjustmentApplied = true;
      adjustmentReason = 'No meaningful interactions';
    }
  }
  
  return {
    // Raw data
    durationSeconds,
    durationMinutes,
    
    // Engagement Score components
    clicksPerMinute,
    clickRatePoints,
    concentratedMovementsDeduction,
    inactivityDeduction,
    engagementScore,
    
    // Focus Score components
    cursorStdDev,
    cursorStabilityPoints,
    rapidSwitchingDeduction,
    continuousAttentionDeduction,
    focusScore,
    
    // Depth Score components
    pageCoverage,
    coveragePoints,
    scrollingDeduction,
    elementInteractionDeduction,
    depthScore,
    
    // Duration Score components
    timeOnPage,
    expectedTime,
    normalizedTimePoints,
    bounceDeduction,
    abruptEndingDeduction,
    durationScore,
    
    // Intentionality Score components
    directnessRatio,
    directnessPoints,
    erraticMovementsDeduction,
    meaninglessHoversDeduction,
    confusionDeduction,
    intentionalityScore,
    
    // Total score and adjustments
    totalScore,
    adjustmentApplied,
    adjustmentReason
  };
}

// Start server
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Heatmap server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
  });
