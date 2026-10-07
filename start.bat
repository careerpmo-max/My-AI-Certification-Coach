@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js ^>= 22 requis : https://nodejs.org & exit /b 1)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" || (echo Node.js ^>= 22 requis : https://nodejs.org & exit /b 1)
node src\server\index.js --open
