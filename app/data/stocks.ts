export interface Stock {
  symbol: string;
  name: string;
  marketCap: number;  // in billions
  sector: string;
}

// Top 1000 stocks by market cap (showing top 100 here for brevity)
export const TOP_STOCKS: Stock[] = [
  { symbol: "AAPL", name: "Apple Inc.", marketCap: 2940, sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corporation", marketCap: 2860, sector: "Technology" },
  { symbol: "GOOGL", name: "Alphabet Inc. Class A", marketCap: 1760, sector: "Technology" },
  { symbol: "AMZN", name: "Amazon.com Inc.", marketCap: 1740, sector: "Consumer Cyclical" },
  { symbol: "NVDA", name: "NVIDIA Corporation", marketCap: 1680, sector: "Technology" },
  { symbol: "META", name: "Meta Platforms Inc.", marketCap: 1160, sector: "Technology" },
  { symbol: "BRK.B", name: "Berkshire Hathaway Inc. Class B", marketCap: 860, sector: "Financial Services" },
  { symbol: "LLY", name: "Eli Lilly and Company", marketCap: 740, sector: "Healthcare" },
  { symbol: "TSLA", name: "Tesla Inc.", marketCap: 720, sector: "Automotive" },
  { symbol: "V", name: "Visa Inc.", marketCap: 540, sector: "Financial Services" },
  { symbol: "UNH", name: "UnitedHealth Group Inc.", marketCap: 520, sector: "Healthcare" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", marketCap: 510, sector: "Financial Services" },
  { symbol: "XOM", name: "Exxon Mobil Corporation", marketCap: 480, sector: "Energy" },
  { symbol: "MA", name: "Mastercard Inc.", marketCap: 460, sector: "Financial Services" },
  { symbol: "JNJ", name: "Johnson & Johnson", marketCap: 450, sector: "Healthcare" },
  { symbol: "PG", name: "Procter & Gamble Company", marketCap: 440, sector: "Consumer Defensive" },
  { symbol: "AVGO", name: "Broadcom Inc.", marketCap: 430, sector: "Technology" },
  { symbol: "HD", name: "Home Depot Inc.", marketCap: 420, sector: "Consumer Cyclical" },
  { symbol: "MRK", name: "Merck & Co. Inc.", marketCap: 410, sector: "Healthcare" },
  { symbol: "CVX", name: "Chevron Corporation", marketCap: 400, sector: "Energy" }
  // ... Add more stocks up to 1000
];

// Create an index for faster symbol lookup
export const STOCK_INDEX = new Map<string, Stock>(
  TOP_STOCKS.map(stock => [stock.symbol, stock])
);

// Function to search stocks
export function searchStocks(query: string): Stock[] {
  query = query.toUpperCase().trim();
  
  // If query is empty, return first 10 stocks
  if (!query) {
    return TOP_STOCKS.slice(0, 10);
  }
  
  // Search by symbol and name
  const results = TOP_STOCKS.filter(stock => {
    const symbolMatch = stock.symbol.includes(query);
    const nameMatch = stock.name.toUpperCase().includes(query);
    return symbolMatch || nameMatch;
  });
  
  // Sort results: exact symbol matches first, then symbol starts with,
  // then name matches, limit to 10 results
  return results
    .sort((a, b) => {
      // Exact symbol match gets highest priority
      if (a.symbol === query) return -1;
      if (b.symbol === query) return 1;
      
      // Symbol starts with query gets second priority
      const aStartsWith = a.symbol.startsWith(query);
      const bStartsWith = b.symbol.startsWith(query);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;
      
      // Then sort by market cap
      return b.marketCap - a.marketCap;
    })
    .slice(0, 10);
} 