const DEFAULT_RATE = 1

function normalizeRate(rate) {
  const n = Number(rate)
  if (n === 0.5) return 0.5
  return 1
}

function normalizeProfile(profile) {
  if (!profile) return null
  return {
    department: profile.department,
    employee: profile.employee,
    sheetName: profile.sheetName,
    rate: normalizeRate(profile.rate)
  }
}

function formatRateLine(rate) {
  const normalized = normalizeRate(rate)
  const norm = normalized === 0.5 ? 20 : 40
  const label = normalized === 0.5 ? '0,5 (полставки)' : '1 (полная)'
  return 'Ставка: ' + label + ', норма ' + norm + ' ч/нед'
}

module.exports = {
  DEFAULT_RATE,
  normalizeRate,
  normalizeProfile,
  formatRateLine
}
