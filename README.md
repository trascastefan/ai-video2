# Stock Analysis Application

This application provides tools for stock market analysis with AI-powered script generation for financial videos.

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- [Ollama](https://ollama.com/download) - For local LLM functionality

## Quick Start

The easiest way to run the application is to use the provided macOS app:

1. Double-click the `Stock Analysis.app` file in the project directory
2. The app will automatically:
   - Start Ollama if it's not running
   - Pull the Mistral model if needed
   - Start the Next.js development server
   - Open your browser to the application

## Manual Setup and Run

If you prefer to run the components manually:

1. Install dependencies:
   ```
   npm install
   ```

2. Start Ollama service:
   ```
   ollama serve
   ```

3. Pull the Mistral model (if not already installed):
   ```
   ollama pull mistral
   ```

4. Start the Next.js development server:
   ```
   npm run dev
   ```

5. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Shutting Down

To stop all services:

1. Run the shutdown script:
   ```
   ./shutdown.sh
   ```
   
2. Follow the prompts to decide whether to stop Ollama as well

## Features

- Stock symbol search with auto-completion
- Company information display
- Time frame selection
- Candlestick chart visualization
- Volume analysis
- AI-powered script generation for financial videos
- Smart API fallback mechanism to handle rate limiting

## API Fallback Mechanism

This application implements a smart fallback system between multiple data providers:

- **Primary/Secondary Provider Configuration**: You can configure which API provider (Finnhub or Alpha Vantage) should be used as the primary source for different data types (OHLC data, news, company profiles).

- **Automatic Fallback**: If the primary provider fails or is rate-limited, the system automatically tries the secondary provider.

- **Caching**: All API responses are cached to minimize API calls and provide data even when both providers are rate-limited.

- **Rate Limit Handling**: The application detects rate limit errors and switches providers accordingly.

### Testing the Fallback Mechanism

You can test the fallback mechanism using the provided test script:

```
npx ts-node scripts/test-api-fallback.ts [SYMBOL]
```

This will run a series of tests on the fallback system using different configurations and report the results.

## Environment Variables

Make sure you have the following environment variables set in `.env.local`:

- `FINNHUB_API_KEY` - API key for Finnhub
- `ALPHA_VANTAGE_API_KEY` - API key for Alpha Vantage

## Troubleshooting

If you encounter any issues:

1. Check the logs:
   - Next.js logs: `nextjs.log`
   - Ollama logs: `ollama.log`

2. Make sure Ollama is running:
   ```
   curl http://localhost:11434/api/version
   ```

3. Verify the Mistral model is installed:
   ```
   ollama list
   ```

4. Restart the application by running `./startup.sh`
