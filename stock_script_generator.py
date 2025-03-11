import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import argparse
import json
import time
from langchain.callbacks.manager import CallbackManager
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler
from langchain_community.llms import Ollama
import pandas as pd
import os
import json
from prompts import PromptLoader
import logging
from database import save_generation, get_generations_for_symbol
import finnhub
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class StockDataError(Exception):
    """Custom exception for stock data related errors"""
    pass

class StockScriptGenerator:
    def __init__(self, llm_provider=None):
        """Initialize the script generator."""
        self.llm = llm_provider or Ollama(
            model="mistral",
            callback_manager=CallbackManager([StreamingStdOutCallbackHandler()]),
            temperature=0.7
        )
        self.max_retries = 3
        self.retry_delay = 2  # seconds
        self.finnhub_token = os.getenv('FINNHUB_API_KEY')
        if not self.finnhub_token:
            raise ValueError("FINNHUB_API_KEY environment variable is not set")
        self.finnhub_token = self.finnhub_token.strip()  # Remove any whitespace
        self.finnhub_client = finnhub.Client(api_key=self.finnhub_token)

    def fetch_with_retry(self, func, max_retries=3, initial_wait=1):
        """Execute a function with retry logic and improved error handling."""
        last_error = None
        wait_time = initial_wait
        
        for attempt in range(max_retries):
            try:
                return func()
            except requests.exceptions.RequestException as e:
                print(f"Network error on attempt {attempt + 1}: {str(e)}")
                last_error = e
                if "429" in str(e):
                    print("Rate limit hit, waiting longer...")
                    wait_time = wait_time * 2
            except Exception as e:
                print(f"Error on attempt {attempt + 1}: {str(e)}")
                last_error = e
            
            if attempt < max_retries - 1:
                print(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
                wait_time = wait_time * 2
        
        raise last_error

    def get_stock_data(self, symbol, period='1mo'):
        """Get stock data for a symbol using Finnhub."""
        try:
            logger.info(f"[Step 1] Fetching stock data for {symbol}")
            
            # Get current quote
            quote = self.finnhub_client.quote(symbol)
            logger.info(f"[Step 2] Retrieved quote: {quote}")
            
            if not quote or 'c' not in quote:
                raise ValueError("Invalid quote response format")
            
            # Create a single-row DataFrame with the quote data
            current_time = pd.Timestamp.now()
            df = pd.DataFrame({
                'Open': [quote['o']],
                'High': [quote['h']],
                'Low': [quote['l']],
                'Close': [quote['c']],
                'PreviousClose': [quote['pc']],
                'Change': [quote['d']],
                'PercentChange': [quote['dp']]
            }, index=[current_time])
            
            logger.info(f"[Step 3] Successfully fetched quote data")
            return df
            
        except Exception as e:
            logger.error(f"[Step E] Error fetching stock data: {str(e)}")
            raise

    def get_company_name(self, symbol):
        """Get company name using Finnhub."""
        try:
            profile = self.finnhub_client.company_profile2(symbol=symbol)
            return profile.get('name', symbol)
        except:
            return symbol

    def get_news(self, symbol):
        """Get news using Finnhub."""
        try:
            logger.info(f"[Step 1] Starting news fetch for {symbol}")
            
            # Get news from the last 30 days
            end_date = datetime.now().strftime('%Y-%m-%d')
            start_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            logger.info(f"[Step 2] Fetching news from {start_date} to {end_date}")
            
            news_items = self.finnhub_client.company_news(symbol, _from=start_date, to=end_date)
            logger.info(f"[Step 3] Retrieved {len(news_items) if news_items else 0} news items")
            
            # Format news items with proper date handling
            formatted_news = []
            for idx, item in enumerate(news_items):
                try:
                    logger.info(f"[Step 4.{idx}] Processing news item: {json.dumps(item)}")
                    # Finnhub returns timestamp in Unix format
                    news_date = datetime.fromtimestamp(item['datetime'])
                    logger.info(f"[Step 4.{idx}.1] Converted timestamp {item['datetime']} to date {news_date}")
                    
                    formatted_item = {
                        'date': news_date,
                        'title': item.get('headline', ''),
                        'source': item.get('source', 'Finnhub'),
                        'url': item.get('url', ''),
                        'timestamp': item['datetime']
                    }
                    logger.info(f"[Step 4.{idx}.2] Formatted item: {json.dumps(formatted_item, default=str)}")
                    formatted_news.append(formatted_item)
                except (KeyError, ValueError) as e:
                    logger.error(f"[Step 4.{idx}.E] Error processing news item: {str(e)}, Item: {json.dumps(item)}")
                    continue
            
            logger.info(f"[Step 5] Successfully formatted {len(formatted_news)} news items")
            return formatted_news
        except Exception as e:
            logger.error(f"[Step E] Error in get_news: {str(e)}")
            return []

    def fetch_news_from_yfinance(self, symbol, period='1mo'):
        """Fetch news from Yahoo Finance with improved error handling."""
        try:
            print(f"\n=== Starting Yahoo Finance news fetch for {symbol} ===")
            stock = yf.Ticker(symbol)
            
            # Get news with specific parameters
            news_data = stock.news
            if not news_data:
                print(f"No Yahoo Finance news found for {symbol}")
                return []
            
            print(f"Found {len(news_data)} Yahoo Finance news items for {symbol}")
            
            # Process and format the news
            formatted_news = []
            # Convert period to days
            days_lookup = {
                '1mo': 30,
                '3mo': 90,
                '6mo': 180,
                '1y': 365
            }
            days = days_lookup.get(period, 30)
            cutoff_date = datetime.now() - timedelta(days=days)
            
            for item in news_data[:10]:
                try:
                    # Convert timestamp to datetime
                    news_date = datetime.fromtimestamp(item['providerPublishTime'])
                    
                    # Skip news older than the cutoff date
                    if news_date < cutoff_date:
                        continue
                    
                    # Extract publisher
                    publisher = item.get('publisher', 'Yahoo Finance')
                    
                    # Calculate relative time for relevance
                    time_diff = datetime.now() - news_date
                    
                    # Calculate a relevance score (higher is more relevant)
                    relevance_score = 0
                    if 'type' in item and item['type'] == 'STORY':
                        relevance_score += 1
                    if time_diff.days < 1:  # News from last 24 hours
                        relevance_score += 2
                    if item.get('sentiment', {}).get('score', 0) > 0:
                        relevance_score += 1
                    
                    formatted_news.append({
                        'date': news_date,
                        'title': item['title'],
                        'source': publisher,
                        'url': item.get('link', ''),
                        'timestamp': item['providerPublishTime'],
                        'relevance': relevance_score,
                        'sentiment': item.get('sentiment', {}).get('score', 0)
                    })
                except Exception as e:
                    print(f"Error processing Yahoo Finance news item: {str(e)}")
                    continue
            
            # Sort by relevance and timestamp
            formatted_news.sort(key=lambda x: (x['relevance'], x['timestamp']), reverse=True)
            print(f"Successfully processed {len(formatted_news)} Yahoo Finance news items")
            return formatted_news
            
        except Exception as e:
            print(f"Error fetching Yahoo Finance news: {str(e)}")
            print(f"Yahoo Finance response data: {news_data if 'news_data' in locals() else 'No data'}")
            return []

    def fetch_news_from_finnhub(self, symbol, period='1mo'):
        """Fetch news from Finnhub with improved error handling."""
        try:
            print(f"\n=== Starting Finnhub news fetch for {symbol} ===")
            # Finnhub API endpoint for company news
            url = "https://finnhub.io/api/v1/company-news"
            
            # Convert period to days
            days_lookup = {
                '1mo': 30,
                '3mo': 90,
                '6mo': 180,
                '1y': 365
            }
            days = days_lookup.get(period, 30)
            
            # Calculate date range based on period
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            
            params = {
                "symbol": symbol,
                "from": start_date.strftime("%Y-%m-%d"),
                "to": end_date.strftime("%Y-%m-%d"),
                "token": os.getenv('FINNHUB_API_KEY')
            }
            
            print(f"Finnhub request params: {params}")
            
            def get_news():
                headers = {
                    "X-Finnhub-Token": os.getenv('FINNHUB_API_KEY'),
                    "Accept": "application/json"
                }
                response = requests.get(url, params=params, headers=headers, timeout=10)
                response.raise_for_status()
                return response.json()
            
            news_data = self.fetch_with_retry(get_news)
            
            if not news_data:
                print(f"No Finnhub news found for {symbol}")
                return []
            
            print(f"Found {len(news_data)} Finnhub news items for {symbol}")
            
            # Process and format the news
            formatted_news = []
            for item in news_data[:10]:
                try:
                    news_date = datetime.fromtimestamp(item['datetime'])
                    
                    # Calculate a relevance score
                    relevance_score = 0
                    if item.get('category', '') == 'company news':
                        relevance_score += 1
                    if datetime.now() - news_date < timedelta(days=1):
                        relevance_score += 2
                    if 'related' in item and symbol.upper() in item['related'].split(','):
                        relevance_score += 1
                    
                    formatted_news.append({
                        'date': news_date,
                        'title': item['headline'].strip(),
                        'source': 'Finnhub',
                        'url': item.get('url', ''),
                        'timestamp': item['datetime'],
                        'relevance': relevance_score,
                        'category': item.get('category', ''),
                        'related': item.get('related', '')
                    })
                except Exception as e:
                    print(f"Error processing Finnhub news item: {str(e)}")
                    continue
            
            # Sort by relevance and timestamp
            formatted_news.sort(key=lambda x: (x['relevance'], x['timestamp']), reverse=True)
            print(f"Successfully processed {len(formatted_news)} Finnhub news items")
            return formatted_news
            
        except requests.exceptions.RequestException as e:
            print(f"Network error while fetching Finnhub news: {str(e)}")
            if "429" in str(e):
                print("Finnhub rate limit exceeded")
            return []
        except Exception as e:
            print(f"Error fetching Finnhub news: {str(e)}")
            print(f"Finnhub response data: {news_data if 'news_data' in locals() else 'No data'}")
            return []

    def fetch_news_from_alpha_vantage(self, symbol):
        """Fetch news from Alpha Vantage."""
        try:
            print(f"\n=== Starting Alpha Vantage news fetch for {symbol} ===")
            url = "https://www.alphavantage.co/query"
            params = {
                "function": "NEWS_SENTIMENT",
                "tickers": symbol,
                "apikey": "demo",
                "limit": 10
            }
            
            def get_news():
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                return response.json()
            
            data = self.fetch_with_retry(get_news)
            
            if "feed" not in data or not data["feed"]:
                return []
            
            formatted_news = []
            for item in data["feed"]:
                time_published = datetime.strptime(item["time_published"], "%Y%m%dT%H%M%S")
                formatted_news.append({
                    'date': time_published,
                    'title': item['title'],
                    'source': 'Alpha Vantage',
                    'url': item.get('url', ''),
                    'timestamp': int(time_published.timestamp())
                })
            
            return formatted_news
        except Exception as e:
            print(f"Error fetching Alpha Vantage news: {str(e)}")
            return []

    def fetch_news_from_marketwatch(self, symbol):
        """Fetch news by scraping MarketWatch."""
        try:
            print(f"\n=== Starting MarketWatch news fetch for {symbol} ===")
            url = f"https://www.marketwatch.com/investing/stock/{symbol.lower()}"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
            }
            
            def get_news():
                response = requests.get(url, headers=headers, timeout=10)
                response.raise_for_status()
                return response.text
            
            html_content = self.fetch_with_retry(get_news)
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Find news articles in the MarketWatch layout
            news_items = soup.find_all('div', class_='article__content')
            if not news_items:
                return []
            
            formatted_news = []
            for item in news_items[:10]:
                title_elem = item.find('a', class_='link')
                time_elem = item.find('span', class_='article__timestamp')
                
                if title_elem and time_elem:
                    title = title_elem.text.strip()
                    # Convert relative time to datetime
                    now = datetime.now()
                    if 'min' in time_elem.text:
                        minutes = int(time_elem.text.split()[0])
                        date = now - timedelta(minutes=minutes)
                    elif 'hour' in time_elem.text:
                        hours = int(time_elem.text.split()[0])
                        date = now - timedelta(hours=hours)
                    else:
                        date = now
                    
                    formatted_news.append({
                        'date': date,
                        'title': title,
                        'source': 'MarketWatch',
                        'url': title_elem.get('href', ''),
                        'timestamp': int(date.timestamp())
                    })
            
            return formatted_news
        except Exception as e:
            print(f"Error fetching MarketWatch news: {str(e)}")
            return []

    def fetch_news_from_reuters(self, symbol):
        """Fetch news by scraping Reuters."""
        try:
            print(f"\n=== Starting Reuters news fetch for {symbol} ===")
            url = f"https://www.reuters.com/companies/{symbol.upper()}.O"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
            }
            
            def get_news():
                response = requests.get(url, headers=headers, timeout=10)
                response.raise_for_status()
                return response.text
            
            html_content = self.fetch_with_retry(get_news)
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Find news articles in the Reuters layout
            news_items = soup.find_all('div', {'data-testid': 'MediaStoryCard'})
            if not news_items:
                return []
            
            formatted_news = []
            for item in news_items[:10]:
                title_elem = item.find('a', {'data-testid': 'Heading'})
                time_elem = item.find('time')
                
                if title_elem and time_elem:
                    title = title_elem.text.strip()
                    date = datetime.fromisoformat(time_elem['datetime'].replace('Z', '+00:00'))
                    
                    formatted_news.append({
                        'date': date,
                        'title': title,
                        'source': 'Reuters',
                        'url': 'https://www.reuters.com' + title_elem.get('href', ''),
                        'timestamp': int(date.timestamp())
                    })
            
            return formatted_news
        except Exception as e:
            print(f"Error fetching Reuters news: {str(e)}")
            return []

    def fetch_news(self, symbol, period='1mo'):
        """Fetch and aggregate news from multiple sources with improved error handling."""
        try:
            print(f"\nStarting news aggregation for {symbol}...")
            # Try API sources first
            all_news = []
            
            # Fetch from Yahoo Finance
            yahoo_news = self.fetch_news_from_yfinance(symbol, period)
            print(f"Yahoo Finance returned {len(yahoo_news)} news items")
            all_news.extend(yahoo_news)
            
            # Fetch from Finnhub
            finnhub_news = self.fetch_news_from_finnhub(symbol, period)
            print(f"Finnhub returned {len(finnhub_news)} news items")
            all_news.extend(finnhub_news)
            
            if not all_news:
                print("No news found from any source, trying web scraping fallback...")
                all_news.extend(self.fetch_news_from_marketwatch(symbol))
                all_news.extend(self.fetch_news_from_reuters(symbol))
            
            if not all_news:
                print(f"No news available for {symbol} from any source")
                return [f"No recent news available for {symbol}"]
            
            print(f"Total news items before deduplication: {len(all_news)}")
            
            # Deduplicate news
            unique_news = self.deduplicate_news(all_news)
            print(f"Unique news items after deduplication: {len(unique_news)}")
            
            # Sort by timestamp (most recent first)
            sorted_news = sorted(unique_news, key=lambda x: x['timestamp'], reverse=True)
            
            # Get top 7 news items
            top_news = sorted_news[:7]
            print(f"Selected top {len(top_news)} news items")
            
            # Format news for display with source attribution
            formatted_news = []
            for item in top_news:
                date_str = item['date'].strftime("%Y-%m-%d")
                formatted_news.append(f"[{date_str}] ({item['source']}) {item['title']}")
            
            print("News aggregation completed successfully")
            return formatted_news
            
        except Exception as e:
            print(f"Error in news aggregation: {str(e)}")
            return [f"Unable to fetch recent news for {symbol}: {str(e)}"]

    def deduplicate_news(self, all_news):
        """Deduplicate news based on title similarity."""
        from difflib import SequenceMatcher
        
        def similar(a, b, threshold=0.85):
            return SequenceMatcher(None, a.lower(), b.lower()).ratio() > threshold
        
        unique_news = []
        seen_titles = set()
        
        for news in all_news:
            is_duplicate = False
            for seen_title in seen_titles:
                if similar(news['title'], seen_title):
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                seen_titles.add(news['title'])
                unique_news.append(news)
        
        return unique_news

    def clean_news_content(self, content):
        """Clean the news content by removing irrelevant text."""
        # Remove "(Finnhub)" and any extra whitespace
        content = content.replace("(Finnhub)", "").strip()
        
        # Remove any duplicate spaces
        content = " ".join(content.split())
        
        return content

    def analyze_price_movement(self, df):
        """Analyze the price movement from the stock data."""
        try:
            # Validate DataFrame
            if df is None or df.empty:
                raise ValueError("No data to analyze")
                
            required_columns = ['Close', 'PreviousClose', 'Change', 'PercentChange', 'High', 'Low']
            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                raise ValueError(f"Missing required columns: {', '.join(missing_columns)}")

            # Get the latest data point
            latest_data = df.iloc[-1]
            
            try:
                current_price = float(latest_data['Close'])
                prev_close = float(latest_data['PreviousClose'])
                price_change = float(latest_data['Change'])
                percent_change = float(latest_data['PercentChange'])
                day_high = float(latest_data['High'])
                day_low = float(latest_data['Low'])
            except (ValueError, TypeError) as e:
                raise ValueError(f"Invalid numeric data in DataFrame: {str(e)}")
            
            # Validate values
            if current_price <= 0:
                raise ValueError("Invalid current price: must be greater than 0")
            if day_high < day_low:
                raise ValueError("Invalid price range: high price is less than low price")
            
            # Determine price movement with more granular strength levels
            if percent_change > 0:
                movement = "up"
                if percent_change > 5:
                    strength = "very strongly"
                elif percent_change > 2:
                    strength = "strongly"
                elif percent_change > 1:
                    strength = "moderately"
                else:
                    strength = "slightly"
            elif percent_change < 0:
                movement = "down"
                if percent_change < -5:
                    strength = "very strongly"
                elif percent_change < -2:
                    strength = "strongly"
                elif percent_change < -1:
                    strength = "moderately"
                else:
                    strength = "slightly"
            else:
                movement = "unchanged"
                strength = ""
            
            # Calculate trading range with validation
            day_range = day_high - day_low
            if current_price > 0:
                range_percent = (day_range / current_price) * 100
            else:
                range_percent = 0
                logger.warning("Could not calculate range percentage: current price is 0")
            
            # Get the current date
            current_date = pd.Timestamp.now().strftime('%Y-%m-%d')
            
            return {
                'date': current_date,
                'current_price': round(current_price, 2),
                'previous_close': round(prev_close, 2),
                'price_change': round(price_change, 2),
                'percent_change': round(percent_change, 2),
                'movement': movement,
                'strength': strength,
                'day_high': round(day_high, 2),
                'day_low': round(day_low, 2),
                'day_range': round(day_range, 2),
                'range_percent': round(range_percent, 2),
                'description': f"Stock moved {strength} {movement}"
            }
            
        except Exception as e:
            logger.error(f"Error analyzing price movement: {str(e)}")
            raise StockDataError(f"Failed to analyze price movement: {str(e)}")

    def format_impact_table(self, analysis):
        """Format the analysis results into a table."""
        try:
            if not analysis:
                return ""
                
            # Create table header
            table = "| Date | Close Price | Price Change | Change % | Day Range | Impact |\n"
            table += "|------|-------------|--------------|----------|-----------|--------|\n"
            
            # Format the single row with current data
            date = analysis['date']
            close = f"${analysis['current_price']:.2f}"
            change = f"${analysis['price_change']:.2f}"
            pct = f"{analysis['percent_change']:.2f}%"
            day_range = f"${analysis['day_low']:.2f} - ${analysis['day_high']:.2f}"
            description = analysis['description']
            
            # Add the row
            table += f"| {date} | {close} | {change} | {pct} | {day_range} | {description} |\n"
            
            return table
            
        except Exception as e:
            logger.error(f"Error formatting impact table: {str(e)}")
            return "Error: Unable to format impact table"

    def get_movement_description(self, price_change_pct):
        """Get a description of the price movement."""
        if price_change_pct > 5:
            return "Strong bullish movement"
        elif price_change_pct > 2:
            return "Moderate bullish movement"
        elif price_change_pct > 0:
            return "Slight bullish movement"
        elif price_change_pct > -2:
            return "Slight bearish movement"
        elif price_change_pct > -5:
            return "Moderate bearish movement"
        else:
            return "Strong bearish movement"

    def generate_script(self, symbol, period='1mo'):
        """Generate a script for the given stock symbol and period."""
        try:
            logger.info(f"[Generate Step 1] Starting script generation for {symbol} ({period})")
            
            # Get stock data
            logger.info("[Generate Step 2] Fetching stock data")
            stock_data = self.get_stock_data(symbol, period)
            logger.info(f"[Generate Step 2.1] Stock data shape: {stock_data.shape}")
            
            # Get news data
            logger.info("[Generate Step 3] Fetching news data")
            all_news = self.get_news(symbol)
            logger.info(f"[Generate Step 3.1] Retrieved {len(all_news)} news items")
            if all_news:
                logger.info(f"[Generate Step 3.2] Sample news item: {json.dumps(all_news[0], default=str)}")
            
            # Analyze price movement
            logger.info("[Generate Step 4] Analyzing price movement")
            analysis = self.analyze_price_movement(stock_data)
            logger.info(f"[Generate Step 4.1] Analysis results: {json.dumps(analysis)}")
            
            # Format impact table
            impact_table = self.format_impact_table([analysis])
            logger.info("[Generate Step 5] Formatted impact table")
            
            # Create the prompt
            prompt = PromptLoader.create_prompt(
                company_name=self.get_company_name(symbol),
                symbol=symbol,
                period=period,
                analysis=[analysis],
                impact_table=impact_table
            )
            logger.info("[Generate Step 6] Created prompt")
            
            # Generate the script using the LLM
            script = self.llm.invoke(prompt)
            logger.info("[Generate Step 7] Script generated successfully")
            
            # Save to database
            from database import save_generation
            save_generation(symbol, period, prompt, script)
            
            return script
            
        except Exception as e:
            logger.error(f"[Generate Step E] Error generating script: {str(e)}")
            raise

    def find_relevant_news_for_dates(self, all_news, dates, days_before=3):
        """Find news items relevant to specific dates, including prior days."""
        relevant_news = []
        
        for target_date in dates:
            target_date = datetime.strptime(target_date, "%Y-%m-%d")
            earliest_date = target_date - timedelta(days=days_before)
            
            # Find news items in the date range
            for news in all_news:
                news_date = datetime.strptime(news.split(']')[0][1:], "%Y-%m-%d")
                if earliest_date <= news_date <= target_date:
                    if news not in relevant_news:  # Avoid duplicates
                        relevant_news.append(news)
        
        return relevant_news

    def calculate_additional_metrics(self, stock_data):
        """Calculate additional metrics for long-term analysis."""
        prices = stock_data['prices']
        
        # Calculate average daily volume
        avg_daily_volume = sum(prices['volume']) / len(prices['volume'])
        
        # Calculate average daily range
        daily_ranges = []
        for i in range(len(prices['high'])):
            daily_range = prices['high'][i] - prices['low'][i]
            daily_ranges.append(daily_range)
        avg_daily_range = sum(daily_ranges) / len(daily_ranges)
        
        # Count high volume days
        high_volume_days = sum(1 for vol in prices['volume'] if vol > avg_daily_volume)
        
        return {
            'avg_daily_volume': int(avg_daily_volume),
            'avg_daily_range': round(avg_daily_range, 2),
            'high_volume_days': high_volume_days
        }

def main():
    parser = argparse.ArgumentParser(description='Generate stock analysis video scripts')
    parser.add_argument('--symbol', required=True, help='Stock symbol (e.g., AAPL)')
    parser.add_argument('--period', default='1mo', help='Period to analyze (1mo, 3mo, 6mo, 1y)')
    args = parser.parse_args()

    # Load environment variables
    load_dotenv()

    generator = StockScriptGenerator()
    try:
        script = generator.generate_script(args.symbol, args.period)
    except StockDataError as e:
        print(f"Error: {str(e)}")
        return
    
    # Save the script to a file
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"scripts/{args.symbol}_{timestamp}.txt"
    
    with open(filename, 'w') as f:
        f.write(script)
    
    print(f"\nScript generated and saved to {filename}")

if __name__ == "__main__":
    main()
