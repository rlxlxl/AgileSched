const { DAYS, DAY_SHORT, TIME_SLOTS } = require('./constants')

const DAY_ALIASES = {
  пн: 'Понедельник',
  понедельник: 'Понедельник',
  вт: 'Вторник',
  вторник: 'Вторник',
  ср: 'Среда',
  среда: 'Среда',
  чт: 'Четверг',
  четверг: 'Четверг',
  пт: 'Пятница',
  пятница: 'Пятница',
  сб: 'Суббота',
  суббота: 'Суббота'
}

function padTime(hour, minute) {
  return String(hour) + ':' + String(minute).padStart(2, '0')
}

function parseClock(token) {
  const m = String(token)
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = m[2] == null ? 0 : Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour: hour, minute: minute }
}

function findSlotContaining(slots, hour, minute, which) {
  const minutes = hour * 60 + minute
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const parts = String(slot).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
    if (!parts) continue
    const start = Number(parts[1]) * 60 + Number(parts[2])
    const end = Number(parts[3]) * 60 + Number(parts[4])
    if (which === 'start') {
      if (minutes >= start && minutes < end) return slot
      if (minutes === start) return slot
    } else {
      // end time: prefer slot that ends at this time, else last slot covering previous minute
      if (minutes === end) return slot
      if (minutes > start && minutes <= end) return slot
    }
  }
  return null
}

function mapRangeToSlots(startClock, endClock, availableSlots) {
  const slots = availableSlots && availableSlots.length ? availableSlots : TIME_SLOTS
  let startSlot = findSlotContaining(
    slots,
    startClock.hour,
    startClock.minute,
    'start'
  )
  let endSlot = findSlotContaining(slots, endClock.hour, endClock.minute, 'end')

  // If end is exactly on hour boundary like 18:00, last included slot is 17:00-18:00
  if (!endSlot && endClock.minute === 0) {
    endSlot = findSlotContaining(
      slots,
      endClock.hour - 1 >= 0 ? endClock.hour - 1 : 0,
      59,
      'end'
    )
    if (!endSlot) {
      const prev = padTime(endClock.hour - 1, 0) + '-' + padTime(endClock.hour, 0)
      if (slots.indexOf(prev) !== -1) endSlot = prev
    }
  }

  if (!startSlot || !endSlot) {
    return {
      ok: false,
      error:
        'Время вне слотов листа: ' +
        padTime(startClock.hour, startClock.minute) +
        '-' +
        padTime(endClock.hour, endClock.minute)
    }
  }

  const startIdx = slots.indexOf(startSlot)
  const endIdx = slots.indexOf(endSlot)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return {
      ok: false,
      error: 'Некорректный диапазон: ' + startSlot + ' — ' + endSlot
    }
  }

  return {
    ok: true,
    startTime: startSlot,
    endTime: endSlot,
    day: null
  }
}

function parseDayToken(token) {
  const key = String(token || '')
    .trim()
    .toLowerCase()
  return DAY_ALIASES[key] || null
}

/**
 * Parse free-form week schedule text.
 * Example: "Пн 9:00-18:00, Вт 10:00-19:00, Ср 9-18"
 *
 * @param {string} text
 * @param {string[]} [availableSlots]
 * @returns {{ ok: true, entries: Array } | { ok: false, error: string }}
 */
function parseFreeformSchedule(text, availableSlots) {
  const raw = String(text || '').trim()
  if (!raw) {
    return {
      ok: false,
      error:
        'Пустое сообщение. Пример: Пн 9:00-18:00, Вт 10:00-19:00'
    }
  }

  const parts = raw.split(/[,;]+/).map(function (p) {
    return p.trim()
  }).filter(Boolean)

  if (!parts.length) {
    return {
      ok: false,
      error:
        'Не разобрал сообщение. Пример: Пн 9:00-18:00, Вт 10:00-19:00'
    }
  }

  const entries = []
  const seen = new Set()

  for (const part of parts) {
    const m = part.match(
      /^([^\d]+?)\s+(\d{1,2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?)$/u
    )
    if (!m) {
      return {
        ok: false,
        error:
          'Не разобрал: «' +
          part +
          '». Пример: Пн 9:00-18:00, Вт 10:00-19:00'
      }
    }

    const day = parseDayToken(m[1])
    if (!day) {
      return {
        ok: false,
        error: 'Неизвестный день: «' + m[1].trim() + '»'
      }
    }
    if (seen.has(day)) {
      return { ok: false, error: 'День повторён: ' + DAY_SHORT[day] }
    }

    const startClock = parseClock(m[2])
    const endClock = parseClock(m[3])
    if (!startClock || !endClock) {
      return { ok: false, error: 'Некорректное время в «' + part + '»' }
    }

    const startMin = startClock.hour * 60 + startClock.minute
    const endMin = endClock.hour * 60 + endClock.minute
    if (endMin <= startMin) {
      return {
        ok: false,
        error: 'Конец раньше начала: «' + part + '»'
      }
    }

    const mapped = mapRangeToSlots(startClock, endClock, availableSlots)
    if (!mapped.ok) {
      return { ok: false, error: mapped.error + ' (' + DAY_SHORT[day] + ')' }
    }

    seen.add(day)
    entries.push({
      day: day,
      startTime: mapped.startTime,
      endTime: mapped.endTime,
      label:
        DAY_SHORT[day] +
        ' ' +
        padTime(startClock.hour, startClock.minute) +
        '-' +
        padTime(endClock.hour, endClock.minute)
    })
  }

  entries.sort(function (a, b) {
    return DAYS.indexOf(a.day) - DAYS.indexOf(b.day)
  })

  return { ok: true, entries: entries }
}

function formatFreeformPreview(entries) {
  return entries
    .map(function (e) {
      return e.label + ' → слоты ' + e.startTime + ' … ' + e.endTime
    })
    .join('\n')
}

module.exports = {
  parseFreeformSchedule,
  formatFreeformPreview,
  mapRangeToSlots,
  parseClock,
  DAY_ALIASES
}
