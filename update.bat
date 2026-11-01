@echo off
setlocal enabledelayedexpansion

title DEEN Delivery Parser - 1-Click Extension Updater
echo ===================================================================
echo   DEEN Delivery Parser - 1-Click Extension Updater
echo   Repository: Sajid-ul-Islam/chrome-extension-delivery-parser
echo ===================================================================
echo.

cd /d "%~dp0"

echo [*] Checking update method...

:: 1. Check if git repository is present
if exist ".git" (
    where git >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Git repository detected. Pulling latest updates from GitHub...
        git fetch origin main
        git reset --hard origin/main
        if %errorlevel% equ 0 (
            echo.
            echo [SUCCESS] Extension updated successfully via Git to the latest commit!
            goto :finish
        ) else (
            echo [WARNING] Git pull encountered an error. Falling back to ZIP download...
        )
    )
)

:: 2. Fallback: Download latest ZIP archive directly from GitHub
echo [*] Downloading latest code ZIP directly from GitHub...
set "ZIP_URL=https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser/archive/refs/heads/main.zip"
set "TEMP_ZIP=%TEMP%\deen_parser_update_%RANDOM%.zip"
set "EXTRACT_DIR=%TEMP%\deen_parser_extract_%RANDOM%"

powershell -NoProfile -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TEMP_ZIP%'"

if not exist "%TEMP_ZIP%" (
    echo [ERROR] Failed to download update from GitHub.
    echo Please check your internet connection and try again.
    goto :error
)

echo [*] Extracting update files...
powershell -NoProfile -Command ^
    "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%EXTRACT_DIR%' -Force"

set "SOURCE_DIR=%EXTRACT_DIR%\chrome-extension-delivery-parser-main"
if not exist "%SOURCE_DIR%" (
    echo [ERROR] Failed to extract archive structure.
    goto :error
)

echo [*] Applying updated extension files...
:: Copy updated files preserving local .env file
for %%F in ("%SOURCE_DIR%\*") do (
    if /i not "%%~nxF"==".env" (
        copy /y "%%F" ".\" >nul 2>&1
    )
)
if exist "%SOURCE_DIR%\icons" (
    if not exist "icons" mkdir icons
    xcopy /s /e /y "%SOURCE_DIR%\icons\*" "icons\" >nul 2>&1
)

:: Cleanup temporary files
del /f /q "%TEMP_ZIP%" >nul 2>&1
rmdir /s /q "%EXTRACT_DIR%" >nul 2>&1

echo.
echo [SUCCESS] Extension files updated to latest version!

:finish
echo.
echo ===================================================================
echo   NEXT STEP:
echo   1. In Chrome, open the DEEN Delivery Parser extension popup.
echo   2. Click "Reload App" or visit chrome://extensions and click reload.
echo   All new features and fixes are now active!
echo ===================================================================
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] Update failed. You can download the latest ZIP manually from:
echo https://github.com/Sajid-ul-Islam/chrome-extension-delivery-parser
echo.
pause
exit /b 1
