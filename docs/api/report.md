# Report Dashboard

The Report Dashboard is a Vue 3 single-page application that provides the interactive market intelligence interface. It runs on **port 4568** and connects to the backend API on port 4567.

## Pages

### Home Dashboard

The main overview shows:
- Market snapshot with real-time prices
- Asset sparklines and mini-charts
- Active alerts and notification status
- Quick links to reports and watchlists

### Asset Detail

Individual asset view with:
- Live price chart with configurable intervals (1m → 1y)
- OHLCV candlestick data
- Related news feed
- Alert configuration
- Historical price analysis

### Daily Reports

AI-generated market reports featuring:
- Market overview with sector analysis
- Incident tracking with severity classification
- Economic indicators digest
- Sentiment analysis from news sources
- Multi-format output (text, HTML, Discord embed)

### Report Editor

Edit and refine generated reports:
- Inline content editing
- Section-level rewrite proposals
- AI-assisted suggestions
- Version history
- Export to multiple formats

### Impact Simulator

Model market impact scenarios:
- Select assets and input parameters
- Simulate price movements
- Visualize potential outcomes
- Correlation analysis across asset classes

### Watchlist Insights

Analyze your watchlist:
- Portfolio performance tracking
- Asset correlation matrix
- Alert history per asset
- News relevance scoring
- Custom groupings and tags

### RAG Report Builder

Build reports from RAG evidence:
- Search the RAG store for relevant documents
- Drag-and-drop content sections
- AI-assisted report assembly
- Citation tracking and verification
- Export with full attribution

## API Endpoints Used

The dashboard communicates with these backend endpoints:

```
GET  /health              → Server status
GET  /api/me              → Current user session
GET  /api/assets          → Asset list with prices
GET  /api/assets/:id      → Asset detail
GET  /api/alerts          → User alerts
GET  /api/reports         → Report history
POST /api/generate-report → Generate new report
POST /api/rag/search      → RAG queries
GET  /api/discord/settings → Discord config
```

## Styling

- Dark theme by default
- Responsive design (mobile-friendly)
- PWA-capable with service worker
- Chart.js for data visualization

## Development

```bash
cd frontend
npm install
npm run dev    # Starts on port 5173
```

### Build for Production

```bash
cd frontend
npm run build
# Output: frontend/dist/ (served by backend in production)
```

## Environment

```env
VITE_API_URL=http://localhost:4567
VITE_DASHBOARD_PORT=4568
```
