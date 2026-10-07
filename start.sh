#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js >= 22 requis : https://nodejs.org"; exit 1; }
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" || { echo "Node.js >= 22 requis (version actuelle : $(node -v)) : https://nodejs.org"; exit 1; }
exec node src/server/index.js --open
