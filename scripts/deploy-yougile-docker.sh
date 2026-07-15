#!/usr/bin/env bash
# Деплой расширения agile-sched в контейнер YouGile (Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${YOUGILE_CONTAINER:-yougile}"
EXT_SRC="$ROOT/extensions/agile-sched"
EXT_DST="/opt/yougile/extensions/agile-sched"

echo "→ Копируем расширение в $CONTAINER:$EXT_DST"
docker cp "$EXT_SRC" "$CONTAINER:/opt/yougile/extensions/"

echo "→ npm install в контейнере"
docker exec "$CONTAINER" sh -c "cd $EXT_DST && npm install --omit=dev"

echo "→ Проверка Excel в контейнере"
docker exec "$CONTAINER" node -e "
  const cfg = require('$EXT_DST/config.json');
  const fs = require('fs');
  if (fs.existsSync(cfg.excelPath)) {
    console.log('OK:', cfg.excelPath);
    console.log(fs.statSync(cfg.excelPath).size, 'bytes');
  } else {
    console.error('ОШИБКА: файл не найден:', cfg.excelPath);
    process.exit(1);
  }
"

echo "→ Перезапуск контейнера"
docker restart "$CONTAINER"

echo "Готово. В YouGile: Моя компания → Расширения → выкл/вкл «Расписание РиМ»."
echo "Проверка логов: docker logs $CONTAINER --tail 30"
