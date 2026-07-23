const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { WORK_TYPES } = require('./constants')

const OFFICE_GREEN = 'FF00B050'
const REMOTE_ORANGE_RGB = 'FFFF6D01'
const REMOTE_THEME_INDEX = 8

// Data-cell styles first; legend styles (row 9) appended dynamically.
// Remote: explicit RGB orange first; theme-only (60) is last-resort fallback.
const PREFERRED_STYLE_IDS = {
  semi: [132, 42, 44, 58, 143],
  office: [43, 16, 102, 51],
  remote: [49, 110, 133, 60]
}

const LEGEND_CELLS = { F: 'semi', G: 'office', H: 'remote' }

function colToNumber(col) {
  let n = 0
  for (const ch of col) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n
}

function numberToCol(num) {
  let n = num
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function cellRef(row, col) {
  return `${numberToCol(col)}${row}`
}

function parseFills(stylesXml) {
  const fills = []
  const fillRegex = /<fill\b[^>]*>([\s\S]*?)<\/fill>|<fill\b[^>]*\/>/g
  let match
  while ((match = fillRegex.exec(stylesXml))) {
    const block = match[0]
    const rgb = (block.match(/fgColor[^>]*rgb="([^"]+)"/) || [])[1] || null
    const themeMatch = block.match(/fgColor[^>]*theme="(\d+)"/)
    fills.push({
      rgb: rgb ? rgb.toUpperCase() : null,
      theme: themeMatch ? Number(themeMatch[1]) : null
    })
  }
  return fills
}

function parseCellXfs(stylesXml) {
  const xfs = []
  const xfBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!xfBlock) return xfs

  const xfRegex = /<xf\b[^>]*\/?>/g
  let xfMatch
  while ((xfMatch = xfRegex.exec(xfBlock[1]))) {
    const tag = xfMatch[0]
    xfs.push({
      fillId: Number((tag.match(/fillId="(\d+)"/) || [])[1] || 0)
    })
  }
  return xfs
}

function findStyleIdsByColor(stylesXml) {
  const fills = parseFills(stylesXml)
  const xfs = parseCellXfs(stylesXml)

  const byColor = {}
  for (let styleId = 0; styleId < xfs.length; styleId++) {
    const fillId = xfs[styleId].fillId
    const rgb = fills[fillId]?.rgb
    if (!rgb) continue
    if (!byColor[rgb]) byColor[rgb] = []
    byColor[rgb].push(styleId)
  }
  return byColor
}

function findStylesWithThemeFill(stylesXml, themeIndex) {
  const fills = parseFills(stylesXml)
  const xfs = parseCellXfs(stylesXml)
  const matchingFillIds = new Set()

  fills.forEach((meta, fillId) => {
    if (meta.theme === themeIndex) matchingFillIds.add(fillId)
  })

  const styleIds = []
  for (let styleId = 0; styleId < xfs.length; styleId++) {
    if (matchingFillIds.has(xfs[styleId].fillId)) {
      styleIds.push(styleId)
    }
  }
  return styleIds
}

function styleFillColor(stylesXml, styleId) {
  const fills = parseFills(stylesXml)
  const xfs = parseCellXfs(stylesXml)
  if (styleId < 0 || styleId >= xfs.length) return null
  const fill = fills[xfs[styleId].fillId]
  if (!fill) return null
  return { rgb: fill.rgb, theme: fill.theme }
}

function isGreenFill(fillColor) {
  if (!fillColor) return false
  return fillColor.rgb === OFFICE_GREEN
}

function isExplicitOrangeRgb(fillColor) {
  if (!fillColor) return false
  return fillColor.rgb === REMOTE_ORANGE_RGB
}

function isOrangeFill(fillColor) {
  if (!fillColor) return false
  return isExplicitOrangeRgb(fillColor) || fillColor.theme === REMOTE_THEME_INDEX
}

function resolveLegendStyles(sheetXml) {
  const legend = { semi: null, office: null, remote: null }
  for (const [col, key] of Object.entries(LEGEND_CELLS)) {
    const match = sheetXml.match(new RegExp(`<c r="${col}9" s="(\\d+)"`))
    if (match) legend[key] = Number(match[1])
  }
  return legend
}

function buildPreferredIds(workTypeId, legendStyles) {
  const base = [...(PREFERRED_STYLE_IDS[workTypeId] || [])]
  const legendId = legendStyles?.[workTypeId]
  if (legendId == null || base.includes(legendId)) return base

  if (workTypeId === 'remote') {
    // Keep legend before theme-only fallback (60), after explicit RGB styles.
    const themeFallbackIdx = base.indexOf(60)
    if (themeFallbackIdx >= 0) base.splice(themeFallbackIdx, 0, legendId)
    else base.push(legendId)
    return base
  }

  base.push(legendId)
  return base
}

