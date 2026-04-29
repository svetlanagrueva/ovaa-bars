"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
  getWithdrawals,
  getComplaints,
  type Withdrawal,
  type Complaint,
} from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Per-type status display. Withdrawals and complaints have different
// status taxonomies; we render each row with its own type-aware mapping.
const WD_STATUS_LABELS: Record<Withdrawal["status"], string> = {
  requested: "Подадена",
  approved: "Одобрена",
  goods_received: "Получени стоки",
  rejected: "Отказана",
  completed: "Завършена",
}
const WD_STATUS_BADGE: Record<Withdrawal["status"], string> = {
  requested: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  goods_received: "bg-violet-100 text-violet-800",
  rejected: "bg-red-100 text-red-800",
  completed: "bg-green-100 text-green-800",
}

const CMP_STATUS_LABELS: Record<string, string> = {
  open: "Отворена",
  resolved: "Приключена",
  rejected: "Отхвърлена",
}
const CMP_STATUS_BADGE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  resolved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
}

type RequestType = "all" | "withdrawal" | "complaint"

interface UnifiedRow {
  type: "withdrawal" | "complaint"
  id: string
  ref: string
  order_id: string
  status: string
  created_at: string
  // Withdrawal-specific
  customer_email?: string
  requested_via?: string
  // Complaint-specific
  customer_demand?: string
  defect_description?: string
}

export default function AdminReturnsPage() {
  const [rows, setRows] = useState<UnifiedRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<RequestType>("all")

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const [wResult, cResult] = await Promise.all([
        typeFilter === "complaint"
          ? Promise.resolve({ withdrawals: [] as Withdrawal[], total: 0 })
          : getWithdrawals({}),
        typeFilter === "withdrawal"
          ? Promise.resolve({ complaints: [] as Complaint[], total: 0 })
          : getComplaints({}),
      ])

      const wRows: UnifiedRow[] = wResult.withdrawals.map((w) => ({
        type: "withdrawal",
        id: w.id,
        ref: w.withdrawal_ref,
        order_id: w.order_id,
        status: w.status,
        created_at: w.created_at,
        customer_email: w.customer_email,
        requested_via: w.requested_via,
      }))
      const cRows: UnifiedRow[] = cResult.complaints.map((c) => ({
        type: "complaint",
        id: String(c.id),
        ref: c.complaint_ref,
        order_id: c.order_id,
        status: c.status,
        created_at: c.reported_at,
        customer_demand: c.customer_demand,
        defect_description: c.defect_description,
      }))

      // Merge + sort by created_at desc
      const merged = [...wRows, ...cRows].sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      )
      setRows(merged)
      setTotal(wResult.total + cResult.total)
    } catch {
      // session expired
    } finally {
      setLoading(false)
    }
  }, [typeFilter])

  useEffect(() => {
    fetch()
  }, [fetch])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Заявки</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Право на отказ (ЗЗП Чл. 50) и рекламации (ЗЗП Чл. 127).
            Регистрирайте нови заявки от страницата на поръчката.
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={typeFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setTypeFilter("all")}
        >
          Всички
        </Button>
        <Button
          variant={typeFilter === "withdrawal" ? "default" : "outline"}
          size="sm"
          onClick={() => setTypeFilter("withdrawal")}
        >
          Право на отказ
        </Button>
        <Button
          variant={typeFilter === "complaint" ? "default" : "outline"}
          size="sm"
          onClick={() => setTypeFilter("complaint")}
        >
          Рекламации
        </Button>
      </div>

      <div className="rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма заявки</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип</TableHead>
                <TableHead>Референция</TableHead>
                <TableHead>Поръчка</TableHead>
                <TableHead>Детайли</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Подадена</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const isWithdrawal = r.type === "withdrawal"
                const statusLabel = isWithdrawal
                  ? WD_STATUS_LABELS[r.status as Withdrawal["status"]]
                  : CMP_STATUS_LABELS[r.status]
                const statusBadge = isWithdrawal
                  ? WD_STATUS_BADGE[r.status as Withdrawal["status"]]
                  : CMP_STATUS_BADGE[r.status]
                return (
                  <TableRow key={`${r.type}-${r.id}`}>
                    <TableCell className="text-xs">
                      {isWithdrawal ? (
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-800">
                          Право на отказ
                        </span>
                      ) : (
                        <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-800">
                          Рекламация
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{r.ref}</TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${r.order_id}`}
                        className="font-mono text-sm text-blue-600 hover:underline"
                      >
                        #{r.order_id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {isWithdrawal ? (
                        <div>
                          <div>{r.customer_email}</div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {r.requested_via}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-xs">
                            {(r.defect_description ?? "").length > 60
                              ? (r.defect_description ?? "").slice(0, 60) + "…"
                              : r.defect_description}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Претенция: {r.customer_demand}
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={`rounded-full px-2 py-1 ${statusBadge}`}>
                        {statusLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("bg-BG", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                      })}
                    </TableCell>
                    <TableCell>
                      {isWithdrawal ? (
                        <Link
                          href={`/admin/returns/${r.id}`}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Отвори ↗
                        </Link>
                      ) : (
                        // Complaints don't have a dedicated detail page — they're
                        // managed inline from the order detail page. Link there.
                        <Link
                          href={`/admin/orders/${r.order_id}`}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Към поръчка ↗
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {total > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {total} {total === 1 ? "заявка" : "заявки"}
        </p>
      )}
    </div>
  )
}
