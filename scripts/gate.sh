#!/usr/bin/env bash
set -euo pipefail

echo "1/2 [GATE] Verificando tipos e contratos estáticos + compilação (tsc)..."
npx tsc

echo "2/2 [GATE] Executando invariantes de domínio (gate.test.js)..."
node dist/gate.test.js
