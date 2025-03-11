import { NextResponse } from 'next/server';
import { companyDataCache, isRateLimited } from '../../utils/cache';
import { getCompanyProfileWithFallback } from '../../utils/stock-api';

// Mock company data used as a last resort if all API calls and caching fails
const MOCK_COMPANY_DATA = {
  'AAPL': {
    name: 'Apple Inc.',
    description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.',
    marketCap: 2950000000000,
    volume: 55000000,
    sector: 'Technology',
    industry: 'Consumer Electronics'
  },
  'GOOGL': {
    name: 'Alphabet Inc.',
    description: 'Alphabet Inc. provides various products and platforms in the United States, Europe, the Middle East, Africa, the Asia-Pacific, Canada, and Latin America.',
    marketCap: 1850000000000,
    volume: 33000000,
    sector: 'Technology',
    industry: 'Internet Content & Information'
  },
  // Additional fallback data for common stocks
  'MSFT': {
    name: 'Microsoft Corporation',
    description: 'Microsoft Corporation develops, licenses, and supports software, services, devices, and solutions worldwide.',
    marketCap: 2800000000000,
    volume: 25000000,
    sector: 'Technology',
    industry: 'Software—Infrastructure'
  },
  'AMZN': {
    name: 'Amazon.com Inc.',
    description: 'Amazon.com, Inc. engages in the retail sale of consumer products and subscriptions through online and physical stores in North America and internationally.',
    marketCap: 1700000000000,
    volume: 35000000,
    sector: 'Consumer Cyclical',
    industry: 'Internet Retail'
  },
  'META': {
    name: 'Meta Platforms Inc.',
    description: 'Meta Platforms, Inc. develops products that enable people to connect and share with friends and family through mobile devices, personal computers, virtual reality headsets, and in-home devices worldwide.',
    marketCap: 1100000000000,
    volume: 20000000,
    sector: 'Technology',
    industry: 'Internet Content & Information'
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.toUpperCase();
  const forceRefresh = searchParams.get('force') === 'true';
  const useMock = searchParams.get('mock') === 'true'; // Parameter to explicitly request mock data
  const disallowMock = searchParams.get('mock') === 'false'; // New parameter to disallow mock data
  
  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }
  
  console.log(`Processing company profile request for ${symbol}${forceRefresh ? ' (forced refresh)' : ''}${useMock ? ' (using mock data)' : ''}${disallowMock ? ' (disallowing mock data)' : ''}`);

  // If mock data is explicitly requested, return it immediately
  if (useMock && symbol in MOCK_COMPANY_DATA) {
    console.log(`Using mock data for ${symbol} as explicitly requested`);
    return NextResponse.json(MOCK_COMPANY_DATA[symbol as keyof typeof MOCK_COMPANY_DATA]);
  }
  
  // Check if we can use cached data (unless force refresh is requested)
  if (!forceRefresh) {
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.companyInfo && !isRateLimited) {
      // Check if cache is fresh (less than 1 hour)
      const cacheAge = Date.now() - (cachedData.lastUpdated || 0);
      if (cacheAge < 3600000) { // 1 hour in milliseconds
        console.log(`Using fresh cached data for ${symbol} company profile`);
        return NextResponse.json(cachedData.companyInfo);
      }
    }
  }
  
  try {
    // Use our unified API with fallback
    const profile = await getCompanyProfileWithFallback(symbol);
    
    if (!profile || !profile.name) {
      console.error(`Company profile not found for ${symbol}`);
      return NextResponse.json(
        { error: 'Company not found' },
        { status: 404 }
      );
    }
    
    // Update cache with the fresh data
    companyDataCache.set(symbol, { 
      companyInfo: profile,
      lastUpdated: Date.now()
    });
    
    return NextResponse.json(profile);
  } catch (error) {
    console.error('Error fetching company profile:', error);
    
    // For forced refresh, we don't want to return either cached or mock data
    if (forceRefresh) {
      console.log(`Refresh failed for ${symbol}, returning error instead of fallback`);
      return NextResponse.json(
        { error: 'Failed to refresh company data. APIs may be rate-limited.' },
        { status: 503 }
      );
    }
    
    // Try memory cache as fallback if not forcing refresh
    const cachedData = companyDataCache.get(symbol);
    if (cachedData?.companyInfo) {
      console.log(`Using cached data for ${symbol} company profile as fallback`);
      return NextResponse.json(cachedData.companyInfo);
    }
    
    // If we have mock data for this symbol, use it as a last resort
    // Only if not forcing a refresh and mock data isn't explicitly disallowed
    if (symbol in MOCK_COMPANY_DATA && !disallowMock) {
      console.log(`Using mock data for ${symbol} as last resort`);
      return NextResponse.json(MOCK_COMPANY_DATA[symbol as keyof typeof MOCK_COMPANY_DATA]);
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch company data' },
      { status: 500 }
    );
  }
} 