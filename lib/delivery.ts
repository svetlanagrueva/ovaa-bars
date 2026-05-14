export function getDeliveryLabel(deliveryMethod: string): string {
  switch (deliveryMethod) {
    case "speedy-office": return "До офис на Speedy"
    case "speedy-address": return "Speedy до адрес"
    case "econt-office": return "До офис на Еконт"
    default: return deliveryMethod
  }
}

export function getCarrierName(deliveryMethod: string): string {
  return deliveryMethod.startsWith("speedy") ? "Speedy" : "Еконт"
}
