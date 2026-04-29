"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { getWithdrawals, type Withdrawal, type WithdrawalStatus } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const STATUS_LABELS: Record<WithdrawalStatus | "all", string> = {
  all: "Всички",
  requested: "Подадени",
  approved: "Одобрени",
  goods_received: "Получени стоки",
  rejected: "Отказани",
  completed: "Завършени",
}

const STATUS_BADGE_CLASS: Record<WithdrawalStatus, string> = {
  requested: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  goods_received: "bg-violet-100 text-violet-800",
  rejected: "bg-red-100 text-red-800",
  completed: "bg-green-100 text-green-800",
}

export default function AdminReturnsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<WithdrawalStatus | "all">("all")

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getWithdrawals({ status, page })
      setWithdrawals(result.withdrawals)
      setTotal(result.total)
    } catch {
      // session expired
    } finally {
      setLoading(false)
    }
  }, [status, page])

  useEffect(() => {
    fetchWithdrawals()
  }, [fetchWithdrawals])

  const totalPages = Math.ceil(total / 100)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Заявки</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Право на отказ (ЗЗП Чл. 50). Регистрирайте нови заявки от страницата на поръчката.
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(STATUS_LABELS) as Array<WithdrawalStatus | "all">).map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatus(s); setPage(0) }}
          >
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Зареждане...</div>
        ) : withdrawals.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Няма заявки</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Референция</TableHead>
                <TableHead>Поръчка</TableHead>
                <TableHead>Имейл</TableHead>
                <TableHead>Канал</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Подадена</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withdrawals.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-sm">{w.withdrawal_ref}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/orders/${w.order_id}`}
                      className="font-mono text-sm text-blue-600 hover:underline"
                    >
                      #{w.order_id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{w.customer_email}</TableCell>
                  <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                    {w.requested_via}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className={`rounded-full px-2 py-1 ${STATUS_BADGE_CLASS[w.status]}`}>
                      {STATUS_LABELS[w.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(w.created_at).toLocaleDateString("bg-BG", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/returns/${w.id}`}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Отвори ↗
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "заявка" : "заявки"} — страница {page + 1} от {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Назад
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              Напред
            </Button>
          </div>
        </div>
      )}

      {totalPages <= 1 && total > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {total} {total === 1 ? "заявка" : "заявки"}
        </p>
      )}
    </div>
  )
}
