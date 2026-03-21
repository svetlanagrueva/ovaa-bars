"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { MapPin, ChevronsUpDown, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface EcontOfficeOption {
  id: number
  name: string
  city: string
  fullAddress: string
}

interface EcontOfficePickerProps {
  selectedOfficeId: number | null
  onSelect: (office: EcontOfficeOption) => void
}

export function EcontOfficePicker({ selectedOfficeId, onSelect }: EcontOfficePickerProps) {
  const [offices, setOffices] = useState<EcontOfficeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cityFilter, setCityFilter] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch("/api/econt/offices", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch")
        return res.json()
      })
      .then((data) => {
        setOffices(data.offices || [])
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setError("Неуспешно зареждане на офисите на Еконт")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const selectedOffice = offices.find((o) => o.id === selectedOfficeId)

  const filteredOffices = useMemo(() => {
    if (!cityFilter.trim()) return offices
    const lower = cityFilter.toLowerCase()
    return offices.filter(
      (o) =>
        o.city.toLowerCase().includes(lower) ||
        o.name.toLowerCase().includes(lower) ||
        o.fullAddress.toLowerCase().includes(lower)
    )
  }, [offices, cityFilter])

  // Group by city
  const groupedOffices = useMemo(() => {
    const groups = new Map<string, EcontOfficeOption[]>()
    for (const office of filteredOffices) {
      const city = office.city || "Други"
      if (!groups.has(city)) groups.set(city, [])
      groups.get(city)!.push(office)
    }
    return groups
  }, [filteredOffices])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Зареждане на офиси...
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Label>Офис на Еконт *</Label>
        <Input
          placeholder="Въведи адрес или офис на Еконт за доставка"
          onChange={(e) => {
            const value = e.target.value
            if (value.trim()) {
              onSelect({ id: 0, name: value.trim(), city: "", fullAddress: value.trim() })
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Автоматичното зареждане на офиси е недостъпно. Моля, въведете името на офиса ръчно.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3" ref={dropdownRef}>
      <Label>Изберете офис на Еконт *</Label>

      <Button
        type="button"
        variant="outline"
        className="w-full justify-between font-normal"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedOffice ? (
          <span className="flex items-center gap-2 truncate">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {selectedOffice.city} - {selectedOffice.name}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Изберете офис...</span>
        )}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {isOpen && (
        <div className="rounded-lg border border-border bg-background shadow-lg">
          <div className="p-3 border-b border-border">
            <Input
              placeholder="Търсене по град или адрес..."
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOffices.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Няма намерени офиси
              </p>
            ) : (
              Array.from(groupedOffices.entries()).map(([city, cityOffices]) => (
                <div key={city}>
                  <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {city}
                  </p>
                  {cityOffices.map((office) => (
                    <button
                      key={office.id}
                      type="button"
                      className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                        selectedOfficeId === office.id ? "bg-secondary" : ""
                      }`}
                      onClick={() => {
                        onSelect(office)
                        setIsOpen(false)
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{office.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {office.fullAddress}
                        </p>
                      </div>
                      {selectedOfficeId === office.id && (
                        <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
