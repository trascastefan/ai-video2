#!/bin/bash

# Set working directory to the script's location
cd "$(dirname "$0")"

echo "Starting Stock Analysis app..."

# Function to check if a port is in use
check_port() {
    lsof -i ":$1" &>/dev/null
}

# Function to kill process using a specific port
kill_port_process() {
    local port=$1
    if check_port "$port"; then
        echo "Killing existing process on port $port..."
        lsof -ti ":$port" | xargs kill -9 2>/dev/null
        sleep 2  # Wait for port to be freed
    fi
}

# Clean up any existing processes
echo "Checking for existing processes..."
kill_port_process 3000  # Next.js port

# Source the user's shell configuration to get the correct PATH
if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc"
elif [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
elif [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

# Add common Node.js installation paths to PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

# Check for Node.js
NODE_PATHS=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "/usr/bin/node"
    "$HOME/.nvm/versions/node/*/bin/node"
)

NODE_CMD=""
for path in "${NODE_PATHS[@]}"; do
    if [ -x "$path" ]; then
        NODE_CMD="$path"
        echo "Found Node.js at $path"
        NODE_DIR=$(dirname "$path")
        export PATH="$NODE_DIR:$PATH"
        break
    fi
done

if [ -z "$NODE_CMD" ]; then
    if command -v node &> /dev/null; then
        NODE_CMD="node"
    else
        echo "Node.js not found. Please install Node.js first."
        open "https://nodejs.org/"
        exit 1
    fi
fi

# Check for npm in common locations
NPM_PATHS=(
    "/opt/homebrew/bin/npm"
    "/usr/local/bin/npm"
    "/usr/bin/npm"
    "$HOME/.nvm/versions/node/*/bin/npm"
)

NPM_CMD=""
for path in "${NPM_PATHS[@]}"; do
    if [ -x "$path" ]; then
        NPM_CMD="$path"
        echo "Found npm at $path"
        break
    fi
done

if [ -z "$NPM_CMD" ]; then
    if command -v npm &> /dev/null; then
        NPM_CMD="npm"
    else
        echo "npm not found. Please install Node.js and npm first."
        open "https://nodejs.org/"
        exit 1
    fi
fi

# Check for Ollama in common locations
OLLAMA_PATHS=(
  "/usr/local/bin/ollama"
  "/opt/homebrew/bin/ollama"
  "/usr/bin/ollama"
  "$HOME/.ollama/bin/ollama"
  "$HOME/bin/ollama"
)

OLLAMA_FOUND=false

# First check if it's in PATH
if command -v ollama &> /dev/null; then
    OLLAMA_FOUND=true
    OLLAMA_CMD="ollama"
else
    # Check common installation locations
    for path in "${OLLAMA_PATHS[@]}"; do
        if [ -x "$path" ]; then
            OLLAMA_FOUND=true
            OLLAMA_CMD="$path"
            echo "Found Ollama at $path"
            break
        fi
    done
fi

if [ "$OLLAMA_FOUND" = false ]; then
    echo "Ollama is not installed or could not be found. Please install it first."
    open "https://ollama.com/download"
    exit 1
fi

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/version &> /dev/null; then
    echo "Starting Ollama service..."
    # Start Ollama in the background
    "$OLLAMA_CMD" serve &> ollama.log &
    
    # Wait for Ollama to start up (with timeout)
    MAX_RETRIES=10
    COUNT=0
    while ! curl -s http://localhost:11434/api/version &> /dev/null; do
        sleep 1
        COUNT=$((COUNT+1))
        if [ $COUNT -ge $MAX_RETRIES ]; then
            echo "Failed to start Ollama service. Please check ollama.log for details."
            exit 1
        fi
    done
    echo "Ollama service started successfully."
fi

# Check if Mistral model is installed
if ! "$OLLAMA_CMD" list | grep -q "mistral"; then
    echo "Pulling Mistral model..."
    "$OLLAMA_CMD" pull mistral
fi

# Start the Next.js server
echo "Starting Next.js development server..."
echo "Using Node.js from: $("$NODE_CMD" --version)"
echo "Using npm from: $("$NPM_CMD" --version)"

cd "$(dirname "$0")"  # Ensure we're in the right directory
"$NPM_CMD" run dev &> nextjs.log &

# Wait a moment for the server to start (with feedback)
echo "Waiting for Next.js server to start..."
for i in {1..20}; do  # Increased timeout to 20 seconds
    if curl -s http://localhost:3000 &> /dev/null; then
        echo "Next.js server started successfully!"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# Check if server actually started
if ! curl -s http://localhost:3000 &> /dev/null; then
    echo "Failed to start Next.js server. Checking logs..."
    cat nextjs.log
    exit 1
fi

# Open browser
echo "Opening browser..."
open "http://localhost:3000"

echo "Startup complete! The application is now running."
echo "To stop all services, run ./shutdown.sh" 