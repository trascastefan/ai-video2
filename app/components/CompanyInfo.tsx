import React from 'react';

interface CompanyInfoProps {
  symbol: string;
  companyData?: {
    name: string;
    description: string;
    marketCap: number;
    volume: number;
    sector: string;
    industry: string;
  };
  isLoading: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toString();
}

export default function CompanyInfo({ symbol, companyData, isLoading }: CompanyInfoProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="h-24 bg-gray-200 rounded mb-4"></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-12 bg-gray-200 rounded"></div>
          <div className="h-12 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!companyData) {
    return (
      <div className="text-gray-500 text-center py-8">
        {symbol ? 'No company information available' : 'Select a company to view details'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">{companyData.name}</h2>
        <p className="text-gray-600">{companyData.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm text-gray-500 mb-1">Market Cap</div>
          <div className="text-xl font-semibold">${formatNumber(companyData.marketCap)}</div>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm text-gray-500 mb-1">Volume</div>
          <div className="text-xl font-semibold">{formatNumber(companyData.volume)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-sm text-gray-500 mb-1">Sector</div>
          <div className="font-medium">{companyData.sector}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500 mb-1">Industry</div>
          <div className="font-medium">{companyData.industry}</div>
        </div>
      </div>
    </div>
  );
} 