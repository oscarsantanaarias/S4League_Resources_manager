@echo off
title S4League Resources ^& Mods Manager
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    echo Download it from https://nodejs.org  install it and run this again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo ============================================
    echo   First run - installing dependencies
    echo   This can take a couple of minutes.
    echo ============================================
    echo.
    call npm install --omit=optional
    if %errorlevel% neq 0 (
        echo.
        echo npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
    echo.
)

npm start
