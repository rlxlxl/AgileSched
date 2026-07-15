# AgileSched — Telegram-бот расписания для YouGile

Расширение для **YouGile Платформа**: заполняет Excel «Расписашка РиМ» через Telegram. Файл может лежать в **Google Drive** (локальный sync): в Docker монтируется папка Диска, бот пишет в `.xlsx`, команда смотрит по ссылке.

Подробная установка (volume, config, правила просмотра):  
[`extensions/agile-sched/README.md`](extensions/agile-sched/README.md)

## Быстрый старт

1. Установите расширение из [`extensions/agile-sched/`](extensions/agile-sched/)
2. Смонтируйте папку Google Drive в `/opt/yougile/user-data/drive`
3. Заполните `config.json` (токен + `excelPath` внутри контейнера)
4. Включите расширение в YouGile, в Telegram: `/start`

## Локальный запуск бота (без YouGile)

```bash
cd extensions/agile-sched && npm install
cd ../..

export BOT_TOKEN="токен_от_BotFather"
node scripts/run-bot-local.js
```

## Локальный тест парсера

```bash
node scripts/test-parser.js
```

## Файлы

- [`extensions/agile-sched/`](extensions/agile-sched/) — расширение YouGile
- [`scripts/run-bot-local.js`](scripts/run-bot-local.js) — локальный бот
- [`scripts/test-parser.js`](scripts/test-parser.js) — тест парсера и записи
