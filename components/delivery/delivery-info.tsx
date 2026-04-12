import { formatPrice } from "@/lib/products"
import { FREE_SHIPPING_THRESHOLD, SHIPPING_PRICE_OFFICE, SHIPPING_PRICE_ADDRESS } from "@/lib/constants"

export function DeliveryInfo() {
  return (
    <div className="space-y-4 text-sm leading-7 text-muted-foreground">
      <p>Всички поръчки над {formatPrice(FREE_SHIPPING_THRESHOLD)} са с безплатна доставка до офис на куриер.</p>
      <p>При поръчка под {formatPrice(FREE_SHIPPING_THRESHOLD)} се начислява доставка {formatPrice(SHIPPING_PRICE_OFFICE)}.</p>
      <p>При доставка до адрес се начислява доставка {formatPrice(SHIPPING_PRICE_ADDRESS)} независимо от стойността на поръчката.</p>
      <p>
        Онлайн магазинът извършва доставка в цяла България с куриерска
        фирма &bdquo;Еконт Експрес&ldquo; &mdash; до точен адрес или до офис на
        Еконт. Също така и със куриерска фирма Спиди &mdash; до точен адрес или
        до офис на Спиди.
      </p>
      <p>
        При завършване на поръчката, в полето за Адрес посочете точен адрес за
        доставка или въведете офис на Еконт или Спиди, до който искате да
        изпратите доставката.
      </p>
      <p>Поръчките се изпълняват за срок от 1 до 3 работни дни.</p>
      <p>
        Поръчки направени в петък (след 15:00ч.), събота, неделя и празнични дни
        се обработват до два работни дни след това.
      </p>
    </div>
  )
}
