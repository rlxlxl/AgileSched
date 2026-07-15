# Расписание РиМ — расширение YouGile Platform

Telegram-бот заполняет график в Excel «Расписашка РиМ». Файл лежит в **папке Google Drive на компьютере**; YouGile в Docker видит его через **volume**. Коллеги смотрят тот же `.xlsx` по ссылке Диска.

| Тип | Цвет | Значение |
|-----|------|----------|
| Полуочно (0,5ч) | `#41DD88` | `0.5` |
| Очно | `#00B050` | `1.0` |
| Дистанционно | `#FF6D01` | `1.0` |

## Требования

- YouGile Платформа (Docker или коробка) + модуль `yougile-platform-sdk`
- Telegram-бот (токен от [@BotFather](https://t.me/botfather))
- Файл `.xlsx` в Google Drive for Desktop (не «конвертировать в Google Таблицы»)

## Схема работы

```
YouGile UI / Telegram → расширение agile-sched → .xlsx в volume
                                      ↕
                           Google Drive Desktop (sync)
                                      ↕
                         ссылка Диска для команды
```

## UI в YouGile — чат задачи (как Telegram)

Панель на доске убрана. Работа **в чате любой задачи** — те же команды, что в Telegram:

1. Откройте задачу → чат справа
2. Напишите **`/start`**
3. Отвечайте **номерами** (1, 2, 3…) как в Telegram-боте

| Команда | Действие |
|---------|----------|
| `/start` | Меню |
| `/schedule` | Заполнить расписание |
| `/show` | Показать расписание |
| `/my` | Привязать профиль |
| `/myschedule` | Моё расписание |
| `/status` | Статус Excel и бота |
| `/cancel` | Отмена |

После сохранения файл на Google Drive обновится за 5–30 сек.

### Подзадачи и ответственный

Если в **чате подзадачи** назначен ответственный и у него уже есть профиль (`/my`), бот **автоматически** подставляет его расписание:

- при создании/смене ответственного — сообщение в чат подзадачи;
- при `/start` — строка «Профиль ответственного: …»;
- `/myschedule` и `/status` — данные ответственного, не автора сообщения;
- `/schedule` — пропуск выбора отдела/сотрудника, сразу выбор дней.

Если профиля у ответственного нет — бот попросит выполнить `/my`.

Telegram-бот работает параллельно с тем же Excel.

## Установка (Docker + Google Drive)

### 1. Скопировать расширение

```bash
docker cp extensions/agile-sched yougile:/opt/yougile/extensions/
docker exec yougile sh -c 'cd /opt/yougile/extensions/agile-sched && npm install'
```

Или смонтируйте репозиторий в `extensions/` при запуске контейнера.

### 2. Смонтировать папку/файл с Диска в контейнер

На Mac файл обычно лежит примерно так:

`/Users/ВАШ_USER/Library/CloudStorage/GoogleDrive-…/Мой диск/…/Расписашка РиМ.xlsx`

Добавьте volume при запуске YouGile (пример для `docker run` / compose):

```yaml
volumes:
  - "/Users/ВАШ_USER/Library/CloudStorage/GoogleDrive-XXX/My Drive/РиМ:/opt/yougile/user-data/drive"
```

Либо только файл:

```yaml
volumes:
  - "/полный/путь/на/Mac/к/Расписашка РиМ.xlsx:/opt/yougile/user-data/drive/Расписашка РиМ.xlsx"
```

Пересоздайте контейнер с новым volume (`docker compose up -d` или аналог).

### 3. Конфиг расширения

Скопируйте образец и заполните:

```bash
cp config.example.json config.json
```

[`config.json`](config.json) — для **Docker** (путь внутри контейнера):

```json
{
  "telegramToken": "123456:ABC...",
  "excelPath": "/opt/yougile/user-data/drive/Расписашка РиМ (1).xlsx"
}
```

Для **нативного YouGile без Docker** скопируйте [`config.native.example.json`](config.native.example.json) и укажите путь Google Drive на Mac/Linux.

`excelPath` в Docker — путь **внутри контейнера**, не macOS (volume монтирует «Мой диск» → `/opt/yougile/user-data/drive`).

Быстрый деплой из репозитория:

```bash
chmod +x scripts/deploy-yougile-docker.sh
./scripts/deploy-yougile-docker.sh
```

После правок вручную:

```bash
docker cp config.json yougile:/opt/yougile/extensions/agile-sched/config.json
docker restart yougile
```

Или: **Моя компания → Расширения** → выключить/включить «Расписание РиМ», подождать ~15 сек.

### 4. Включить расширение

**Моя компания → Настройки компании → Расширения** → «Расписание РиМ».

В логах ожидайте: `Telegram bot started` и путь к Excel.

Проверка файла в контейнере:

```bash
docker exec yougile ls -la "/opt/yougile/user-data/drive/"
```

## Использование (Telegram)

- `/start` — меню
- `/schedule` — заполнить (после сохранения — итог часов и проверка нормы)
- `/show` — показать неделю (с часами по дням)
- `/my` — привязать себя: отдел, сотрудник, **ставка** (1 или 0,5)
- `/myschedule` — своё расписание с итогом часов и предупреждением, если меньше нормы
- `/status` — Excel, профиль, ставка и норма (40 или 20 ч/нед)
- `/cancel` — отменить диалог

### Ставка и норма часов

| Ставка | Норма в неделю |
|--------|----------------|
| 1 (полная) | 40 ч |
| 0,5 (полставки) | 20 ч |

Часы считаются из ячеек Excel: `0.5` → 0,5 ч, `1` или `д` → 1 ч. Обед пока **не вычитается** (этап 2 по ТЗ).

После `/schedule` и в `/myschedule` бот показывает, например:

```
Итого: 12 ч из 40 ч
⚠ Не хватает 28 ч до нормы
```

После сохранения бот пишет, что файл на Диске обновлён; синхронизация обычно **5–30 секунд**.

## Как смотреть изменения команде

1. Расшарьте **файл `.xlsx`** на Google Drive (ссылка «для просмотра» / «редактор»).
2. Открывайте как **Excel / скачать**, **не** «Открыть в Google Таблицах».
3. В Google Таблицах стили (особенно оранжевый «дистанционно») часто ломаются — бот правит бинарный xlsx, Диск только синхронизирует файл.

## Важно

- Кнопки на доске YouGile: панель «Расписание РиМ» (мастер заполнения + настройки). Telegram — второй канал.
- Не держите файл открытым в Desktop Excel во время записи бота — возможна блокировка (бот делает несколько retry).
- Не редактируйте один и тот же диапазон одновременно вручную и через бота.
- Резервные копии: папка `backups/` рядом с Excel (внутри того же volume).
- Настройки также в `config.json` (имеет приоритет над старыми private data).

## Локальный тест без YouGile

```bash
cd extensions/agile-sched && npm install && cd ../..
export BOT_TOKEN="токен"
export EXCEL_PATH="/путь/к/копии.xlsx"
node scripts/run-bot-local.js
```

Парсер/запись:

```bash
node scripts/test-parser.js
```

## Структура

```
extensions/agile-sched/
├── manifest.json
├── config.example.json
├── config.json          # токен + путь (не коммитьте токен в публичный репо)
├── service.js
├── ui.js                # панель на доске + мастер
└── lib/
    ├── excel-writer.js  # доступ к файлу, retry при lock, hint про Drive
    ├── xlsx-patcher.js
    └── bot/
        ├── scenes.js           # Telegram
        ├── yougile-chat.js     # чат YouGile
        ├── yougile-ui-session.js  # сессии UI мастера
        └── task-context.js     # подзадачи / ответственный
    ├── hours-calculator.js   # часы, норма 40/20
    ├── profile.js            # ставка в профиле
```

## Поддержка

При смене шаблона Excel может понадобиться обновить `lib/excel-parser.js`.
