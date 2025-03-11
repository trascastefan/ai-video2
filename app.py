from flask import Flask, render_template, request, jsonify, session, send_from_directory
from stock_script_generator import StockScriptGenerator, StockDataError
import os
import json
from datetime import datetime
import io
import sys
from contextlib import redirect_stdout
from dotenv import load_dotenv
from flask_cors import CORS

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config['TEMPLATES_AUTO_RELOAD'] = True
CORS(app)

class LogCapture:
    def __init__(self):
        self.log_buffer = io.StringIO()
        self.start_time = datetime.now()

    def __enter__(self):
        sys.stdout = self.log_buffer
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        sys.stdout = sys.__stdout__

    def get_logs(self):
        logs = []
        content = self.log_buffer.getvalue()
        if content:
            for line in content.split('\n'):
                if line.strip():
                    elapsed = (datetime.now() - self.start_time).total_seconds()
                    timestamp = datetime.now().strftime("%I:%M:%S %p")
                    logs.append({
                        'timestamp': timestamp,
                        'elapsed': f"+{elapsed:.2f}s",
                        'message': line.strip(),
                        'type': 'error' if '✗' in line else 'success' if '✓' in line else 'info'
                    })
        return logs

@app.route('/')
def index():
    return render_template('index.html', logs=[])

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/search-stocks')
def search_stocks():
    query = request.args.get('q', '').lower()
    if not query:
        return jsonify([])
    
    results = []
    with open('static/stocks.json', 'r') as f:
        STOCKS_DATA = json.load(f)
    for symbol, name in STOCKS_DATA.items():
        if query in symbol.lower() or query in name.lower():
            results.append({
                'symbol': symbol,
                'name': name,
                'display': f"{symbol} - {name}"
            })
    
    # Sort results: exact matches first, then by length
    results.sort(key=lambda x: (
        not x['symbol'].lower().startswith(query),
        not x['name'].lower().startswith(query),
        len(x['symbol'])
    ))
    
    return jsonify(results[:10])  # Limit to top 10 results

@app.route('/generate', methods=['POST'])
def generate():
    """Generate a script for a stock symbol."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'Invalid request: no JSON data provided'
            }), 400

        symbol = data.get('symbol', '').strip().upper()
        period = data.get('period', '1mo')
        
        if not symbol:
            return jsonify({
                'success': False,
                'error': 'Symbol is required'
            }), 400

        valid_periods = ['1mo', '3mo', '6mo', '1y']
        if period not in valid_periods:
            return jsonify({
                'success': False,
                'error': f'Invalid period. Must be one of: {", ".join(valid_periods)}'
            }), 400
            
        # Create log capture
        log_capture = LogCapture()
        
        try:
            # Generate script
            generator = StockScriptGenerator()
            script = generator.generate_script(symbol, period)
            
            # Get the latest generation from the database
            from database import get_generations_for_symbol
            latest = get_generations_for_symbol(symbol, limit=1)
            
            prompt = ""
            impact_table = ""
            
            if latest:
                latest_gen = latest[0]
                prompt = latest_gen['prompt']
                
                # Extract the impact table from the prompt
                # The table starts with "| Date |" and ends with a double newline
                table_start = prompt.find("| Date |")
                if table_start != -1:
                    table_end = prompt.find("\n\n", table_start)
                    if table_end == -1:  # If no double newline, go to end of string
                        table_end = len(prompt)
                    impact_table = prompt[table_start:table_end].strip()
            
            return jsonify({
                'success': True,
                'script': script,
                'prompt': prompt,
                'impact_table': impact_table,
                'logs': log_capture.get_logs()
            })
            
        except StockDataError as e:
            error_msg = str(e)
            if 'Missing required columns' in error_msg:
                error_msg = 'Unable to retrieve complete stock data. Please try again.'
            elif 'Invalid numeric data' in error_msg:
                error_msg = 'Invalid stock data received. Please try again.'
            elif 'Invalid current price' in error_msg:
                error_msg = 'Invalid stock price data. Please verify the symbol and try again.'
            
            return jsonify({
                'success': False,
                'error': error_msg,
                'logs': log_capture.get_logs()
            })
            
        except Exception as e:
            error_msg = str(e)
            if 'rate limit' in error_msg.lower():
                error_msg = 'API rate limit exceeded. Please wait a moment and try again.'
            elif 'timeout' in error_msg.lower():
                error_msg = 'Request timed out. Please try again.'
            
            return jsonify({
                'success': False,
                'error': error_msg,
                'logs': log_capture.get_logs()
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Internal server error. Please try again.'
        }), 500

@app.route('/api/history/<symbol>', methods=['GET'])
def get_script_history(symbol):
    """Get the script generation history for a symbol."""
    try:
        limit = request.args.get('limit', default=10, type=int)
        generations = get_generations_for_symbol(symbol.upper(), limit)
        
        history = []
        for gen in generations:
            # Parse the ISO format timestamp to datetime for formatting
            timestamp = datetime.fromisoformat(gen['timestamp'])
            formatted_time = timestamp.strftime('%Y-%m-%d %I:%M %p')
            
            history.append({
                'id': gen['id'],
                'symbol': gen['symbol'],
                'period': gen['period'],
                'prompt': gen['prompt'],
                'script': gen['script'],
                'timestamp': formatted_time
            })
        
        return jsonify({
            'success': True,
            'history': history
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    os.makedirs('scripts', exist_ok=True)
    app.run(debug=True, port=5044)
