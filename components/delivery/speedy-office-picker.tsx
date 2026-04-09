"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { MapPin, ChevronsUpDown, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface SpeedyOfficeOption {
  id: number
  name: string
  city: string
  fullAddress: string
}

interface SpeedyOfficePickerProps {
  selectedOfficeId: number | null
  onSelect: (office: SpeedyOfficeOption) => void
}

export function SpeedyOfficePicker({ selectedOfficeId, onSelect }: SpeedyOfficePickerProps) {
  const [offices, setOffices] = useState<SpeedyOfficeOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cityFilter, setCityFilter] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)
  const [manualValue, setManualValue] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fetchedRef = useRef(false)

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

  // Fetch on first open only
  useEffect(() => {
    if (!isOpen || fetchedRef.current) return
    fetchedRef.current = true
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    fetch("/api/speedy/offices", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch")
        return res.json()
      })
      .then((data) => {
        setOffices(data.offices || [])
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        fetchedRef.current = false // allow retry on next open
        setError("Неуспешно зареждане на офисите на Speedy")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [isOpen])

  const selectedOffice = offices.find((o) => o.id === selectedOfficeId)
  const selectedItemRef = useRef<HTMLButtonElement>(null)

  // Scroll selected item into view when dropdown opens
  useEffect(() => {
    if (isOpen && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: "nearest" })
    }
  }, [isOpen])

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
    const groups = new Map<string, SpeedyOfficeOption[]>()
    for (const office of filteredOffices) {
      const city = office.city || "Други"
      if (!groups.has(city)) groups.set(city, [])
      groups.get(city)!.push(office)
    }
    return groups
  }, [filteredOffices])

  return (
    <div className="space-y-3" ref={dropdownRef}>
      <Label>Изберете офис на Speedy *</Label>

      {error || manualEntry ? (
        <>
          <Input
            placeholder="Въведи адрес, офис или автомат за доставка със Speedy"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            onBlur={(e) => {
              const value = e.target.value.trim()
              if (value) {
                onSelect({ id: 0, name: value, city: "", fullAddress: value })
              }
            }}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {error ? "Автоматичното зареждане е недостъпно." : "Въведете пълния адрес на офиса."}
            </p>
            {manualEntry && !error && (
              <button
                type="button"
                className="text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                onClick={() => {
                  setManualEntry(false)
                  setManualValue("")
                }}
              >
                Търси от списъка
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            className={`w-full justify-between font-normal ${!selectedOffice ? "border-foreground/40 text-muted-foreground" : "border-foreground/60"}`}
            onClick={() => setIsOpen(!isOpen)}
          >
            {selectedOffice ? (
              <span className="flex items-center gap-2 truncate">
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-foreground">
                  {selectedOffice.city} — {selectedOffice.name}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" />
                Изберете офис...
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>

          {isOpen && (
            <div className="rounded-lg border border-border bg-background shadow-lg">
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Зареждане на офиси...
                </div>
              ) : (
              <>
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
                  <div className="p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Няма намерени офиси
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                      onClick={() => {
                        setManualEntry(true)
                        setManualValue(cityFilter)
                        setIsOpen(false)
                      }}
                    >
                      Въведи ръчно
                    </button>
                  </div>
                ) : (
                  Array.from(groupedOffices.entries()).map(([city, cityOffices]) => (
                <div key={city}>
                  <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {city}
                  </p>
                    {cityOffices.map((office) => {
                      const isSelected = selectedOfficeId === office.id
                      return (
                        <button
                          key={office.id}
                          ref={isSelected ? selectedItemRef : undefined}
                          type="button"
                          className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                            isSelected ? "bg-secondary ring-1 ring-foreground/20" : ""
                          }`}
                          onClick={() => {
                            onSelect(office)
                            setIsOpen(false)
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>{office.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {office.fullAddress}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
              </div>
              </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