function pickStyleId(byColor, color, preferredIds, themeStyleIds = [], stylesXml = null, workTypeId = null) {
  const idsForColor = byColor[color] || []
  const candidates = []

  for (const id of preferredIds) {
    if (idsForColor.includes(id) || themeStyleIds.includes(id)) {
      candidates.push(id)
    }
  }
  if (!candidates.length) {
    if (idsForColor.length) candidates.push(...idsForColor)
    else if (themeStyleIds.length) candidates.push(...themeStyleIds)
  }

  if (stylesXml && workTypeId === 'remote') {
    // Prefer explicit RGB orange so viewers without the workbook theme stay orange.
    for (const id of candidates) {
      const fill = styleFillColor(stylesXml, id)
      if (isExplicitOrangeRgb(fill) && !isGreenFill(fill)) return id
    }
    for (const id of candidates) {
      const fill = styleFillColor(stylesXml, id)
      if (isOrangeFill(fill) && !isGreenFill(fill)) return id
    }
    return null
  }

  return candidates[0] ?? null
}

function resolveWorkTypeStyle(stylesXml, workTypeId, legendStyles = {}) {
  const workType = WORK_TYPES[workTypeId]
  if (!workType) throw new Error(`Неизвестный тип работы: ${workTypeId}`)

  const byColor = findStyleIdsByColor(stylesXml)
  const color = workType.color.toUpperCase()
  const preferred = buildPreferredIds(workTypeId, legendStyles)
  const themeStyles =
    workTypeId === 'remote' ? findStylesWithThemeFill(stylesXml, REMOTE_THEME_INDEX) : []

  const styleId = pickStyleId(byColor, color, preferred, themeStyles, stylesXml, workTypeId)
  if (styleId == null) {
    throw new Error(
      `В Excel не найден стиль с цветом ${color} для «${workType.label}». ` +
        'Добавьте легенду Очно/Дистанц/Очно (0,5ч) на лист.'
    )
  }

  if (workTypeId === 'remote') {
    const fill = styleFillColor(stylesXml, styleId)
    if (isGreenFill(fill) || (PREFERRED_STYLE_IDS.office || []).includes(styleId)) {
      throw new Error(
        `Для «${workType.label}» выбран зелёный стиль ${styleId}. ` +
          'Проверьте легенду и стили заливки в Excel.'
      )
    }
  }

  return { styleId, value: workType.value, color }
}

async function resolveSheetPath(zip, sheetName) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string')

  const sheetRegex = /<sheet\b[^>]*>/g
  let sheetMatch
  let rId = null
  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const tag = sheetMatch[0]
    const name = (tag.match(/name="([^"]+)"/) || [])[1]
    if (name === sheetName) {
      rId = (tag.match(/r:id="([^"]+)"/) || [])[1]
      break
    }
  }
  if (!rId) {
    throw new Error(`Лист «${sheetName}» не найден в workbook.xml`)
  }

  const relRegex = /<Relationship\b[^>]*>/g
  let relMatch
  while ((relMatch = relRegex.exec(relsXml))) {
    const tag = relMatch[0]
    const id = (tag.match(/\bId="([^"]+)"/) || [])[1]
    if (id === rId) {
      let target = (tag.match(/\bTarget="([^"]+)"/) || [])[1]
      if (!target) break
      if (target.startsWith('/')) target = target.slice(1)
      if (!target.startsWith('xl/')) target = path.posix.join('xl', target)
      return target.replace(/\\/g, '/')
    }
  }

  throw new Error(`Не найден путь листа для rId=${rId}`)
}

function escapeXmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildCellXml(ref, styleId, value) {
  const styleAttr = styleId != null ? ` s="${styleId}"` : ''
  const asNum = Number(value)
  if (typeof value === 'string' && value !== '' && !Number.isFinite(asNum)) {
    return (
      `<c r="${ref}"${styleAttr} t="inlineStr">` +
      `<is><t>${escapeXmlText(value)}</t></is></c>`
    )
  }
  return `<c r="${ref}"${styleAttr}><v>${asNum}</v></c>`
}

