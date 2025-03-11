'use client'
import { useState } from 'react'
import { debounce } from 'lodash'

interface Company {
  symbol: string
  description: string
}

export default function StockSearch() {
  const [search, setSearch] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [timeframe, setTimeframe] = useState('1D')

  const searchCompanies = async (query: string) => {
    if (!query) return
    setLoading(true)
    try {
      const response = await fetch(`/api/search?query=${query}`)
      const data = await response.json()
      setCompanies(data)
    } catch (error) {
      console.error('Error searching companies:', error)
    }
    setLoading(false)
  }

  const debouncedSearch = debounce(searchCompanies, 300)

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <input
          type="text"
          placeholder="Search for a company..."
          className="w-full p-2 border rounded"
          onChange={(e) => {
            setSearch(e.target.value)
            debouncedSearch(e.target.value)
          }}
          value={search}
        />
        
        {loading && <div>Loading...</div>}
        
        <div className="space-y-2">
          {companies.map((company) => (
            <div
              key={company.symbol}
              className="p-2 border rounded cursor-pointer hover:bg-gray-50"
              onClick={() => setSelectedCompany(company)}
            >
              <div className="font-semibold">{company.symbol}</div>
              <div className="text-sm text-gray-600">{company.description}</div>
            </div>
          ))}
        </div>
      </div>

      {selectedCompany && (
        <div className="space-y-4">
          <div className="flex space-x-2">
            {['1D', '1W', '1M', '3M', '1Y', 'ALL'].map((tf) => (
              <button
                key={tf}
                className={`px-3 py-1 rounded ${
                  timeframe === tf ? 'bg-blue-600 text-white' : 'bg-gray-200'
                }`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
          
          <div className="border rounded p-4">
            <h2 className="text-xl font-semibold mb-4">
              {selectedCompany.description} ({selectedCompany.symbol})
            </h2>
            {/* Volume chart will go here */}
          </div>
        </div>
      )}
    </div>
  )
} 