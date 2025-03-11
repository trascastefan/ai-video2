#!/bin/bash

echo "Shutting down services..."

# Function to check if a port is in use
check_port() {
    lsof -i ":$1" &>/dev/null
}

# Function to kill process using a specific port
kill_port_process() {
    local port=$1
    if check_port "$port"; then
        echo "Killing process on port $port..."
        lsof -ti ":$port" | xargs kill -9 2>/dev/null
    fi
}

# Kill Next.js server (both by process name and port)
echo "Stopping Next.js server..."
pkill -f "node.*next" 2>/dev/null
kill_port_process 3000

# Clean up any lingering node processes related to our app
ps aux | grep "[n]ode.*dev" | awk '{print $2}' | xargs kill -9 2>/dev/null

# Kill Ollama process only if we want to shut it down completely
read -p "Do you want to stop the Ollama service too? (y/n): " stop_ollama
if [[ "$stop_ollama" == "y" || "$stop_ollama" == "Y" ]]; then
    echo "Stopping Ollama service..."
    pkill -f "ollama serve" 2>/dev/null
    kill_port_process 11434
    echo "Ollama service stopped."
else
    echo "Ollama service left running."
fi

# Wait a moment to ensure ports are freed
sleep 2

# Verify all services are stopped
if check_port 3000; then
    echo "Warning: Port 3000 is still in use. You may need to manually kill the process."
else
    echo "Next.js server stopped successfully."
fi

if [[ "$stop_ollama" == "y" || "$stop_ollama" == "Y" ]]; then
    if check_port 11434; then
        echo "Warning: Port 11434 is still in use. You may need to manually kill the process."
    else
        echo "Ollama service stopped successfully."
    fi
fi

echo "Shutdown complete." 