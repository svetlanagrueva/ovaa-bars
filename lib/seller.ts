import "server-only"

export interface SellerConfig {
  companyName: string
  eik: string
  vatNumber: string
  mol: string
  address: string
  city: string
  postalCode: string
  phone: string
  email: string
  iban: string
  bank: string
}

export function getSellerConfig(): SellerConfig {
  const config: SellerConfig = {
    companyName: process.env.SELLER_COMPANY_NAME || "",
    eik: process.env.SELLER_EIK || "",
    vatNumber: process.env.SELLER_VAT_NUMBER || "",
    mol: process.env.SELLER_MOL || "",
    address: process.env.SELLER_ADDRESS || "",
    city: process.env.SELLER_CITY || "",
    postalCode: process.env.SELLER_POSTAL_CODE || "",
    phone: process.env.SELLER_PHONE || "",
    email: process.env.SELLER_EMAIL || "",
    iban: process.env.SELLER_IBAN || "",
    bank: process.env.SELLER_BANK || "",
  }

  if (!config.companyName || !config.eik) {
    throw new Error("Seller config incomplete: SELLER_COMPANY_NAME and SELLER_EIK are required")
  }

  return config
}
