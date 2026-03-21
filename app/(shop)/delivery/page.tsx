import { DeliveryInfo } from "@/components/delivery-info"

export const metadata = {
  title: "Доставка | Ovva Sculpt",
  description: "Информация за доставка - срокове, цени и начини на доставка.",
}

export default function DeliveryPage() {
  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Доставка</h1>
        <div className="mt-8">
          <DeliveryInfo />
        </div>
      </div>
    </div>
  )
}
