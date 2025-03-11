# AI Stock Video Script Generator

## Overview
This application is a sophisticated system that automatically generates video scripts for stock market analysis. It combines real-time financial data with AI-powered natural language generation to create compelling, accurate, and timely stock market commentary.

## Core Components

### 1. Web Application (app.py)
- Built using Flask framework
- Provides RESTful API endpoints for:
  - Stock symbol search
  - Script generation
  - Script history retrieval
- Features CORS support for cross-origin requests
- Implements logging capture for real-time feedback
- Routes:
  - `/`: Main interface
  - `/search`: Stock symbol search endpoint
  - `/generate`: Script generation endpoint
  - `/script_history`: Historical scripts retrieval

### 2. Stock Script Generator (stock_script_generator.py)
- Core class: `StockScriptGenerator`
- Uses Ollama LLM (llama2:7b model) for text generation
- Integrates with Finnhub API for real-time stock data
- Features:
  - Retry mechanism for API calls
  - Error handling for stock data retrieval
  - Customizable temperature for text generation
  - Multiple time period support (monthly, long-term)

### 3. Prompt Management (prompts.py)
- `PromptLoader` class for template management
- Supports multiple prompt templates:
  - Monthly analysis (`monthly_prompt.txt`)
  - Long-term analysis (`long_term_prompt.txt`)
- Dynamic prompt generation based on:
  - Company information
  - Stock symbol
  - Time period
  - Market analysis
  - Impact factors
  - Additional metrics

### 4. Database Management (database.py)
- SQLite database for script storage
- Schema:
  ```sql
  CREATE TABLE script_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      period TEXT NOT NULL,
      prompt TEXT NOT NULL,
      script TEXT NOT NULL,
      timestamp TEXT NOT NULL
  )
  ```
- Functions:
  - `init_db()`: Database initialization
  - `save_generation()`: Store new scripts
  - `get_generations_for_symbol()`: Retrieve historical scripts

## Data Flow

1. **User Input**
   - User enters a stock symbol
   - Application validates the symbol through Finnhub API

2. **Data Collection**
   - Fetches real-time stock data
   - Retrieves company information
   - Calculates technical indicators
   - Analyzes market trends

3. **Script Generation**
   - Selects appropriate prompt template
   - Populates template with collected data
   - Processes through Ollama LLM
   - Returns generated script

4. **Storage and Retrieval**
   - Saves generated script to database
   - Maintains history of generations
   - Provides access to previous versions

## Impact Table Logic

The impact table is a crucial component that summarizes stock performance data in a structured format. It's designed to provide a clear, tabular view of stock movements and their impacts.

### Table Structure
```
| Date | Close Price | Price Change | Change % | Volume | Impact |
|------|-------------|--------------|----------|---------|--------|
```

### Components

1. **Data Collection**
   - Date: Trading day
   - Close Price: Final price for the day
   - Price Change: Absolute price difference
   - Change %: Percentage change
   - Volume: Trading volume
   - Impact: Qualitative assessment of movement

### Generation Process

1. **Data Analysis**
   ```python
   def analyze_price_movement(self, df):
       analysis = []
       for index, row in df.iterrows():
           day_analysis = {
               'date': index.strftime('%Y-%m-%d'),
               'close_price': row['c'],
               'price_change': row['price_change'],
               'percent_change': row['percent_change'],
               'volume': row['v'],
               'day_high': row['h'],
               'day_low': row['l'],
               'range_percent': ((row['h'] - row['l']) / row['l']) * 100
           }
           analysis.append(day_analysis)
       return analysis
   ```

2. **Impact Assessment**
   - Strong Positive: Change % > 5%
   - Positive: 2% < Change % ≤ 5%
   - Neutral: -2% ≤ Change % ≤ 2%
   - Negative: -5% ≤ Change % < -2%
   - Strong Negative: Change % < -5%

3. **Movement Description**
   ```python
   def get_movement_description(self, price_change_pct):
       if abs(price_change_pct) < 2:
           return ('neutral', 'minimal movement')
       elif abs(price_change_pct) < 5:
           strength = 'moderate'
       else:
           strength = 'strong'
       
       direction = 'upward' if price_change_pct > 0 else 'downward'
       return (strength, f'{direction} movement')
   ```

### Usage in Script Generation

1. **Table Formation**
   - Raw data is processed through `format_impact_table()`
   - Each row represents one trading day
   - Data is sorted chronologically

2. **Integration with Prompts**
   - Table is included in script generation prompts
   - Used to provide context for market analysis
   - Helps in identifying trends and patterns

3. **Dynamic Updates**
   - Table updates with real-time data
   - Supports different time periods (monthly, long-term)
   - Automatically adjusts format based on data availability

### Example Output
```
| Date       | Close Price | Price Change | Change % | Volume    | Impact          |
|------------|-------------|--------------|----------|-----------|-----------------|
| 2025-02-21 | $150.25    | +$3.75      | +2.56%   | 1.2M     | Positive Move   |
| 2025-02-20 | $146.50    | -$0.50      | -0.34%   | 980K     | Neutral         |
| 2025-02-19 | $147.00    | +$5.00      | +3.52%   | 1.5M     | Positive Move   |
```

### Error Handling

1. **Data Validation**
   - Checks for missing values
   - Validates date continuity
   - Ensures numerical consistency

2. **Fallback Mechanisms**
   - Default values for missing data
   - Graceful degradation for partial data
   - Clear error messaging

3. **Quality Assurance**
   - Verification of calculations
   - Range checks for percentages
   - Volume data validation

## Environment Setup

Required environment variables:
- `FINNHUB_API_KEY`: API key for Finnhub service

Dependencies (requirements.txt):
- Flask
- langchain
- Ollama
- finnhub-python
- beautifulsoup4
- pandas
- python-dotenv
- flask-cors

## Implementation Guide

1. **Setup Environment**
   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure API Keys**
   - Create .env file
   - Add Finnhub API key

3. **Initialize Database**
   - Database automatically initializes on first run
   - Located at `./scripts.db`

4. **Start Application**
   ```bash
   python app.py
   ```
   - Runs on port 5042 by default
   - Debug mode enabled for development

## Error Handling

The application implements comprehensive error handling:
- Custom `StockDataError` for data retrieval issues
- Retry mechanism for API calls
- Logging system for debugging
- User-friendly error messages

## Extensibility

The system is designed for easy extension:
1. **New Time Periods**
   - Add new prompt template
   - Update PromptLoader.load_prompt_template()

2. **Additional Data Sources**
   - Extend StockScriptGenerator class
   - Add new API integrations

3. **Custom Prompt Templates**
   - Create new template files
   - Modify prompt generation logic

## Security Considerations

1. **API Key Protection**
   - Environment variable usage
   - No hardcoded credentials

2. **Database Security**
   - SQLite with proper file permissions
   - Input validation for SQL queries

3. **Web Security**
   - CORS configuration
   - Session management
   - Random secret key generation

## Performance Optimization

1. **Caching**
   - API response caching
   - Database query optimization

2. **Async Operations**
   - Non-blocking API calls
   - Background task processing

3. **Resource Management**
   - Connection pooling
   - Memory usage optimization