function upsertCellInRow(rowXml, ref, cellXml) {
  const col = colToNumber(ref.replace(/\d+/g, ''))
  const cellRegex = /<c\b[^>]*\br="([A-Z]+)\d+"[^>]*\/>|<c\b[^>]*\br="([A-Z]+)\d+"[^>]*>[\s\S]*?<\/c>/g
  const cells = []
  let match
  while ((match = cellRegex.exec(rowXml))) {
    const full = match[0]
    const cellRefAttr = (full.match(/\br="([A-Z]+\d+)"/) || [])[1]
    const cellCol = colToNumber(cellRefAttr.replace(/\d+/g, ''))
    cells.push({ full, col: cellCol, ref: cellRefAttr, index: match.index, length: full.length })
  }

  const existing = cells.find((c) => c.ref === ref)
  if (existing) {
    return (
      rowXml.slice(0, existing.index) +
      cellXml +
      rowXml.slice(existing.index + existing.length)
    )
  }

  const insertBefore = cells.find((c) => c.col > col)
  const openMatch = rowXml.match(/^<row\b[^>]*\/?>/)
  if (openMatch && openMatch[0].endsWith('/>')) {
    const openTag = openMatch[0].replace(/\/>$/, '>')
    return `${openTag}${cellXml}</row>`
  }

  if (insertBefore) {
    return (
      rowXml.slice(0, insertBefore.index) +
      cellXml +
      rowXml.slice(insertBefore.index)
    )
  }

  const closeIdx = rowXml.lastIndexOf('</row>')
  if (closeIdx === -1) {
    throw new Error(`Не удалось найти конец строки для ${ref}`)
  }
  return rowXml.slice(0, closeIdx) + cellXml + rowXml.slice(closeIdx)
}

function ensureRow(sheetXml, rowNumber, cellXml, ref) {
  const rowRegex = new RegExp(`<row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>|<row\\b[^>]*\\br="${rowNumber}"[^>]*\\/>`)
  const found = sheetXml.match(rowRegex)
  if (found) {
    const updated = upsertCellInRow(found[0], ref, cellXml)
    return sheetXml.replace(found[0], updated)
  }

  const newRow = `<row r="${rowNumber}">${cellXml}</row>`
  const sheetDataMatch = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)
  if (!sheetDataMatch) {
    throw new Error('В листе нет sheetData')
  }

  const inner = sheetDataMatch[1]
  const rowOpenRegex = /<row\b[^>]*\br="(\d+)"[^>]*\/?>/g
  let insertPos = null
  let m
  while ((m = rowOpenRegex.exec(inner))) {
    const r = Number(m[1])
    if (r > rowNumber) {
      insertPos = sheetDataMatch.index + sheetDataMatch[0].indexOf(inner) + m.index
      break
    }
  }

  if (insertPos == null) {
    const close = sheetXml.lastIndexOf('</sheetData>')
    return sheetXml.slice(0, close) + newRow + sheetXml.slice(close)
  }

  return sheetXml.slice(0, insertPos) + newRow + sheetXml.slice(insertPos)
}

function applyPatchesToSheetXml(sheetXml, patches, styleId) {
  let xml = sheetXml
  for (const patch of patches) {
    const ref = cellRef(patch.row, patch.col)
    const cellXml = buildCellXml(ref, styleId, patch.value)
    xml = ensureRow(xml, patch.row, cellXml, ref)
  }
  return xml
}

/**
 * Patch cells inside an existing xlsx without rewriting the whole workbook.
 * Preserves drawings, charts, and other OOXML parts that ExcelJS drops.
 */
async function patchWorkbookCells(excelPath, sheetName, targets, workTypeId) {
  const buffer = fs.readFileSync(excelPath)
  const zip = await JSZip.loadAsync(buffer)

  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) throw new Error('В файле нет xl/styles.xml')
  const stylesXml = await stylesFile.async('string')

  const sheetPath = await resolveSheetPath(zip, sheetName)
  const sheetFile = zip.file(sheetPath)
  if (!sheetFile) throw new Error(`Не найден файл листа: ${sheetPath}`)

  const sheetXml = await sheetFile.async('string')
  const legendStyles = resolveLegendStyles(sheetXml)
  const { styleId, value } = resolveWorkTypeStyle(stylesXml, workTypeId, legendStyles)

  const patches = targets.map((t) => ({ row: t.row, col: t.col, value }))
  const nextXml = applyPatchesToSheetXml(sheetXml, patches, styleId)
  zip.file(sheetPath, nextXml)

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  fs.writeFileSync(excelPath, out)

  return { styleId, value, sheetPath }
}

module.exports = {
  patchWorkbookCells,
  resolveWorkTypeStyle,
  resolveLegendStyles,
  styleFillColor,
  cellRef,
  numberToCol,
  colToNumber
}
