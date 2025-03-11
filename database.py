"""Database utilities for storing scripts and prompts."""
import sqlite3
from datetime import datetime
import os
import logging

logger = logging.getLogger(__name__)

# Database configuration
DATABASE_PATH = "./scripts.db"

def init_db():
    """Initialize the database, creating tables if they don't exist."""
    conn = sqlite3.connect(DATABASE_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS script_generations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                period TEXT NOT NULL,
                prompt TEXT NOT NULL,
                script TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()

def save_generation(symbol: str, period: str, prompt: str, script: str):
    """Save a script generation to the database."""
    conn = sqlite3.connect(DATABASE_PATH)
    try:
        cursor = conn.cursor()
        timestamp = datetime.utcnow().isoformat()
        cursor.execute("""
            INSERT INTO script_generations 
            (symbol, period, prompt, script, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (symbol, period, prompt, script, timestamp))
        conn.commit()
        logger.info(f"Saved script generation for {symbol} to database")
    finally:
        conn.close()

def get_generations_for_symbol(symbol: str, limit: int = 10):
    """Get the most recent script generations for a specific symbol."""
    conn = sqlite3.connect(DATABASE_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, symbol, period, prompt, script, timestamp
            FROM script_generations
            WHERE symbol = ?
            ORDER BY timestamp DESC
            LIMIT ?
        """, (symbol, limit))
        
        rows = cursor.fetchall()
        generations = []
        for row in rows:
            generations.append({
                'id': row[0],
                'symbol': row[1],
                'period': row[2],
                'prompt': row[3],
                'script': row[4],
                'timestamp': row[5]
            })
        return generations
    finally:
        conn.close()

# Initialize the database when the module is imported
init_db()
