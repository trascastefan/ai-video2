#!/bin/bash

# First, ensure we have an app to install
if [ ! -d "Stock Analysis.app" ]; then
    echo "Creating Stock Analysis app..."
    ./create_app.sh
fi

# Ask if user wants to install to Applications
read -p "Do you want to install Stock Analysis to your Applications folder? (y/n): " install_app

if [[ "$install_app" == "y" || "$install_app" == "Y" ]]; then
    # Get the absolute path of the project
    PROJECT_PATH=$(pwd)
    
    # Create a launcher app in Applications that points to our scripts
    APP_PATH="/Applications/Stock Analysis.app"
    
    # Remove previous installation if it exists
    if [ -d "$APP_PATH" ]; then
        echo "Removing previous installation..."
        rm -rf "$APP_PATH"
    fi
    
    # Copy the app to Applications
    echo "Installing to Applications folder..."
    cp -R "Stock Analysis.app" "$APP_PATH"
    
    # Update the launcher script to point to the correct location
    cat > "$APP_PATH/Contents/MacOS/AppLauncher" << EOF
#!/bin/bash
cd "$PROJECT_PATH"
./startup.sh
EOF
    
    # Make the launcher executable
    chmod +x "$APP_PATH/Contents/MacOS/AppLauncher"
    
    echo "Installation complete!"
    echo "You can now start Stock Analysis from your Applications folder."
else
    echo "Installation cancelled. You can still run the app from this folder."
fi 