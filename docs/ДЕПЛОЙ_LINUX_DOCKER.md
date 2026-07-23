# Деплой «Расписание РиМ» на Linux (YouGile в Docker)

Инструкция для сервера, где YouGile уже крутится в Docker.  
На Linux нет Google Drive for Desktop — файл `.xlsx` подключают через **rclone mount**, затем пробрасывают в контейнер.

```
Google Drive (.xlsx)
       ↕  rclone mount
 /mnt/gdrive-rim   (на Linux-хосте)
       ↕  Docker volume
 /opt/yougile/user-data/drive   (внутри контейнера)
       ↕
 расширение agile-sched (бот)
```

Файл на Drive должен оставаться **обычным Excel (.xlsx)**.  
Не конвертируйте его в «Google Таблицы».

---

## Требования

- Linux-сервер с Docker и запущенным YouGile (контейнер обычно называется `yougile`)
- Доступ SSH к серверу
- Аккаунт Google, где лежит «Расписашка РиМ»
- Копия репозитория AgileSched (или хотя бы папка `extensions/agile-sched`)
- Токен Telegram-бота от [@BotFather](https://t.me/botfather) (если используете Telegram; для YouGile-чата токен тоже обычно нужен в `config.json`)

Имя контейнера проверьте так:

```bash
docker ps --format '{{.Names}}' | grep -i yougile
```

Ниже везде подставляйте своё имя, если оно не `yougile`.

---

## 1. Установить rclone на хост

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version
```

FUSE (для mount):

```bash
sudo apt update
sudo apt install -y fuse3
```

В `/etc/fuse.conf` должна быть строка (раскомментируйте при необходимости):

```text
user_allow_other
```

---

## 2. Привязать Google Drive к rclone

```bash
rclone config
```

Кратко по шагам:

1. `n` — New remote  
2. Имя: `gdrive`  
3. Storage: `drive` (Google Drive)  
4. Client ID / Secret — пока можно Enter (пусто). Позже лучше сделать [свой client_id](https://rclone.org/drive/#making-your-own-client-id) (shared id rclone отключат в 2026).  
5. Scope: обычно полный доступ к Drive  
6. Остальное — Enter по умолчанию  
7. Авторизация: на сервере без GUI выберите **не** auto-config → откройте выданную ссылку **на своём компьютере** → скопируйте код в SSH  

Проверка:

```bash
rclone about gdrive:
rclone lsd gdrive:
```

Должны появиться папки «Мой диск».

Найти расписашку:

```bash
rclone ls gdrive: --include "*Расписаш*" --max-depth 6
rclone ls gdrive: --include "*.xlsx" --max-depth 4
```

Если файл только в «Доступные мне»:

```bash
rclone ls gdrive: --drive-shared-with-me --include "*Расписаш*" --max-depth 5
```

Запомните путь к **папке**, где лежит файл.  
Пример: файл `работа/РиМ/Расписашка РиМ (1).xlsx` → папка `работа/РиМ`.

---

## 3. Смонтировать папку Drive на хост

```bash
sudo mkdir -p /mnt/gdrive-rim

# подставьте СВОЙ путь к папке на Drive:
rclone mount "gdrive:работа/РиМ" /mnt/gdrive-rim \
  --daemon \
  --vfs-cache-mode full \
  --dir-cache-time 10s \
  --poll-interval 15s \
  --allow-other \
  --umask 002

ls -la /mnt/gdrive-rim/
```

Должен быть виден `.xlsx`.

Проверка записи (необязательно):

```bash
touch /mnt/gdrive-rim/_rclone_test.txt
# через ~1 мин файл должен появиться на Drive в браузере
rm /mnt/gdrive-rim/_rclone_test.txt
```

### Автозапуск mount после перезагрузки (systemd)

Создайте `/etc/systemd/system/rclone-gdrive-rim.service` (путь Drive замените на свой):

```ini
[Unit]
Description=Rclone mount Google Drive for AgileSched
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/rclone mount gdrive:работа/РиМ /mnt/gdrive-rim \
  --vfs-cache-mode full \
  --dir-cache-time 10s \
  --poll-interval 15s \
  --allow-other \
  --umask 002
ExecStop=/bin/fusermount3 -uz /mnt/gdrive-rim
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rclone-gdrive-rim
sudo systemctl status rclone-gdrive-rim
```

Конфиг rclone обычно лежит в `~/.config/rclone/rclone.conf`.  
Если сервис запускается от root, скопируйте конфиг в `/root/.config/rclone/` или укажите в unit:

```ini
Environment=RCLONE_CONFIG=/home/ВАШ_USER/.config/rclone/rclone.conf
User=ВАШ_USER
```

(для mount от обычного пользователя иногда удобнее `User=` + права на `/mnt/gdrive-rim`).

---

## 4. Пробросить папку в Docker YouGile

В `docker-compose.yml` сервиса YouGile добавьте volume:

```yaml
services:
  yougile:   # имя сервиса может отличаться
    volumes:
      # ... ваши существующие volumes ...
      - "/mnt/gdrive-rim:/opt/yougile/user-data/drive"
```

Важно: контейнер нужно **пересоздать**, не только `restart`:

```bash
cd /путь/к/compose/yougile
docker compose up -d
```

Проверка из контейнера:

```bash
docker exec yougile ls -la /opt/yougile/user-data/drive/
```

Тот же `.xlsx`, что на хосте.

Smoke-тест записи из контейнера:

```bash
docker exec yougile sh -c 'echo ok > /opt/yougile/user-data/drive/_from_docker.txt'
# файл должен появиться на Google Drive
docker exec yougile rm -f /opt/yougile/user-data/drive/_from_docker.txt
```

---

## 5. Установить / обновить расширение agile-sched

На машине, где есть код репозитория (или скопируйте папку на сервер):

```bash
# имя контейнера при необходимости: YOUGILE_CONTAINER=yougile
docker cp extensions/agile-sched yougile:/opt/yougile/extensions/

docker exec yougile sh -c \
  'cd /opt/yougile/extensions/agile-sched && npm install --omit=dev'
```

Или скриптом из корня репо (если репозиторий на сервере):

```bash
chmod +x scripts/deploy-yougile-docker.sh
./scripts/deploy-yougile-docker.sh
```

Скрипт копирует расширение, делает `npm install`, проверяет `excelPath` и перезапускает контейнер.

---

## 6. Настроить config.json

На хосте в `extensions/agile-sched/`:

```bash
cp config.example.json config.json
nano config.json
```

Пример:

```json
{
  "telegramToken": "123456:ABC...",
  "excelPath": "/opt/yougile/user-data/drive/Расписашка РиМ (1).xlsx"
}
```

- `excelPath` — путь **внутри контейнера**, не путь Linux `/mnt/...`  
- Имя файла должно совпадать с `ls` внутри контейнера  

Залить конфиг:

```bash
docker cp extensions/agile-sched/config.json \
  yougile:/opt/yougile/extensions/agile-sched/config.json

docker restart yougile
```

Проверка:

```bash
docker exec yougile node -e "
  const c = require('/opt/yougile/extensions/agile-sched/config.json');
  const fs = require('fs');
  console.log(c.excelPath);
  console.log('exists:', fs.existsSync(c.excelPath));
  if (fs.existsSync(c.excelPath)) console.log('size:', fs.statSync(c.excelPath).size);
"
```

Ожидается `exists: true`.

---

## 7. Включить расширение в YouGile

1. Откройте YouGile в браузере.  
2. **Моя компания → Настройки компании → Расширения**.  
3. Включите (или выкл/вкл) **«Расписание РиМ»**, подождите ~15 секунд.  

Логи:

```bash
docker logs yougile --tail 80
```

Ожидайте упоминание расширения / бота и отсутствие ошибок про путь к Excel.

---

## 8. Проверка работы

1. Откройте любую задачу → чат справа.  
2. Напишите `/start`.  
3. Привяжите профиль (пункт меню «Привязать профиль» / `/my`).  
4. Заполните тестовые часы (`/schedule`).  
5. Подождите 15–60 секунд.  
6. На Google Drive откройте файл как **.xlsx** (скачать / Excel), не «Открыть в Google Таблицах».  
7. Убедитесь, что ячейки обновились.  

Команды меню:

| Пункт / команда | Действие |
|-----------------|----------|
| 1 / `/schedule` | Заполнить |
| 2 / `/my` | Профиль |
| 3 / `/myschedule` | Моё расписание |
| 4 / `/status` | Статус |
| `/cancel` | Отмена |

---

## Обновление кода расширения

```bash
# из корня AgileSched на сервере или после git pull
docker cp extensions/agile-sched yougile:/opt/yougile/extensions/
docker exec yougile sh -c \
  'cd /opt/yougile/extensions/agile-sched && npm install --omit=dev'
docker restart yougile
# в UI: выкл/вкл расширение
```

`config.json` с токеном не коммитьте в git.

---

## Частые проблемы

| Симптом | Что проверить |
|--------|----------------|
| `rclone lsd` пустой / нет расписашки | Другой Google-аккаунт; файл в «Доступные мне»; путь глубже — ищите через `rclone ls` |
| NOTICE про shared client_id | Пока работает; сделайте свой client_id по [доке rclone](https://rclone.org/drive/#making-your-own-client-id) |
| Mount пустой после ребута | systemd-сервис rclone не запущен |
| В контейнере `ls` пустой | Volume не добавлен или контейнер не пересоздавали после compose |
| `exists: false` | Неверное имя файла в `excelPath` |
| Бот «сохранил», на Drive старое | Подождать синк; `--vfs-cache-mode full`; не открывать как Google Таблицы |
| Ошибка записи / lock | Файл открыт в Excel на чьём-то ПК |
| После `docker restart` пропал диск | Сначала поднимите rclone mount, потом YouGile |

Порядок после ребута сервера:

1. `systemctl start rclone-gdrive-rim` (или enable уже включён)  
2. `docker compose up -d` / автостарт Docker  

---

## Краткий чеклист

- [ ] `rclone about gdrive:` ок  
- [ ] Найден путь к папке с `.xlsx`  
- [ ] `/mnt/gdrive-rim` показывает файл  
- [ ] Volume в compose: `/mnt/gdrive-rim:/opt/yougile/user-data/drive`  
- [ ] `docker exec yougile ls .../drive/` видит файл  
- [ ] `config.json` с правильным `excelPath` внутри контейнера  
- [ ] Расширение скопировано, `npm install`, restart  
- [ ] Расширение включено в UI  
- [ ] Тестовая запись через `/schedule` видна в `.xlsx` на Drive  

---

## Связанные файлы в репозитории

- [`extensions/agile-sched/`](../extensions/agile-sched/) — расширение  
- [`extensions/agile-sched/config.example.json`](../extensions/agile-sched/config.example.json) — образец конфига  
- [`scripts/deploy-yougile-docker.sh`](../scripts/deploy-yougile-docker.sh) — быстрый деплой в контейнер  
- [`docs/Руководство_пользователя_Расписание_РиМ.docx`](Руководство_пользователя_Расписание_РиМ.docx) — инструкция для сотрудников  
