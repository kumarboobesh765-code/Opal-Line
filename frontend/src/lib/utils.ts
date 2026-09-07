import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')
}

export function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

export function escapeHtml(str: string | null | undefined): string {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`
}

/** Converts an amount to Indian-style words, e.g. 123456.78 -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise". */
export function numberToIndianWords(amount: number): string {
  const n = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - n) * 100)
  if (n === 0 && paise === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const hundred = Math.floor((n % 1000) / 100)
  const rest = n % 100
  if (crore) parts.push(twoDigits(crore), 'Crore')
  if (lakh) parts.push(twoDigits(lakh), 'Lakh')
  if (thousand) parts.push(twoDigits(thousand), 'Thousand')
  if (hundred) parts.push(ONES[hundred], 'Hundred')
  if (rest) parts.push(twoDigits(rest))
  let out = parts.join(' ')
  if (paise > 0) out += n > 0 ? ' and ' : ''
  if (paise > 0) out += `${twoDigits(paise)} Paise`
  return out
}

export function safeImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return /^https?:\/\//i.test(url) ? url : undefined
}
