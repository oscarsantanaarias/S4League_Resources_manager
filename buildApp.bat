@echo off
title Build - S4League Resources Manager
cd /d "%~dp0"

echo ============================================
echo   Building the portable .exe
echo ============================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    echo Get it from https://nodejs.org  install it and run this again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies first ^(one time^)...
    call npm install --omit=optional
    if %errorlevel% neq 0 (
        echo npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
)

echo.
echo Packaging... this takes a couple of minutes.
echo.

rem  portable = single self-contained .exe
rem  signAndEditExecutable=false skips winCodeSign so it works without admin / Developer Mode
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx --yes electron-builder -c.win.target=portable -c.win.signAndEditExecutable=false

rem  electron-builder can exit "with error" due to a harmless winCodeSign warning
rem  even when the .exe was produced, so check for the file instead of the exit code.
if not exist "dist\S4League Resources & Mods Manager 1.0.0.exe" (
    echo.
    echo Build failed - the single .exe was not produced. See the messages above.
    pause
    exit /b 1
)

echo.
echo Cleaning up so only the single portable .exe is left...
if exist "dist\win-unpacked" rmdir /s /q "dist\win-unpacked"
del /q "dist\*.nsis.7z" "dist\*.blockmap" "dist\*.yml" "dist\*.yaml" >nul 2>&1
if exist "dist\S4League Resources & Mods Manager.exe" del /q "dist\S4League Resources & Mods Manager.exe"
if exist "dist\S4League Resources & Mods Manager 1.0.0.exe" ren "dist\S4League Resources & Mods Manager 1.0.0.exe" "S4League Resources Manager.exe"

echo.
echo ============================================
echo   Done!
echo   Your portable app:  dist\S4League Resources Manager.exe
echo   Move that single .exe anywhere and just run it.
echo ============================================
echo.
pause
