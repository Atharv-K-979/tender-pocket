@echo off
cd /d "%~dp0"

:: ===================================================
:: TenderPocket Self-Updating Desktop Launcher (Windows)
:: ===================================================

:: Check if Java is installed and available in PATH
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ===================================================
    echo ❌ ERROR: Java 21 is not installed or not in PATH.
    echo Please download and install Java 21 from:
    echo https://adoptium.net/
    echo ===================================================
    echo.
    pause
    exit /b 1
)

:loop
if exist TenderPocket-update.jar (
    echo ===================================================
    echo 🔄 Applying new TenderPocket application update...
    echo ===================================================
    move /y TenderPocket-update.jar TenderPocket.jar
    echo ✅ Update successfully applied!
    echo.
)

echo ===================================================
echo Starting TenderPocket Desktop Application (Windows)...
echo ===================================================

:: Automatically free port 8080 if an old background instance was left running
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do taskkill /f /pid %%a 2>nul

:: Open browser after 3 seconds so Tomcat is ready
start "" cmd /c "timeout /t 3 >nul && start http://localhost:8080"

:: Run Java Spring Boot Server
java -jar TenderPocket.jar
if %errorlevel% neq 0 (
    echo.
    echo ❌ Application stopped with error code %errorlevel%.
    echo Please check application.properties or PostgreSQL database connection.
    pause
)

if exist .restart_trigger (
    del /f /q .restart_trigger
    echo 🔄 Restarting application for update...
    timeout /t 2 >nul
    goto loop
)
