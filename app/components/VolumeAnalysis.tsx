import React from 'react';
import ChartWithControls from './ChartWithControls';

export interface NewsItem {
  date: string;
  title: string;
  source: string;
  url: string;
  summary?: string;
}

export interface SignificantMove {
  date: string;
  volume: number;
  price: number;
  priceChange: number;
  percentageChange: number;
  previousClose: number;
  high: number;
  low: number;
  news: NewsItem[];
}

export interface TimeSeriesData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  percentageChange: number;
  direction: 'up' | 'down';
}

export interface VolumeAnalysisProps {
  symbol: string;
  timeSeriesData: TimeSeriesData[];
  significantMoves: SignificantMove[];
  isLoading: boolean;
  onGenerateScript: () => Promise<void>;
  isGenerating: boolean;
  generatedScript: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toString();
}

export default function VolumeAnalysis({ 
  symbol, 
  timeSeriesData, 
  significantMoves, 
  isLoading, 
  onGenerateScript, 
  isGenerating, 
  generatedScript 
}: VolumeAnalysisProps) {


  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-gray-200 h-24 rounded-lg"></div>
        ))}
      </div>
    );
  }

  if (!timeSeriesData?.length) {
    return (
      <div className="text-gray-500 text-center py-8">
        No volume analysis available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Volume Analysis</h2>
        <button
          onClick={onGenerateScript}
          disabled={isGenerating || !symbol}
          className={`px-4 py-2 rounded-lg transition-colors ${
            isGenerating || !symbol
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isGenerating ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </span>
          ) : (
            'Generate Script'
          )}
        </button>
      </div>

      {timeSeriesData.length > 0 && (
        <div className="space-y-4">
          <ChartWithControls
            timeSeriesData={timeSeriesData}
            significantMoves={significantMoves}
          />
        </div>
      )}

      {generatedScript && (
        <div className="bg-gray-50 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-medium">Generated Script</h3>
          <div className="prose max-w-none">
            {generatedScript.split('\n').map((line, index) => (
              <p key={index} className="my-2">{line}</p>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Volume</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price Range</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Close</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change %</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {significantMoves.map((move) => (
              <React.Fragment key={move.date}>
                <tr className="hover:bg-gray-50">
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {formatDate(move.date)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {typeof move.volume === 'number' ? formatNumber(move.volume) : 'N/A'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${typeof move.low === 'number' ? move.low.toFixed(2) : '0.00'} - ${typeof move.high === 'number' ? move.high.toFixed(2) : '0.00'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${typeof move.price === 'number' ? move.price.toFixed(2) : '0.00'}
                  </td>
                  <td className={`px-4 py-4 whitespace-nowrap text-sm ${
                    (move.percentageChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {(move.percentageChange || 0) >= 0 ? '+' : ''}{typeof move.percentageChange === 'number' ? move.percentageChange.toFixed(2) : '0.00'}%
                  </td>
                </tr>
                {move.news && move.news.length > 0 && (
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-4 py-4">
                      <div className="space-y-4">
                        {move.news && move.news.map((item, index) => (
                          <div key={index} className="text-sm">
                            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                              <span>{formatDate(item.date)}</span>
                              <span>•</span>
                              <span>{item.source}</span>
                            </div>
                            <a 
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-medium block mb-1"
                            >
                              {item.title}
                            </a>
                            {item.summary && (
                              <p className="text-gray-600 text-sm line-clamp-2">
                                {item.summary}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
} 