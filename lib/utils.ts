import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Bulgarian-locale date formatters. Used across the admin UI; keep the
// options aligned so the same date renders identically everywhere.
export function formatBgDate(value: string | null | undefined): string {
  if (!value) return ""
  return new Date(value).toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function formatBgDateTime(value: string | null | undefined): string {
  if (!value) return ""
  return new Date(value).toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
