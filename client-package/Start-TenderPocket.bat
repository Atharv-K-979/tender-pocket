@echo off
cd /d "%~dp0"

:: ===================================================
:: TenderPocket Self-Updating Desktop Launcher (Windows)
:: ===================================================

:loop
if exist TenderPocket-update.jar (
    echo ===================================================
    echo Applying new TenderPocket application update...
    echo ===================================================
    move /y TenderPocket-update.jar TenderPocket.jar
    echo Update successfully applied!
    echo.
)

echo ===================================================
echo Starting TenderPocket Desktop Application (Windows)...
echo ===================================================

:: Automatically free port 8080 if an old background instance was left running
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do taskkill /f /pid %%a 2>nul

start http://localhost:8080
java -jar TenderPocket.jar

if exist .restart_trigger (
    del /f /q .restart_trigger
    echo Restarting application for update...
    timeout /t 2 >nul
    goto loop
)
