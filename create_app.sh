#!/bin/bash

# Make the startup and shutdown scripts executable
chmod +x startup.sh
chmod +x shutdown.sh

# Create application directory structure
APP_NAME="Stock Analysis"
mkdir -p "${APP_NAME}.app/Contents/MacOS"
mkdir -p "${APP_NAME}.app/Contents/Resources"

# Create the Info.plist file
cat > "${APP_NAME}.app/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>AppLauncher</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>com.stockanalysis.app</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Stock Analysis</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
EOF

# Create the launcher script that will run our startup.sh
cat > "${APP_NAME}.app/Contents/MacOS/AppLauncher" << EOF
#!/bin/bash
cd "\$(dirname "\$0")"
cd ../../..  # Go back to the project directory
./startup.sh
EOF

# Copy our scripts into the app bundle
cp startup.sh "${APP_NAME}.app/"
cp shutdown.sh "${APP_NAME}.app/"

# Make the launcher executable
chmod +x "${APP_NAME}.app/Contents/MacOS/AppLauncher"

echo "Created ${APP_NAME}.app"
echo "You can now double-click this app to start your Stock Analysis application." 