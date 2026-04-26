import { DeliveryInfo } from "@/components/delivery/delivery-info"

export const metadata = {
  title: "Доставка | Egg Origin",
  description: "Информация за доставка - срокове, цени и начини на доставка.",
}

export default function DeliveryPage() {
  return (
    <div className="bg-background py-12 sm:py-16 lg:py-24">
      <div className="mx-auto max-w-3xl px-5 sm:px-6 lg:px-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
          Информация
        </p>
        <h1 className="mt-4 text-[28px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-3xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-4xl">
          Доставка
        </h1>
        <div className="mt-6 sm:mt-8">
          <DeliveryInfo />
        </div>
      </div>
    </div>
  )
}
