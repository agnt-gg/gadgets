/**
 * HeatmapTracker - A drop-in solution for recording and playing back user interactions
 * Version 1.1.0
 * Add "data-section-id" and "data-element-id" to sections and elements to track user interactions
 */

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    // Create and inject the control panel
    const controlPanel = document.createElement("div");
    controlPanel.innerHTML = `
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
        <div id="heatmap-container"></div>
        <div id="heatmap-controls" style="
            position: fixed;
            bottom: 8px;
            right: 8px;
            z-index: 10000;
            background: rgba(19, 19, 34, 0.9);
            padding: 8px;
            border-radius: 64px;
            display: flex;
            gap: 8px;
            font-family: sans-serif;
            font-size: 14px;
            border: 2px solid rgba(247, 248, 240, 0.05);
            backdrop-filter: blur(10px);
        ">
            <button onclick="window.HeatmapTracker.startRecording()" id="startBtn" title="Start Recording" style="
                padding: 6px 12px;
                border-radius: 32px 8px 8px 32px;
                border: none;
                background: #19ef83;
                color: #f7f8f0;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.2s ease;
            "><i class="fas fa-record-vinyl"></i></button>
            <button onclick="window.HeatmapTracker.stopRecording()" id="stopBtn" disabled title="Stop Recording" style="
                padding: 6px 12px;
                border-radius: 4px;
                border: none;
                background: #e53d8f;
                color: #f7f8f0;
                cursor: pointer;
                transition: all 0.2s ease;
            "><i class="fas fa-stop"></i></button>
            <button onclick="window.HeatmapTracker.playRecording()" id="playBtn" title="Play Recording" style="
                padding: 6px 12px;
                border-radius: 4px;
                border: none;
                background: #12e0ff;
                color: #f7f8f0;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.2s ease;
            "><i class="fas fa-play"></i></button>
            <button onclick="window.HeatmapTracker.stopPlayback()" id="pauseBtn" disabled title="Stop Playback" style="
                padding: 6px 12px;
                border-radius: 4px;
                border: none;
                background: #ffd700;
                color: #f7f8f0;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.2s ease;
            "><i class="fas fa-pause"></i></button>
            <button onclick="window.HeatmapTracker.clearRecording()" id="clearBtn" title="Clear Recording" style="
                padding: 6px 12px;
                border-radius: 4px;
                border: none;
                background: #e53d8f;
                color: #f7f8f0;
                cursor: pointer;
                transition: all 0.2s ease;
            "><i class="fas fa-trash"></i></button>
            <select id="playbackSpeed" onchange="window.HeatmapTracker.updatePlaybackSpeed()" style="
                padding: 6px;
                border-radius: 8px 32px 32px 8px;
                border: none;
                background: #10101f;
                color: #f7f8f0;
                border: 1px solid rgba(247, 248, 240, 0.1);
                cursor: pointer;
                transition: all 0.2s ease;
            ">
                <option value="0.5">0.5x Speed</option>
                <option value="1" selected>1x Speed</option>
                <option value="2">2x Speed</option>
                <option value="4">4x Speed</option>
                <option value="8">8x Speed</option>
                <option value="16">16x Speed</option>
            </select>
        </div>
    `;
    document.body.appendChild(controlPanel);

    // Add CSS for click animation
    const style = document.createElement("style");
    style.textContent = `
            @keyframes clickExpand {
                0% {
                    transform: translate(-50%, -50%) scale(0);
                    opacity: 1;
                }
                100% {
                    transform: translate(-50%, -50%) scale(3);
                    opacity: 0;
                }
            }
        `;
    document.head.appendChild(style);

    // Add hover effects style
    const hoverStyle = document.createElement("style");
    hoverStyle.textContent = `
        #heatmap-controls button:hover {
            transform: translateY(-2px);
            filter: brightness(1.1);
        }
        #heatmap-controls select:hover {
            background: #131322;
        }
        #heatmap-controls button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
    `;
    document.head.appendChild(hoverStyle);

    // Initialize and expose the system globally
    window.HeatmapTracker = new HeatmapSystem();
  });

  class HeatmapSystem {
    constructor() {
      this.tracker = new HeatmapTracker();
      this.playback = new HeatmapPlayback("heatmap-container");
      console.log("Heatmap system initialized");
      document.getElementById("pauseBtn").disabled = true;
      document.getElementById("stopBtn").disabled = true;
    }

    startRecording() {
      this.tracker.startRecording();
      document.getElementById("startBtn").disabled = true;
      document.getElementById("stopBtn").disabled = false;
      // Disable play/pause during recording
      document.getElementById("playBtn").disabled = true;
      document.getElementById("pauseBtn").disabled = true;
      document.getElementById("clearBtn").disabled = true;
    }

    stopRecording() {
      this.tracker.stopRecording();
      document.getElementById("startBtn").disabled = false;
      document.getElementById("stopBtn").disabled = true;
      // Re-enable play/pause after recording
      document.getElementById("playBtn").disabled = false;
      document.getElementById("pauseBtn").disabled = true;
      document.getElementById("clearBtn").disabled = false;
    }

    playRecording() {
        const data = JSON.parse(localStorage.getItem("heatmapData"));
        if (data && this.playback) {
            // Enable pause button when playback starts
            document.getElementById("pauseBtn").disabled = false;
            document.getElementById("playBtn").disabled = true;
            document.getElementById("clearBtn").disabled = true;
            document.getElementById("startBtn").disabled = true;
            document.getElementById("stopBtn").disabled = true;
            this.playback.playback(data).finally(() => {
                // Disable pause button when playback ends naturally
                document.getElementById("pauseBtn").disabled = true;
                document.getElementById("playBtn").disabled = false;
                document.getElementById("clearBtn").disabled = false;
                document.getElementById("startBtn").disabled = false;
                document.getElementById("stopBtn").disabled = true;
            });
        } else {
            alert("No recording data found!");
        }
    }

    stopPlayback() {
        if (this.playback) {
            this.playback.stop();
            // Disable pause button when playback is stopped manually
            document.getElementById("pauseBtn").disabled = true;
            document.getElementById("playBtn").disabled = false;
        }
    }

    clearRecording() {
        this.tracker.clearData();
        if (this.playback) {
            this.playback.clear();
        }
        // Reset all button states
        document.getElementById("startBtn").disabled = false;
        document.getElementById("stopBtn").disabled = true;
        document.getElementById("playBtn").disabled = false;
        document.getElementById("pauseBtn").disabled = true;
        alert("Recording data cleared!");
    }

    updatePlaybackSpeed() {
      if (this.playback) {
        const speed = document.getElementById("playbackSpeed").value;
        this.playback.playbackSpeed = parseFloat(speed);
      }
    }
  }

  class HeatmapTracker {
    constructor() {
      this.data = {
        movements: [],
        clicks: [],
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        sessionStart: null,
      };
      this.isRecording = false;
      this.boundMouseMove = this.handleMouseMove.bind(this);
      this.boundClick = this.handleClick.bind(this);
      this.saveInterval = null;
      this.lastRecordedTime = 0;
      this.throttleInterval = 100; // Only record every 100ms
      this.minDistance = 10; // Minimum pixels moved before recording
      this.lastX = 0;
      this.lastY = 0;
    }

    startRecording() {
      if (this.isRecording) return;
      this.isRecording = true;
      this.data.sessionStart = Date.now();
      document.addEventListener("mousemove", this.boundMouseMove);
      document.addEventListener("click", this.boundClick);
      this.saveInterval = setInterval(() => this.saveData(), 5000);
      console.log("Recording started");
    }

    stopRecording() {
      if (!this.isRecording) return;
      this.isRecording = false;
      document.removeEventListener("mousemove", this.boundMouseMove);
      document.removeEventListener("click", this.boundClick);
      clearInterval(this.saveInterval);
      this.saveData();
      console.log("Recording stopped");
    }

    handleMouseMove(e) {
      if (!this.isRecording) return;
      this.recordMovement(e);
    }

    handleClick(e) {
      if (!this.isRecording) return;
      this.recordClick(e);
    }

    recordMovement(e) {
      if (!this.isRecording) return;

      const now = Date.now();
      const timeDiff = now - this.lastRecordedTime;
      const distance = Math.sqrt(
        Math.pow(e.pageX - this.lastX, 2) + Math.pow(e.pageY - this.lastY, 2)
      );

      // Only record if enough time has passed AND mouse has moved significantly
      if (timeDiff < this.throttleInterval || distance < this.minDistance) {
        return;
      }

      let currentElement = e.target;
      let sectionData = null;

      // Find parent section data
      while (currentElement && !sectionData) {
        if (currentElement.tagName === "SECTION" && currentElement.dataset) {
          sectionData = {
            sectionId: currentElement.dataset.sectionId,
            sectionType: currentElement.dataset.sectionType,
            ...Object.entries(currentElement.dataset).reduce(
              (acc, [key, value]) => {
                if (!["sectionId", "sectionType"].includes(key))
                  acc[key] = value;
                return acc;
              },
              {}
            ),
          };
        }
        currentElement = currentElement.parentElement;
      }

      const movement = {
        x: e.pageX,
        y: e.pageY,
        timestamp: now,
        scroll: window.scrollY,
        section: sectionData,
      };

      this.data.movements.push(movement);
      this.lastRecordedTime = now;
      this.lastX = e.pageX;
      this.lastY = e.pageY;
    }

    recordClick(e) {
      let currentElement = e.target;
      let sectionData = null;
      let elementData = {};

      // Collect data attributes from clicked element
      if (currentElement.dataset) {
        elementData = {
          elementId: currentElement.dataset.elementId,
          ...Object.entries(currentElement.dataset).reduce(
            (acc, [key, value]) => {
              if (key !== "elementId") acc[key] = value;
              return acc;
            },
            {}
          ),
        };
      }

      // Find parent section and its data
      while (currentElement && !sectionData) {
        if (currentElement.tagName === "SECTION" && currentElement.dataset) {
          sectionData = {
            sectionId: currentElement.dataset.sectionId,
            sectionType: currentElement.dataset.sectionType,
            ...Object.entries(currentElement.dataset).reduce(
              (acc, [key, value]) => {
                if (!["sectionId", "sectionType"].includes(key))
                  acc[key] = value;
                return acc;
              },
              {}
            ),
          };
        }
        currentElement = currentElement.parentElement;
      }

      const click = {
        x: e.pageX,
        y: e.pageY,
        timestamp: Date.now(),
        scroll: window.scrollY,
        element: {
          tag: e.target.tagName,
          class: e.target.className,
          text: e.target.textContent?.trim().substring(0, 100),
          ...elementData,
        },
        section: sectionData,
      };

      this.data.clicks.push(click);
    }

    saveData() {
      localStorage.setItem("heatmapData", JSON.stringify(this.data));
    }

    clearData() {
      this.stopRecording();
      this.data = {
        movements: [],
        clicks: [],
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        sessionStart: null,
      };
      localStorage.removeItem("heatmapData");
    }
  }

  class HeatmapPlayback {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d");

      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;

      this.canvas.style.position = "fixed";
      this.canvas.style.top = "0";
      this.canvas.style.left = "0";
      this.canvas.style.pointerEvents = "none";
      this.canvas.style.zIndex = "9999";

      this.container.appendChild(this.canvas);

      this.playbackSpeed = 1;
      this.isPlaying = false;

      this.cursor = document.createElement("div");
      this.cursor.style.cssText = `
                position: fixed;
                width: 20px;
                height: 20px;
                background: rgba(255, 255, 0, 0.7);
                border: 2px solid rgba(255, 165, 0, 0.9);
                border-radius: 50%;
                pointer-events: none;
                z-index: 10000;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 10px rgba(255, 255, 0, 0.5);
                transition: all 0.05s ease-out;
                display: none;
            `;
      document.body.appendChild(this.cursor);
    }

    async playback(data) {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.cursor.style.display = "block";
  
        try {
          const events = [...data.movements, ...data.clicks].sort(
            (a, b) => a.timestamp - b.timestamp
          );
  
          if (events.length === 0) {
            console.log("No events to play");
            return;
          }
  
          while (this.isPlaying) {  // Added continuous loop
            // Store initial scroll position
            const initialScroll = window.scrollY;
            
            let lastTimestamp = events[0].timestamp;
            let lastScrollTarget = 0;
  
            for (const event of events) {
              if (!this.isPlaying) break;
  
              const realTimeDelay = event.timestamp - lastTimestamp;
              const adjustedDelay = realTimeDelay / this.playbackSpeed;
  
              if (adjustedDelay > 0) {
                await this.delay(Math.min(adjustedDelay, 1000));
              }
  
              if (Math.abs(event.scroll - lastScrollTarget) > 50) {
                lastScrollTarget = event.scroll;
                window.scrollTo({
                  top: event.scroll,
                  behavior: "auto",
                });
              }
  
              const viewportY = event.y - window.scrollY;
              this.cursor.style.left = `${event.x}px`;
              this.cursor.style.top = `${viewportY}px`;
  
              if ("element" in event) {
                this.drawClickEffect(event.x, viewportY);
                console.log("Click:", event.element, event.section);
              }
  
              lastTimestamp = event.timestamp;
            }
  
            // Reset scroll position before starting next loop
            window.scrollTo({
              top: initialScroll,
              behavior: "auto",
            });
  
            // Small delay between loops
            await this.delay(1000);
          }
        } finally {
          this.isPlaying = false;
          this.cursor.style.display = "none";
        }
      }

    drawClickEffect(x, y) {
      const clickEffect = document.createElement("div");
      clickEffect.style.cssText = `
                position: fixed;
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

      document.body.appendChild(clickEffect);
      setTimeout(() => document.body.removeChild(clickEffect), 500);
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    stop() {
      this.isPlaying = false;
      this.cursor.style.display = "none";
    }

    clear() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.cursor.style.display = "none";
    }
  }
})();
