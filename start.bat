@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules call npm.cmd install
node --env-file-if-exists=.env --no-warnings src/bot.js
pause
