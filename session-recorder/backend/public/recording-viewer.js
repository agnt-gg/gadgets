/**
 * Heatmap Recording Viewer
 * A simple viewer for heatmap recordings that emulates the playback functionality from the original heatmap.js
 */

(function() {
    // Configuration
    const config = {
        // Replace with your API key
        apiKey: '1234567890', // Should match server's API_KEY
        baseUrl: window.location.origin // Auto-detect base URL
    };

    // DOM Elements
    const elements = {
        sessionSelect: document.getElementById('session-select'),
        sessionInfo: document.getElementById('session-info'),
        viewportFrame: document.getElementById('viewport-frame'),
        cursor: document.getElementById('cursor'),
        playBtn: document.getElementById('play-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        playbackSpeed: document.getElementById('playback-speed'),
        analyzeBtn: document.getElementById('analyze-btn'),
        analysisResult: document.getElementById('analysis-result'),
        copyAnalysisBtn: document.getElementById('copy-analysis-btn')
    };

    // State
    let state = {
        sessions: [],
        currentSession: null,
        currentSessionData: null,
        isPlaying: false,
        playbackSpeed: 1,
        analysisText: null  // Store the analysis text for copying
    };

    // Initialize the viewer
    async function init() {
        try {
            // Load available sessions
            await loadSessions();
            
            // Setup event listeners
            setupEventListeners();

            // Try to auto-select most recent session
            await autoSelectRecentSession();
        } catch (error) {
            console.error('Error initializing heatmap viewer:', error);
            alert('Failed to initialize the heatmap viewer. Please check console for details.');
        }
    }

    // Load sessions from the server
    async function loadSessions() {
        try {
            const response = await fetch(`${config.baseUrl}/api/sessions`, {
                headers: {
                    'x-api-key': config.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load sessions: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.sessions && data.sessions.length > 0) {
                state.sessions = data.sessions;
                populateSessionSelector(data.sessions);
            } else {
                elements.sessionInfo.textContent = 'No sessions available.';
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            elements.sessionInfo.textContent = 'Error loading sessions. Check console for details.';
        }
    }

    // Populate the session selector dropdown
    function populateSessionSelector(sessions) {
        // Clear existing options
        elements.sessionSelect.innerHTML = '';
        
        // Add placeholder option
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select a session...';
        elements.sessionSelect.appendChild(placeholderOption);
        
        // Add sessions
        sessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.id;
            
            // Format date from timestamp
            const date = new Date(session.created_at);
            const formattedDate = date.toLocaleString();
            
            option.textContent = `${formattedDate} - ${session.user_agent?.substring(0, 30) || 'Unknown device'}`;
            elements.sessionSelect.appendChild(option);
        });
    }

    // Auto-select the most recent session
    async function autoSelectRecentSession() {
        try {
            const response = await fetch(`${config.baseUrl}/heatmap-data/get-recent-session`, {
                headers: {
                    'x-api-key': config.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get recent session: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.sessionId) {
                elements.sessionSelect.value = data.sessionId;
                loadSession(data.sessionId);
            }
        } catch (error) {
            console.error('Error auto-selecting recent session:', error);
        }
    }

    // Load a specific session
    async function loadSession(sessionId) {
        try {
            // Clear previous playback
            stopPlayback();
            
            // Update UI to loading state
            elements.sessionInfo.textContent = 'Loading session data...';
            elements.viewportFrame.style.backgroundImage = 'none';
            
            // Fetch session data
            const response = await fetch(`${config.baseUrl}/api/sessions/${sessionId}`, {
                headers: {
                    'x-api-key': config.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load session: ${response.status} ${response.statusText}`);
            }

            const sessionData = await response.json();
            state.currentSessionData = sessionData;
            
            // Update the session info section
            updateSessionInfo(sessionData);
            
            // Set the viewport size to match the recorded viewport
            setupViewport(sessionData.session);
            
            // Try to load screenshot if available
            await loadScreenshot(sessionId);
            
            // Enable play button
            elements.playBtn.disabled = false;
        } catch (error) {
            console.error('Error loading session:', error);
            elements.sessionInfo.textContent = 'Error loading session data. Check console for details.';
            elements.playBtn.disabled = true;
        }
    }

    // Load screenshot for the session if available
    async function loadScreenshot(sessionId) {
        try {
            const response = await fetch(`${config.baseUrl}/heatmap-data/get-screenshot?sessionId=${sessionId}`, {
                headers: {
                    'x-api-key': config.apiKey
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load screenshot: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.url) {
                // If it's a fallback, show a placeholder color instead
                if (data.fallback) {
                    console.log('Using fallback image:', data.url);
                    // Apply fallback image but adjust styling
                    elements.viewportFrame.style.backgroundColor = '#f5f5f5';
                    elements.viewportFrame.style.backgroundImage = `url(${data.url})`;
                    elements.viewportFrame.style.backgroundSize = 'contain';
                    elements.viewportFrame.style.backgroundPosition = 'top';
                    elements.viewportFrame.style.backgroundRepeat = 'no-repeat';
                } else {
                    console.log('Using actual screenshot:', data.url);
                    // Set the real screenshot as the background and ensure proper sizing
                    elements.viewportFrame.style.backgroundImage = `url(${data.url})`;
                    elements.viewportFrame.style.backgroundSize = '100% auto';
                    elements.viewportFrame.style.backgroundPosition = 'top';
                    elements.viewportFrame.style.backgroundRepeat = 'no-repeat';
                }
            }
        } catch (error) {
            console.error('Error loading screenshot:', error);
            // Use a solid color as fallback
            elements.viewportFrame.style.backgroundColor = '#ffffff';
            elements.viewportFrame.style.backgroundImage = 'none';
        }
    }

    // Update session info display
    function updateSessionInfo(sessionData) {
        const session = sessionData.session;
        const date = new Date(session.created_at);
        
        // Get the first page
        const page = sessionData.pages && sessionData.pages.length > 0 
            ? sessionData.pages[0] 
            : { url: 'Unknown', title: 'Unknown' };
        
        const infoHtml = `
            <div><strong>Date:</strong> ${date.toLocaleString()}</div>
            <div><strong>Duration:</strong> ${calculateDuration(sessionData)} seconds</div>
            <div><strong>Device:</strong> ${session.user_agent || 'Unknown'}</div>
            <div><strong>Viewport:</strong> ${session.viewport_width || 0}×${session.viewport_height || 0}</div>
            <div><strong>URL:</strong> ${page.url || 'Unknown'}</div>
            <div><strong>Page Title:</strong> ${page.title || 'Unknown'}</div>
            <div><strong>Events:</strong> ${sessionData.movements?.length || 0} movements, ${sessionData.clicks?.length || 0} clicks</div>
        `;
        
        elements.sessionInfo.innerHTML = infoHtml;
    }

    // Calculate session duration from events
    function calculateDuration(sessionData) {
        let earliestTime = Infinity;
        let latestTime = 0;
        
        // Check movements
        if (sessionData.movements && sessionData.movements.length > 0) {
            sessionData.movements.forEach(m => {
                earliestTime = Math.min(earliestTime, m.timestamp);
                latestTime = Math.max(latestTime, m.timestamp);
            });
        }
        
        // Check clicks
        if (sessionData.clicks && sessionData.clicks.length > 0) {
            sessionData.clicks.forEach(c => {
                earliestTime = Math.min(earliestTime, c.timestamp);
                latestTime = Math.max(latestTime, c.timestamp);
            });
        }
        
        // If we couldn't determine from events, use session timestamp
        if (earliestTime === Infinity || latestTime === 0) {
            return 0;
        }
        
        return ((latestTime - earliestTime) / 1000).toFixed(1);
    }

    // Setup the viewport size based on the recorded dimensions
    function setupViewport(session) {
        const viewportFrame = elements.viewportFrame;
        const container = viewportFrame.parentElement;

        const originalWidth = session.viewport_width || 1024;
        const originalHeight = session.viewport_height || 768;

        const aspectRatio = originalHeight / originalWidth;

        const containerWidth = container.clientWidth;
        viewportFrame.style.width = '100%';

        const calculatedHeight = containerWidth * aspectRatio;
        viewportFrame.style.height = `${calculatedHeight}px`;

        const scale = containerWidth / originalWidth;
        viewportFrame.dataset.scale = scale;
    }

    // Start playback of the session
    function startPlayback() {
        if (!state.currentSessionData || state.isPlaying) return;
        
        state.isPlaying = true;
        elements.playBtn.disabled = true;
        elements.pauseBtn.disabled = false;
        elements.cursor.style.display = 'block';
        
        // Start playback engine
        playbackSession(state.currentSessionData);
    }

    // Stop playback of the session
    function stopPlayback() {
        state.isPlaying = false;
        elements.playBtn.disabled = false;
        elements.pauseBtn.disabled = true;
        elements.cursor.style.display = 'none';
    }

    // Playback session data
    async function playbackSession(sessionData) {
        try {
            // Combine movements and clicks, and sort by timestamp
            const events = [...(sessionData.movements || []), ...(sessionData.clicks || [])]
                .sort((a, b) => a.timestamp - b.timestamp);
            
            if (events.length === 0) {
                console.log('No events to playback');
                stopPlayback();
                return;
            }
            
            const scale = parseFloat(elements.viewportFrame.dataset.scale) || 1;
            
            let lastTimestamp = events[0].timestamp;
            let lastScrollPosition = 0;
            
            // Get screenshot information to handle scrolling properly
            const hasFallbackScreenshot = elements.viewportFrame.style.backgroundSize === 'contain';
            
            // Start the playback loop
            for (const event of events) {
                // Check if playback was stopped
                if (!state.isPlaying) break;
                
                // Calculate delay based on playback speed
                const realTimeDelay = event.timestamp - lastTimestamp;
                const adjustedDelay = realTimeDelay / state.playbackSpeed;
                
                // Wait for appropriate delay
                if (adjustedDelay > 0) {
                    await delay(Math.min(adjustedDelay, 1000));
                }
                
                // Handle scrolling by adjusting background position
                if (Math.abs(event.scroll - lastScrollPosition) > 20) {
                    lastScrollPosition = event.scroll;
                    
                    // Different handling for fallback screenshots vs real screenshots
                    if (hasFallbackScreenshot) {
                        // For fallback screenshots (which are usually viewport-sized), 
                        // we may not need to adjust as much or at all
                        console.log('Scroll with fallback: minimal adjustment');
                        // Just move the cursor without adjusting background
                    } else {
                        // For real screenshots, adjust background position with scroll
                        elements.viewportFrame.style.backgroundPosition = `0 ${-event.scroll * scale}px`;
                        console.log('Scroll adjusted:', -event.scroll * scale);
                    }
                }
                
                // Scale coordinates based on viewport
                const scaledX = event.x * scale;
                const scaledY = (event.y - event.scroll) * scale;
                
                // Update cursor position
                elements.cursor.style.left = `${scaledX}px`;
                elements.cursor.style.top = `${scaledY}px`;
                
                // Handle click effect
                if ('element' in event) {
                    drawClickEffect(scaledX, scaledY);
                }
                
                lastTimestamp = event.timestamp;
            }
            
            // Reset after playback completes
            if (state.isPlaying) {
                // If playback wasn't manually stopped, reset and stop
                elements.viewportFrame.style.backgroundPosition = '0 0'; // Reset scroll position
                stopPlayback();
            }
            
        } catch (error) {
            console.error('Error during playback:', error);
            stopPlayback();
        }
    }

    // Draw click animation effect
    function drawClickEffect(x, y) {
        const clickEffect = document.createElement('div');
        clickEffect.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y}px;
            width: 20px;
            height: 20px;
            background: rgba(255, 255, 0, 0.3);
            border: 2px solid rgba(255, 165, 0, 0.5);
            border-radius: 50%;
            pointer-events: none;
            z-index: 9999;
            transform: translate(-50%, -50%) scale(0);
            animation: clickExpand 0.5s ease-out forwards;
        `;
        
        elements.viewportFrame.appendChild(clickEffect);
        
        // Remove after animation completes
        setTimeout(() => {
            if (clickEffect.parentNode) {
                elements.viewportFrame.removeChild(clickEffect);
            }
        }, 500);
    }

    // Setup event listeners
    function setupEventListeners() {
        // Session selection change
        elements.sessionSelect.addEventListener('change', function() {
            const sessionId = this.value;
            if (sessionId) {
                loadSession(sessionId);
            }
        });
        
        // Play button click
        elements.playBtn.addEventListener('click', function() {
            startPlayback();
        });
        
        // Pause button click
        elements.pauseBtn.addEventListener('click', function() {
            stopPlayback();
        });
        
        // Playback speed change
        elements.playbackSpeed.addEventListener('change', function() {
            state.playbackSpeed = parseFloat(this.value);
        });

        // Analyze button click
        elements.analyzeBtn.addEventListener('click', analyzeSession);
        
        // Copy analysis button click
        elements.copyAnalysisBtn.addEventListener('click', copyAnalysisToClipboard);
    }

    // Analyze session function
    async function analyzeSession() {
        const sessionId = elements.sessionSelect.value;
        if (!sessionId) {
            alert('Please select a session first.');
            return;
        }

        elements.analysisResult.textContent = 'Analyzing session...';
        elements.copyAnalysisBtn.disabled = true;

        try {
            const response = await fetch(`${config.baseUrl}/api/analyze-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey
                },
                body: JSON.stringify({ sessionId })
            });

            if (!response.ok) {
                throw new Error(`Analysis failed: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Store the raw analysis text for copying
            state.analysisText = data.analysis;
            
            // Convert markdown to HTML using Showdown
            const converter = new showdown.Converter({
                tables: true,
                tasklists: true,
                strikethrough: true,
                ghCodeBlocks: true,
                emoji: true,
                parseImgDimensions: true,
                simplifiedAutoLink: true,
                literalMidWordUnderscores: true,
                openLinksInNewWindow: true,
                backslashEscapesHTMLTags: true,
                simpleLineBreaks: true
            });
            
            // Set additional options
            showdown.setFlavor('github');
            
            // Convert markdown to HTML
            let htmlContent = converter.makeHtml(data.analysis);
            
            // Wrap tables in a scrollable container
            htmlContent = htmlContent.replace(
                /<table>/g, 
                '<div class="table-wrapper"><table>'
            ).replace(
                /<\/table>/g, 
                '</table></div>'
            );
            
            // Set the HTML content
            elements.analysisResult.innerHTML = htmlContent;
            
            // Enable the copy button
            elements.copyAnalysisBtn.disabled = false;

        } catch (error) {
            console.error('Analysis error:', error);
            elements.analysisResult.textContent = 'Error analyzing session. Check console for details.';
        }
    }

    // Copy analysis to clipboard
    function copyAnalysisToClipboard() {
        if (!state.analysisText) {
            alert('No analysis available to copy.');
            return;
        }
        
        // Copy to clipboard
        navigator.clipboard.writeText(state.analysisText)
            .then(() => {
                // Show success feedback
                const originalText = elements.copyAnalysisBtn.innerHTML;
                elements.copyAnalysisBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                
                // Reset button text after 2 seconds
                setTimeout(() => {
                    elements.copyAnalysisBtn.innerHTML = originalText;
                }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy text: ', err);
                alert('Failed to copy analysis to clipboard.');
            });
    }

    // Helper function to create delay
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Initialize the viewer when the DOM is loaded
    document.addEventListener('DOMContentLoaded', init);
})(); 