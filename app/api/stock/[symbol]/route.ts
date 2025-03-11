import { NextRequest, NextResponse } from 'next/server';
import { getDailyTimeSeries } from '@/app/utils/alphavantage';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const data = await getDailyTimeSeries(symbol);
    
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No data available' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in stock API route:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock data' },
      { status: 500 }
    );
  }
} 