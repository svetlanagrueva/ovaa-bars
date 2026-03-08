import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { EcontOfficePicker } from "@/components/econt-office-picker"

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

async function renderAndWaitForLoad(props: { selectedOfficeId: number | null; onSelect: ReturnType<typeof vi.fn> }) {
  cleanup()
  const result = render(<EcontOfficePicker {...props} />)
  await waitFor(() => {
    expect(screen.queryByText("Зареждане на офиси...")).not.toBeInTheDocument()
  })
  return result
}

function getToggleButton() {
  // The toggle button is the one with role="button" that has the ChevronsUpDown icon
  return screen.getByRole("button", { name: /Изберете офис|София|Пловдив/i })
}

describe("EcontOfficePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    setupFetchMock()
  })

  it("shows loading state initially", () => {
    render(<EcontOfficePicker selectedOfficeId={null} onSelect={vi.fn()} />)
    expect(screen.getByText("Зареждане на офиси...")).toBeInTheDocument()
  })

  it("renders offices after loading", async () => {
    await renderAndWaitForLoad({ selectedOfficeId: null, onSelect: vi.fn() })

    // Open dropdown
    fireEvent.click(getToggleButton())

    expect(screen.getByText("Офис Дружба")).toBeInTheDocument()
    expect(screen.getByText("Офис Тракия")).toBeInTheDocument()
  })

  it("groups offices by city", async () => {
    await renderAndWaitForLoad({ selectedOfficeId: null, onSelect: vi.fn() })

    fireEvent.click(getToggleButton())

    // City group headers (uppercase)
    expect(screen.getByText("София")).toBeInTheDocument()
    expect(screen.getByText("Пловдив")).toBeInTheDocument()
  })

  it("calls onSelect when office is clicked", async () => {
    const onSelect = vi.fn()
    await renderAndWaitForLoad({ selectedOfficeId: null, onSelect })

    fireEvent.click(getToggleButton())
    fireEvent.click(screen.getByText("Офис Дружба"))

    expect(onSelect).toHaveBeenCalledWith(mockOffices[0])
  })

  it("filters offices by search term", async () => {
    await renderAndWaitForLoad({ selectedOfficeId: null, onSelect: vi.fn() })

    fireEvent.click(getToggleButton())

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Пловдив" } })

    expect(screen.getByText("Офис Тракия")).toBeInTheDocument()
    expect(screen.queryByText("Офис Дружба")).not.toBeInTheDocument()
    expect(screen.queryByText("Офис Център")).not.toBeInTheDocument()
  })

  it("shows empty state when no offices match filter", async () => {
    await renderAndWaitForLoad({ selectedOfficeId: null, onSelect: vi.fn() })

    fireEvent.click(getToggleButton())

    const searchInput = screen.getByPlaceholderText("Търсене по град или адрес...")
    fireEvent.change(searchInput, { target: { value: "Несъществуващ град" } })

    expect(screen.getByText("Няма намерени офиси")).toBeInTheDocument()
  })

  it("displays selected office name in button", async () => {
    await renderAndWaitForLoad({ selectedOfficeId: 1, onSelect: vi.fn() })

    expect(screen.getByText(/София - Офис Дружба/)).toBeInTheDocument()
  })

  it("shows error state when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false }))
    )

    cleanup()
    render(<EcontOfficePicker selectedOfficeId={null} onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(
        screen.getByText("Неуспешно зареждане на офисите на Еконт")
      ).toBeInTheDocument()
    })
  })

  it("closes dropdown after selecting an office", async () => {
    await renderAndWaitForLoad({ selectedOfficeId: null, onSelect: vi.fn() })

    // Open dropdown
    fireEvent.click(getToggleButton())
    expect(screen.getByText("Офис Дружба")).toBeInTheDocument()

    // Select office — dropdown should close
    fireEvent.click(screen.getByText("Офис Дружба"))

    // Search input should no longer be visible
    expect(
      screen.queryByPlaceholderText("Търсене по град или адрес...")
    ).not.toBeInTheDocument()
  })
})
