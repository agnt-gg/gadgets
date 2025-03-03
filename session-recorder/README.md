# Session Recorder

A lightweight, drop-in solution for recording and playing back user interactions on your web pages. This tool helps you understand how users interact with your website by tracking mouse movements, clicks, and providing visual playback capabilities.

## Features

- 🎥 Real-time mouse movement recording
- 👆 Click tracking with visual feedback
- ⏯️ Interactive playback controls
- 🔄 Adjustable playback speeds (0.5x to 16x)
- 📊 Section and element tracking via data attributes
- 🖼️ Automatic screenshot capture
- 💾 Local storage for session data
- 🔌 Server integration ready

## Quick Start

1. Include the recorder script in your HTML:
```html
<script src="path/to/recorder.js"></script>
```

2. Add data attributes to your HTML elements for detailed tracking:
```html
<section data-section-id="hero" data-section-type="landing">
    <button data-element-id="cta-button">Click Me</button>
</section>
```

## Controls

The recorder adds a control panel to the bottom-right corner of your page with the following buttons for testing:

- ⏺️ **Record** - Start recording user interactions
- ⏹️ **Stop** - Stop the current recording
- ▶️ **Play** - Play back the recorded session
- ⏸️ **Pause** - Pause the playback
- 🗑️ **Clear** - Delete the current recording
- ⚡ **Speed** - Adjust playback speed (0.5x to 16x)

## Data Attributes

Add these data attributes to your HTML elements for enhanced tracking:

- `data-section-id`: Identifies a section of your page
- `data-section-type`: Categorizes the section type
- `data-element-id`: Identifies specific elements
- Any additional data attributes will be automatically captured

Example:
```html
<section 
    data-section-id="pricing" 
    data-section-type="sales"
    data-feature="premium">
    <button 
        data-element-id="subscribe-button"
        data-plan="pro">
        Subscribe Now
    </button>
</section>
```

## Server Integration

The recorder can automatically transmit session data to your server. To enable this:

1. Include the `recording-transmitter.js` script after the recorder:
```html
<script src="path/to/recorder.js"></script>
<script src="path/to/recording-transmitter.js"></script>
```

2. Configure your server endpoint in `recording-transmitter.js`:
```javascript
this.webhookUrl = "http://your-server.com/api/heatmap-data";
this.apiKey = "your-api-key";
```

## Data Storage

- Session data is automatically saved to localStorage every 5 seconds
- Data includes mouse movements, clicks, viewport information, and timestamps
- Screenshots are captured at the start of recording (requires html2canvas)

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## Development Notes

- The recorder uses throttling to optimize performance (100ms intervals)
- Minimum movement threshold of 10 pixels to reduce data noise
- Automatic handling of scroll position during playback
- Visual click effects for better playback experience

## Troubleshooting

1. **No Recording Data**: Ensure localStorage is available and not full
2. **Server Connection Issues**: Check console for connectivity warnings
3. **Playback Not Working**: Verify that the recording contains data
4. **Missing Element Data**: Confirm data attributes are properly set

## Best Practices

1. Add meaningful data attributes to important page sections
2. Clear old recordings periodically to manage localStorage space
3. Use section and element IDs that are descriptive and consistent
4. Test recordings on different viewport sizes

## Server Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm run start
```

The server will start on port 3000 by default (http://localhost:3000). You can change the port by setting the `PORT` environment variable.

### Environment Variables

Create a `.env` file in the backend directory with the following variables:
```env
PORT=3000
API_KEY=your_api_key_here
```

## License

Apache 2.0 License - Feel free to use in your projects!
