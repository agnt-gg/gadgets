/**
 * Heatmap Data Transmitter
 * Automatically captures and transmits heatmap data to a server
 */

(function() {
    // Flag to prevent multiple initializations 
    let isInitialized = false;
    
    // Wait for both DOM and HeatmapTracker to be loaded
    document.addEventListener('DOMContentLoaded', function() {
        // Load html2canvas for screenshot capture
        const html2canvasScript = document.createElement('script');
        html2canvasScript.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
        html2canvasScript.onload = function() {
            console.log('html2canvas loaded for screenshot capture');
        };
        document.head.appendChild(html2canvasScript);
        
        // Check for HeatmapTracker every 100ms until available
        const checkInterval = setInterval(function() {
            if (window.HeatmapTracker && !isInitialized) {
                clearInterval(checkInterval);
                initHeatmapTransmitter();
            }
        }, 100);
    });

    function initHeatmapTransmitter() {
        // Prevent multiple initializations
        if (isInitialized) return;
        isInitialized = true;
        
        const transmitter = new HeatmapDataTransmitter();
        
        // Test server connectivity
        transmitter.testServerConnectivity();
        
        // Expose transmitter globally (for debugging)
        window.HeatmapTransmitter = transmitter;
        
        // Handle page unload to ensure final data transmission
        window.addEventListener('beforeunload', function() {
            transmitter.transmitData(true);
        });
        
        // Hook into HeatmapTracker's recording methods
        if (window.HeatmapTracker) {
            const originalStartRecording = window.HeatmapTracker.startRecording;
            const originalStopRecording = window.HeatmapTracker.stopRecording;
            
            window.HeatmapTracker.startRecording = function() {
                originalStartRecording.apply(window.HeatmapTracker);
                setTimeout(() => transmitter.startCapturing(), 100);
            };
            
            window.HeatmapTracker.stopRecording = function() {
                originalStopRecording.apply(window.HeatmapTracker);
                setTimeout(() => transmitter.stopCapturing(), 100);
            };
            
            // Start recording automatically after a short delay
            // (only if HeatmapTracker is not already recording)
            setTimeout(() => {
                if (!window.HeatmapTracker.tracker.isRecording) {
                    window.HeatmapTracker.startRecording();
                } else {
                    // If already recording, just start capturing
                    transmitter.startCapturing();
                }
            }, 2000);
        }
    }

    class HeatmapDataTransmitter {
        constructor() {
            this.webhookUrl = "http://localhost:3000/api/heatmap-data"; 
            this.apiKey = "1234567890"; // Should match your server's API_KEY
            this.transmitInterval = 30000; // Transmit every 30 seconds
            this.transmitTimer = null;
            this.sessionId = this.generateSessionId();
            this.isCapturing = false;
            this.serverAvailable = null; // Unknown server status initially
            this.offlineQueue = []; // Queue for storing data when server is unavailable
            this.screenshot = null; // Store screenshot data
            this.isFileProtocol = window.location.protocol === 'file:';
            
            // Show warning when running from file:// protocol
            // if (this.isFileProtocol) {
            //     console.warn('⚠️ Running from file:// protocol. Server transmission will be disabled. To enable full functionality, please serve these files from a web server.');
                
            //     // Create a warning message on the page
            //     setTimeout(() => {
            //         const warningDiv = document.createElement('div');
            //         warningDiv.style.cssText = `
            //             position: fixed;
            //             bottom: 70px;
            //             right: 10px;
            //             background: rgba(255, 200, 50, 0.9);
            //             color: #333;
            //             padding: 10px 15px;
            //             border-radius: 4px;
            //             font-family: sans-serif;
            //             font-size: 12px;
            //             z-index: 99999;
            //             max-width: 300px;
            //         `;
            //         warningDiv.innerHTML = `
            //             <p><strong>⚠️ Development Mode</strong></p>
            //             <p>Heatmap data is being recorded and will be transmitted to the server.</p>
            //             <p>For optimal performance, consider serving these files from a web server.</p>
            //         `;
            //         document.body.appendChild(warningDiv);
                    
            //         // Auto-remove after 10 seconds
            //         setTimeout(() => {
            //             try { document.body.removeChild(warningDiv); } catch(e) {}
            //         }, 10000);
            //     }, 2000);
            // }
            
            // Also show API key warning
            console.warn("⚠️ Using default API key. If the server requires a different key, please update it in heatmap-transmitter.js");
            
            // Check if CORS might be an issue - if hostname is different from localhost:3000
            if (window.location.hostname !== 'localhost' && 
                window.location.hostname !== '127.0.0.1' &&
                window.location.port !== '3000') {
                console.warn("⚠️ Cross-Origin issues may occur when transmitting data to localhost:3000 from a different origin. Make sure CORS is enabled on the server.");
            }
        }
        
        testServerConnectivity() {
            console.log("🔄 Testing server connectivity...");
            
            // Create extremely simple connectivity test
            const img = new Image();
            const timestamp = new Date().getTime();
            img.onload = () => {
                console.log("✅ SERVER IS REACHABLE! The ping test to the heatmap server succeeded.");
                console.log(`Server root page is accessible at: ${img.src}`);
                this.serverAvailable = true;
                this.showSuccessNotification("Server connection confirmed!");
            };
            
            img.onerror = () => {
                console.error("❌ SERVER IS UNREACHABLE! The ping test to the heatmap server failed.");
                console.error("Make sure the server is running at: http://localhost:3000");
                this.serverAvailable = false;
                
                // Display a warning on the page about server connectivity
                const warningDiv = document.createElement('div');
                warningDiv.style.cssText = `
                    position: fixed;
                    bottom: 70px;
                    right: 10px;
                    background: rgba(255, 0, 0, 0.9);
                    color: white;
                    padding: 15px 20px;
                    border-radius: 4px;
                    font-family: sans-serif;
                    font-size: 14px;
                    z-index: 100000;
                    max-width: 400px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
                `;
                warningDiv.innerHTML = `
                    <p style="font-weight:bold;margin:0 0 10px 0">⚠️ SERVER CONNECTION FAILED</p>
                    <p style="margin:0 0 10px 0">Could not connect to the heatmap server at:</p>
                    <p style="margin:0 0 10px 0;font-family:monospace;background:#300;padding:5px">http://localhost:3000</p>
                    <p style="margin:0">Data will be saved locally only.</p>
                    <button id="closeWarning" style="margin-top:10px;padding:5px 10px;background:#fff;color:#f00;border:none;border-radius:3px;cursor:pointer">Close</button>
                `;
                document.body.appendChild(warningDiv);
                
                // Add close button functionality
                document.getElementById('closeWarning').addEventListener('click', () => {
                    document.body.removeChild(warningDiv);
                });
                
                // Try a direct HTTP request as another test
                const fallbackUrl = "http://localhost:3000";
                console.log("Trying fallback connectivity test...");
                
                const testRequest = new XMLHttpRequest();
                testRequest.onreadystatechange = function() {
                    if (this.readyState === 4) {
                        if (this.status === 200) {
                            console.log("✅ Fallback test succeeded! Server is actually reachable.");
                        } else {
                            console.error(`❌ Fallback test also failed with status: ${this.status}`);
                        }
                    }
                };
                
                testRequest.onerror = function() {
                    console.error("❌ Fallback XMLHttpRequest also failed. Server is definitely unreachable.");
                    console.error("This could be due to: 1) Server not running 2) Firewall blocking 3) CORS issues");
                };
                
                // Set a short timeout for the request
                testRequest.timeout = 3000;
                testRequest.ontimeout = function() {
                    console.error("❌ Fallback request timed out. Server is unreachable.");
                };
                
                try {
                    testRequest.open("GET", fallbackUrl, true);
                    testRequest.send();
                } catch (e) {
                    console.error("❌ Exception trying to make fallback request:", e);
                }
            };
            
            // Add cache-busting parameter to prevent caching
            img.src = `http://localhost:3000/favicon.ico?_=${timestamp}`;
        }
        
        generateSessionId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
        
        async captureScreenshot() {
            if (!window.html2canvas) {
                console.error('html2canvas is not loaded yet.');
                return null;
            }

            try {
                const canvas = await html2canvas(document.body, {
                    scale: 1,
                    useCORS: true,
                    allowTaint: true
                });

                const ctx = canvas.getContext('2d');

                const videos = document.querySelectorAll('video');
                for (const video of videos) {
                    const rect = video.getBoundingClientRect();
                    const posterSrc = video.getAttribute('poster');

                    if (posterSrc) {
                        await new Promise((resolve, reject) => {
                            const img = new Image();
                            img.crossOrigin = 'anonymous';
                            img.onload = () => {
                                ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height);
                                resolve();
                            };
                            img.onerror = reject;
                            img.src = posterSrc;
                        });
                    }
                }

                const screenshotData = canvas.toDataURL('image/jpeg', 0.9);
                console.log("✅ Screenshot captured successfully with video poster");
                return screenshotData;
            } catch (error) {
                console.error('❌ Error capturing screenshot with video poster:', error);
                return null;
            }
        }
        
        async startCapturing() {
            if (this.isCapturing) {
                console.log('Heatmap transmitter is already capturing');
                return;
            }
            
            // Start the heatmap recording if it's not already recording
            if (window.HeatmapTracker && !window.HeatmapTracker.tracker.isRecording) {
                window.HeatmapTracker.startRecording();
            }
            
            try {
                // Directly capture screenshot without async issues
                this.screenshot = await this.captureScreenshot();
                console.log('Page representation captured successfully');
            } catch (err) {
                console.error('Failed to capture page representation:', err);
                this.screenshot = null;
            }
            
            // Set up periodic transmission
            this.transmitTimer = setInterval(() => {
                this.transmitData(false);
            }, this.transmitInterval);
            
            this.isCapturing = true;
            console.log('Heatmap data capture started with session ID:', this.sessionId);
        }
        
        stopCapturing() {
            if (!this.isCapturing) {
                console.log('Heatmap transmitter is not capturing');
                return;
            }
            
            // Clear the transmission timer
            if (this.transmitTimer) {
                clearInterval(this.transmitTimer);
                this.transmitTimer = null;
            }
            
            // Transmit final data
            this.transmitData(true);
            
            this.isCapturing = false;
            console.log('Heatmap data capture stopped');
        }
        
        transmitData(isFinal) {
            const heatmapDataStr = localStorage.getItem("heatmapData");
            if (!heatmapDataStr) {
                console.log('No heatmap data to transmit');
                return;
            }

            const heatmapData = JSON.parse(heatmapDataStr);
            if (heatmapData.movements.length === 0 && heatmapData.clicks.length === 0) {
                console.log('No meaningful heatmap data to transmit');
                return;
            }

            const payload = {
                sessionId: this.sessionId,
                isFinal: isFinal,
                timestamp: Date.now(),
                page: {
                    url: window.location.href,
                    path: window.location.pathname,
                    title: document.title,
                    referrer: document.referrer
                },
                userAgent: navigator.userAgent,
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                },
                heatmapData: heatmapData,
                screenshot: this.screenshot
            };

            fetch(this.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify(payload)
            })
            .then(async response => {
                if (!response.ok) {
                    const errorDetails = await response.json();
                    throw new Error(`Server error: ${response.status} - ${errorDetails.error}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("✅ Data transmitted successfully:", data);
            })
            .catch(error => {
                console.error("❌ Error transmitting heatmap data:", error.message);
            });
        }
        
        queueData(payload) {
            console.log('Server unavailable, queuing heatmap data');
            this.offlineQueue.push(payload);
            
            // Limit queue size to prevent memory issues
            if (this.offlineQueue.length > 10) {
                this.offlineQueue.shift(); // Remove oldest item
            }
        }
        
        sendQueuedData() {
            if (this.offlineQueue.length === 0) return;
            
            console.log(`Attempting to send ${this.offlineQueue.length} queued heatmap data items`);
            
            // Take a copy of the queue and clear it
            const queueToSend = [...this.offlineQueue];
            this.offlineQueue = [];
            
            // Try to send each item
            queueToSend.forEach(payload => {
                fetch(this.webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': this.apiKey
                    },
                    body: JSON.stringify(payload)
                }).catch(error => {
                    // If sending fails, re-queue the item
                    this.queueData(payload);
                });
            });
        }
        
        saveDataLocally(payload) {
            console.log('Server unavailable, storing data locally');
            
            // Store data in localStorage for potential later export
            try {
                const savedSessions = JSON.parse(localStorage.getItem('heatmapSavedSessions') || '[]');
                savedSessions.push({
                    timestamp: Date.now(),
                    payload: payload
                });
                // Limit to last 5 sessions to avoid storage issues
                if (savedSessions.length > 5) {
                    savedSessions.shift();
                }
                localStorage.setItem('heatmapSavedSessions', JSON.stringify(savedSessions));
                console.log('Session data saved locally. To export, use: console.save(JSON.parse(localStorage.getItem("heatmapSavedSessions")))');
            } catch (e) {
                console.error('Failed to save session locally:', e);
            }
        }

        // Helper function to show a success notification
        showSuccessNotification(message) {
            const notificationDiv = document.createElement('div');
            notificationDiv.style.cssText = `
                position: fixed;
                bottom: 70px;
                right: 10px;
                background: rgba(46, 204, 113, 0.9);
                color: white;
                padding: 15px 20px;
                border-radius: 4px;
                font-family: sans-serif;
                font-size: 14px;
                z-index: 99999;
                max-width: 300px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                transition: all 0.3s ease;
                opacity: 0;
                transform: translateY(20px);
            `;
            notificationDiv.innerHTML = `
                <p><strong>✅ Success</strong></p>
                <p>${message}</p>
            `;
            document.body.appendChild(notificationDiv);
            
            // Animate in
            setTimeout(() => {
                notificationDiv.style.opacity = '1';
                notificationDiv.style.transform = 'translateY(0)';
            }, 10);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                notificationDiv.style.opacity = '0';
                notificationDiv.style.transform = 'translateY(20px)';
                
                // Remove from DOM after animation completes
                setTimeout(() => {
                    try { document.body.removeChild(notificationDiv); } catch(e) {}
                }, 300);
            }, 5000);
        }
    }
})(); 