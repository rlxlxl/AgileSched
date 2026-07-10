require('yougile-ui')

const EXTENSION_NAME = 'Расписание РиМ'

function statusText(botStatus) {
  if (!botStatus) return 'Статус неизвестен'
  if (botStatus.running) {
    return `Бот запущен (${botStatus.startedAt || 'сейчас'})`
  }
  if (botStatus.error) {
    return `Бот остановлен: ${botStatus.error}`
  }
  return 'Бот остановлен'
}

async function openSettingsPanel() {
  const settings = await Service.getSettings()

  const excelPath = window.prompt(
    'Абсолютный путь к Excel-файлу на сервере',
    settings.excelPath || ''
  )
  if (!excelPath) {
    Notifier.error('Путь к Excel обязателен')
    return
  }

  const token = window.prompt(
    'Токен Telegram-бота от @BotFather (оставьте пустым, чтобы не менять)',
    ''
  )

  const payload = { excelPath }
  if (token) {
    payload.telegramToken = token
  } else if (settings.telegramToken && settings.telegramToken !== '***') {
    payload.telegramToken = settings.telegramToken
  }

  const result = await Service.saveSettings(payload)
  Notifier.success(
    `${EXTENSION_NAME}: настройки сохранены. ${statusText(result.botStatus)}`
  )
}

async function showStatus() {
  const settings = await Service.getSettings()
  const status = await Service.getBotStatus()
  window.alert(
    [
      EXTENSION_NAME,
      `Excel: ${settings.excelPath || 'не задан'}`,
      statusText(status || settings.botStatus)
    ].join('\n')
  )
}

async function restartBot() {
  const result = await Service.restartBot()
  Notifier.info(statusText(result))
}

window.AgileSched = {
  openSettings: openSettingsPanel,
  showStatus,
  restartBot
}

Notifier.success(
  `${EXTENSION_NAME}: расширение загружено. Настройка: AgileSched.openSettings()`
)
