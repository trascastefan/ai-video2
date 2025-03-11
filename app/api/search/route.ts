import { NextResponse } from 'next/server';
import { searchStocks } from '@/app/data/stocks';

// This is a mock implementation. In a real application, you would:
// 1. Use a real stock API (e.g., Finnhub, Alpha Vantage)
// 2. Implement proper error handling
// 3. Add rate limiting
// 4. Add caching

const MOCK_COMPANIES = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
];

interface FinnhubSearchResult {
  count: number;
  result: Array<{
    description: string;
    displaySymbol: string;
    symbol: string;
    type: string;
  }>;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');

  if (!query) {
    return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 });
  }

  try {
    const results = searchStocks(query);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Error searching stocks:', error);
    return NextResponse.json({ error: 'Failed to search stocks' }, { status: 500 });
  }
} 