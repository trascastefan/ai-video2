"""Test Finnhub API connection."""
import os
from dotenv import load_dotenv, find_dotenv
import logging
import requests

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def main():
    """Test Finnhub API connection."""
    # Load environment variables
    dotenv_path = find_dotenv()
    logger.debug(f"Loading .env from: {dotenv_path}")
    load_dotenv(dotenv_path)
    
    # Get API key
    api_key = os.getenv('FINNHUB_API_KEY')
    if not api_key:
        logger.error("FINNHUB_API_KEY not found in environment variables")
        return
    
    # Check for any whitespace or special characters
    api_key = api_key.strip()
    logger.debug(f"API key length: {len(api_key)}")
    logger.debug(f"API key: {api_key}")  # Log full key for debugging
    
    # Make direct HTTP request
    try:
        logger.debug("Making direct HTTP request...")
        headers = {'X-Finnhub-Token': api_key}
        url = 'https://finnhub.io/api/v1/quote'
        params = {'symbol': 'AAPL'}
        
        logger.debug(f"Request URL: {url}")
        logger.debug(f"Headers: {headers}")
        logger.debug(f"Params: {params}")
        
        response = requests.get(url, headers=headers, params=params)
        logger.debug(f"Response status: {response.status_code}")
        logger.debug(f"Response headers: {dict(response.headers)}")
        logger.debug(f"Response body: {response.text}")
        
        if response.ok:
            data = response.json()
            if 'c' in data:
                logger.info("✓ Finnhub API connection successful!")
                logger.info(f"AAPL current price: ${data['c']}")
            else:
                logger.error("✗ Invalid response format from Finnhub API")
        else:
            logger.error(f"✗ HTTP Error: {response.status_code}")
            
    except Exception as e:
        logger.error(f"✗ Error: {str(e)}")

if __name__ == '__main__':
    main()
