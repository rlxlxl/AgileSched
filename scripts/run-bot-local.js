#!/usr/bin/env node
/**
 * Локальный запуск Telegram-бота без YouGile.
 *
 * 1. Создайте бота у @BotFather и скопируйте токен
 * 2. Установите зависимости: cd extensions/agile-sched && npm install
 * 3. Запустите:
 *
 *    export BOT_TOKEN="123456:ABC..."
 *    node scripts/run-bot-local.js
 *
 * По умолчанию бот пишет в копию файла: local-bot-schedule.xlsx
 * (оригинал «Расписашка РиМ (1).xlsx» не трогается).
 *
 * Опционально:
 *    export EXCEL_PATH="/полный/путь/к/файлу.xlsx"
 *    export USE_ORIGINAL=1   # писать прямо в оригинал (осторожно)
 */

const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const extensionRoot = path.join(projectRoot, 'extensions/agile-sched')
const sourceExcel = path.join(projectRoot, 'Расписашка РиМ (1).xlsx')
const defaultWorkExcel = path.join(projectRoot, 'local-bot-schedule.xlsx')
const profilesPath = path.join(projectRoot, 'local-bot-profiles.json')

const telegrafPath = path.join(extensionRoot, 'node_modules/telegraf')
if (!fs.existsSync(telegrafPath)) {
  console.error('Сначала установите зависимости:')
  console.error('  cd extensions/agile-sched && npm install')
  process.exit(1)
}

const { Telegraf } = require(telegrafPath)
const { registerBot } = require(path.join(extensionRoot, 'lib/bot/scenes'))
const { normalizeProfile } = require(path.join(extensionRoot, 'lib/profile'))
const { createReminderScheduler } = require(path.join(extensionRoot, 'lib/reminders'))
const { assertExcelAccessible } = require(path.join(extensionRoot, 'lib/excel-writer'))

function loadProfiles() {
  if (!fs.existsSync(profilesPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(profilesPath, 'utf8'))
  } catch {
    return {}
  }
}

function saveProfiles(profiles) {
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf8')
}

function resolveExcelPath() {
  if (process.env.EXCEL_PATH) {
    return path.resolve(process.env.EXCEL_PATH)
  }

  if (process.env.USE_ORIGINAL === '1') {
    return sourceExcel
  }

  if (!fs.existsSync(defaultWorkExcel)) {
    if (!fs.existsSync(sourceExcel)) {
      console.error('Не найден исходный Excel:', sourceExcel)
      process.exit(1)
    }
    fs.copyFileSync(sourceExcel, defaultWorkExcel)
    console.log('Создана рабочая копия:', defaultWorkExcel)
  }

  return defaultWorkExcel
}

async function main() {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN
  if (!token) {
    console.error('Укажите токен бота:')
    console.error('  export BOT_TOKEN="токен_от_BotFather"')
    console.error('  node scripts/run-bot-local.js')
    process.exit(1)
  }

  const excelPath = resolveExcelPath()
  if (!fs.existsSync(excelPath)) {
    console.error('Excel-файл не найден:', excelPath)
    process.exit(1)
  }

  const profiles = loadProfiles()

  async function getUserProfile(userId) {
    return normalizeProfile(profiles[String(userId)] || null)
  }

  async function saveUserProfile(userId, profile) {
    profiles[String(userId)] = normalizeProfile(profile)
    saveProfiles(profiles)
  }

  async function getProfileForEmployee(employeeName) {
    for (const key of Object.keys(profiles)) {
      const profile = normalizeProfile(profiles[key])
      if (profile && profile.employee === employeeName) return profile
    }
    return null
  }

  async function getRateForEmployee(employeeName) {
    const profile = await getProfileForEmployee(employeeName)
    return profile ? profile.rate : 1
  }

  async function listUserProfiles() {
    return Object.keys(profiles).map(function (userId) {
      return { userId: userId, profile: normalizeProfile(profiles[userId]) }
    })
  }

  const bot = new Telegraf(token)
  registerBot(bot, {
    getConfig: async () => ({
      telegramToken: token,
      excelPath
    }),
    getUserProfile,
    saveUserProfile,
    getProfileForEmployee,
    getRateForEmployee,
    fileExists: (filePath) => Boolean(filePath && fs.existsSync(filePath)),
    assertExcelAccessible
  })

  bot.catch((error, ctx) => {
    console.error('[local-bot] error:', error)
    if (ctx) {
      ctx.reply('Ошибка. Попробуйте /cancel и начните снова.').catch(() => {})
    }
  })

  const scheduler = createReminderScheduler({
    getConfig: async () => ({ excelPath }),
    listUserProfiles,
    saveUserProfile,
    sendTelegram: async (userId, text) => {
      await bot.telegram.sendMessage(userId, text)
    }
  })

  process.once('SIGINT', () => {
    scheduler.stop()
    bot.stop('SIGINT')
  })
  process.once('SIGTERM', () => {
    scheduler.stop()
    bot.stop('SIGTERM')
  })

  await bot.launch()
  scheduler.start()
  console.log('Бот запущен локально (без YouGile).')
  console.log('Excel:', excelPath)
  console.log('Профили:', profilesPath)
  console.log('Напоминания: Europe/Moscow')
  console.log('В Telegram напишите боту /start')
}

main().catch((error) => {
  console.error('Не удалось запустить бота:', error.message || error)
  process.exit(1)
})
