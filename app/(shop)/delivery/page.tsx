import { DeliveryInfo } from "@/components/delivery/delivery-info"

export const metadata = {
  title: "Доставка | Egg Origin",
  description: "Информация за доставка - срокове, цени и начини на доставка.",
}

export default function DeliveryPage() {
  return (
    <div className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Информация
        </p>
        <h1 className="mt-6 text-3xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-4xl">
          Доставка
        </h1>
        <div className="mt-8">
          <DeliveryInfo />
        </div>
      </div>
    </div>
  )
}
