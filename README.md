# AgileSched — Telegram-бот расписания для YouGile

Расширение для коробочной версии **YouGile Платформа**, которое заполняет Excel-файл «Расписашка РиМ» через Telegram-бота.

## Быстрый старт

1. Установите расширение из [`extensions/agile-sched/`](extensions/agile-sched/)
2. Следуйте инструкции в [`extensions/agile-sched/README.md`](extensions/agile-sched/README.md)

## Локальный запуск бота (без YouGile)

```bash
cd extensions/agile-sched && npm install
cd ../..

export BOT_TOKEN="токен_от_BotFather"
node scripts/run-bot-local.js
```

Бот пишет в копию `local-bot-schedule.xlsx` (оригинал не трогается). В Telegram: `/start`.

Опционально свой файл: `export EXCEL_PATH="/путь/к/файлу.xlsx"`

## Локальный тест парсера

```bash
cd extensions/agile-sched && npm install
cd ../..
node scripts/test-parser.js
```

## Файлы

- [`Расписашка РиМ (1).xlsx`](Расписашка%20РиМ%20(1).xlsx) — исходная таблица
- [`extensions/agile-sched/`](extensions/agile-sched/) — расширение YouGile
- [`scripts/run-bot-local.js`](scripts/run-bot-local.js) — локальный запуск бота
- [`scripts/test-parser.js`](scripts/test-parser.js) — тест парсера и записи
