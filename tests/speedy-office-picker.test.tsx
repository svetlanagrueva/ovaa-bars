import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { SpeedyOfficePicker } from "@/components/speedy-office-picker"

const mockOffices = [
  { id: 1, name: "Офис Дружба", city: "София", fullAddress: "бул. Цариградско 115" },
  { id: 2, name: "Офис Център", city: "София", fullAddress: "ул. Витоша 10" },
  { id: 3, name: "Офис Тракия", city: "Пловдив", fullAddress: "бул. Марица 50" },
]

function setupFetchMock(offices = mockOffices) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ offices }),
      })
    )
  )
}

// Opens the picker and waits for offices to finish loading.
// Returns with the dropdown open.
async function renderAndOpen(props: { selectedOfficeId: number | null; onSelect: ReturnType<typeof vi.fn> }) {
  cleanup()
  const result = render(<SpeedyOfficePicker {...props} />)
  fireEvent.click(screen.getByRole("button", { name: /Изберете офис/i }))
  await waitFor(() => {
    expect(screen.queryByText("Зареждане на офиси...")).not.toBeInTheDocument()
  })
  return result
}

function getToggleButton() {
  return screen.getByRole("button", { name: /Изберете офис|София|Пловдив/i })
}

describe("SpeedyOfficePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupFetchMock()
  })

  it("shows loading state when dropdown is first opened", () => {
    render(<SpeedyOfficePicker selectedOfficeId={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /Изберете офис/i }))
    expect(screen.getByText("Зареждане на офиси...")).toBeInTheDocument()
  })

  it("renders offices after loading", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    expect(screen.getByText("Офис Дружба")).toBeInTheDocument()
    expect(screen.getByText("Офис Тракия")).toBeInTheDocument()
  })

  it("groups offices by city", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    expect(screen.getByText("София")).toBeInTheDocument()
    expect(screen.getByText("Пловдив")).toBeInTheDocument()
  })

  it("calls onSelect when office is clicked", async () => {
    const onSelect = vi.fn()
    await renderAndOpen({ selectedOfficeId: null, onSelect })

    fireEvent.click(screen.getByText("Офис Дружба"))

    expect(onSelect).toHaveBeenCalledWith(mockOffices[0])
  })

  it("filters offices by search term", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Пловдив" } })

    expect(screen.getByText("Офис Тракия")).toBeInTheDocument()
    expect(screen.queryByText("Офис Дружба")).not.toBeInTheDocument()
    expect(screen.queryByText("Офис Център")).not.toBeInTheDocument()
  })

  it("shows empty state when no offices match filter", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ град" } })

    expect(screen.getByText("Няма намерени офиси")).toBeInTheDocument()
  })

  it("displays selected office name in button", async () => {
    await renderAndOpen({ selectedOfficeId: 1, onSelect: vi.fn() })

    // Close dropdown so we can inspect the button text
    fireEvent.click(getToggleButton())

    expect(screen.getByText(/София — Офис Дружба/)).toBeInTheDocument()
  })

  it("shows manual input fallback when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false }))
    )

    cleanup()
    render(<SpeedyOfficePicker selectedOfficeId={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /Изберете офис/i }))

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Въведи адрес, офис или автомат за доставка със Speedy")
      ).toBeInTheDocument()
    })
  })

  it("closes dropdown after selecting an office", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    expect(screen.getByText("Офис Дружба")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Офис Дружба"))

    expect(
      screen.queryByPlaceholderText("Търсене по град или адрес...")
    ).not.toBeInTheDocument()
  })

  it("shows manual entry option when search returns no results", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ град" } })

    expect(screen.getByText("Въведи ръчно")).toBeInTheDocument()
  })

  it("switches to manual input when 'Въведи ръчно' is clicked", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ" } })
    fireEvent.click(screen.getByText("Въведи ръчно"))

    const manualInput = screen.getByPlaceholderText("Въведи адрес, офис или автомат за доставка със Speedy")
    expect(manualInput).toBeInTheDocument()
    expect(manualInput).toHaveValue("Несъществуващ")
  })

  it("calls onSelect with manual value on blur", async () => {
    const onSelect = vi.fn()
    await renderAndOpen({ selectedOfficeId: null, onSelect })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ" } })
    fireEvent.click(screen.getByText("Въведи ръчно"))

    const manualInput = screen.getByPlaceholderText("Въведи адрес, офис или автомат за доставка със Speedy")
    fireEvent.change(manualInput, { target: { value: "Speedy офис Бургас Славейков" } })
    fireEvent.blur(manualInput)

    expect(onSelect).toHaveBeenCalledWith({
      id: 0,
      name: "Speedy офис Бургас Славейков",
      city: "",
      fullAddress: "Speedy офис Бургас Славейков",
    })
  })

  it("switches back to dropdown when 'Търси от списъка' is clicked", async () => {
    await renderAndOpen({ selectedOfficeId: null, onSelect: vi.fn() })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ" } })
    fireEvent.click(screen.getByText("Въведи ръчно"))

    expect(screen.getByText("Търси от списъка")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Търси от списъка"))

    expect(screen.getByRole("button", { name: /Изберете офис/i })).toBeInTheDocument()
  })

  it("does not call onSelect when manual input is empty on blur", async () => {
    const onSelect = vi.fn()
    await renderAndOpen({ selectedOfficeId: null, onSelect })

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ" } })
    fireEvent.click(screen.getByText("Въведи ръчно"))

    const manualInput = screen.getByPlaceholderText("Въведи адрес, офис или автомат за доставка със Speedy")
    fireEvent.change(manualInput, { target: { value: "" } })
    fireEvent.blur(manualInput)

    expect(onSelect).not.toHaveBeenCalled()
  })
})
