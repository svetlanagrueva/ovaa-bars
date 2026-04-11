import { PRODUCTS, formatPrice } from "@/lib/products"

// ── Shared types ──

interface OrderItem {
  productId: string
  productName: string
  quantity: number
  priceInCents: number
}

interface OrderEmailData {
  orderId: string
  firstName: string
  items: OrderItem[]
  subtotal: number
  shippingFee: number
  codFee: number
  discountAmount: number
  promoCode: string | null
  totalAmount: number
  paymentMethod: "card" | "cod"
  date: string
}

interface ShippingEmailData {
  orderId: string
  firstName: string
  items: OrderItem[]
  trackingNumber?: string
  carrierName: string
}

interface DeliveryEmailData {
  orderId: string
  firstName: string
  items: OrderItem[]
}

interface ReviewEmailData {
  orderId: string
  firstName: string
  items: OrderItem[]
}

interface CrossSellEmailData {
  firstName: string
  purchasedProductIds: string[]
}

interface AbandonedCartEmailData {
  firstName?: string
  items: OrderItem[]
  totalAmount: number
}

// ── Security: HTML escaping ──

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch])
}

// ── Shared helpers ──

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"

const BRAND_COLOR = "#3a3a2a"

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  )
}

function getProductImageUrl(productId: string, baseUrl: string): string {
  const product = PRODUCTS.find((p) => p.id === productId)
  if (!product) return `${baseUrl}/images/dark-chocolate-bar.png`
  return `${baseUrl}${product.image}`
}

function formatDate(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleDateString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function getSellerAddress(): string {
  const parts = [
    process.env.SELLER_COMPANY_NAME,
    process.env.SELLER_ADDRESS,
    process.env.SELLER_CITY,
    process.env.SELLER_POSTAL_CODE,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : "Egg Origin"
}

function utmUrl(url: string, campaign: string, content?: string): string {
  const sep = url.includes("?") ? "&" : "?"
  const params = `utm_source=email&utm_medium=transactional&utm_campaign=${encodeURIComponent(campaign)}${content ? `&utm_content=${encodeURIComponent(content)}` : ""}`
  return `${url}${sep}${params}`
}

function preheader(text: string): string {
  // Hidden preheader text shown in email client preview, padded with zero-width spaces
  // to prevent email clients from pulling in body text after the preheader
  const padding = "&zwnj;&nbsp;".repeat(80)
  return `<span style="display:none;font-size:1px;color:#fafaf6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(text)}${padding}</span>`
}

interface EmailShellOptions {
  content: string
  orderLabel?: string
  preheaderText?: string
  isMarketing?: boolean
  unsubscribeUrl?: string
}

function emailShell(opts: EmailShellOptions): string {
  const unsubscribeHtml = opts.isMarketing
    ? `<p style="color: #bbb; font-size: 12px; margin: 12px 0 0;">
        <a href="${opts.unsubscribeUrl || `${getBaseUrl()}/unsubscribe`}" style="color: #999; text-decoration: underline;">Отписване от имейли</a>
      </p>`
    : ""

  const addressHtml = `<p style="color: #ccc; font-size: 11px; margin: 12px 0 0;">${escapeHtml(getSellerAddress())}</p>`

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width" />
  <style>
    body { margin: 0; }
    @media (max-width: 600px) {
      .container { width: 94% !important; }
      .customer-info__item { display: block; width: 100% !important; }
    }
  </style>
</head>
<body style="margin: 0; background-color: #fafaf6;">
  ${opts.preheaderText ? preheader(opts.preheaderText) : ""}
  <table style="height: 100%; width: 100%; border-spacing: 0; border-collapse: collapse;">
    <tr>
      <td style="font-family: ${FONT_STACK};">

        <!-- Header -->
        <table style="width: 100%; border-spacing: 0; border-collapse: collapse; margin: 40px 0 20px;">
          <tr><td style="font-family: ${FONT_STACK};">
            <center>
              <table class="container" style="width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 0 auto;">
                <tr>
                  <td style="font-family: ${FONT_STACK};">
                    <span style="font-size: 20px; font-weight: 500; letter-spacing: 0.35em; text-transform: uppercase; color: ${BRAND_COLOR};">EGG ORIGIN</span>
                  </td>
                  ${opts.orderLabel ? `<td style="font-family: ${FONT_STACK}; text-transform: uppercase; font-size: 14px; color: #999;" align="right">${escapeHtml(opts.orderLabel)}</td>` : ""}
                </tr>
              </table>
            </center>
          </td></tr>
        </table>

        ${opts.content}

        <!-- Footer -->
        <table style="width: 100%; border-spacing: 0; border-collapse: collapse; border-top: 1px solid #e5e5e5;">
          <tr><td style="font-family: ${FONT_STACK}; padding: 40px 0;">
            <center>
              <table class="container" style="width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 0 auto;">
                <tr><td style="font-family: ${FONT_STACK};">
                  <p style="color: #999; line-height: 150%; font-size: 14px; margin: 0;">
                    Ако имате въпроси, свържете се с нас на <a href="mailto:info@eggorigin.com" style="color: ${BRAND_COLOR};">info@eggorigin.com</a>
                  </p>
                  <p style="color: #bbb; font-size: 12px; margin: 20px 0 0;">Egg Origin</p>
                  ${addressHtml}
                  ${unsubscribeHtml}
                </td></tr>
              </table>
            </center>
          </td></tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`
}

function section(inner: string): string {
  return `
  <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
    <tr><td style="font-family: ${FONT_STACK}; padding-bottom: 40px;">
      <center>
        <table class="container" style="width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 0 auto;">
          <tr><td style="font-family: ${FONT_STACK};">${inner}</td></tr>
        </table>
      </center>
    </td></tr>
  </table>`
}

function ctaButton(label: string, url: string): string {
  return `
  <table style="border-spacing: 0; border-collapse: collapse; margin-top: 24px;">
    <tr><td style="font-family: ${FONT_STACK}; border-radius: 4px;" align="center" bgcolor="${BRAND_COLOR}">
      <a href="${escapeHtml(url)}" style="font-size: 16px; text-decoration: none; display: block; text-align: center; color: #fff; padding: 16px 32px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`
}

function itemRowsHtml(items: OrderItem[], baseUrl: string, showPrice = true): string {
  return items
    .map((item) => {
      const imageUrl = getProductImageUrl(item.productId, baseUrl)
      const lineTotal = item.priceInCents * item.quantity
      const safeName = escapeHtml(item.productName)
      return `
      <tr style="border-top: 1px solid #e5e5e5;">
        <td style="font-family: ${FONT_STACK}; padding: 16px 0;" valign="middle">
          <table style="border-spacing: 0; border-collapse: collapse;">
            <tr>
              <td style="font-family: ${FONT_STACK};" valign="middle">
                <img src="${escapeHtml(imageUrl)}" alt="${safeName}" width="60" height="60" style="margin-right: 15px; border-radius: 8px; border: 1px solid #e5e5e5;" />
              </td>
              <td style="font-family: ${FONT_STACK}; width: 100%;">
                <span style="font-size: 16px; font-weight: 600; line-height: 1.4; color: #555;">${safeName}&nbsp;&times;&nbsp;${item.quantity}</span>
              </td>
              ${showPrice ? `<td style="font-family: ${FONT_STACK}; white-space: nowrap;" align="right">
                <p style="color: #555; line-height: 150%; font-size: 16px; font-weight: 600; margin: 0 0 0 15px;">${formatPrice(lineTotal)}</p>
              </td>` : ""}
            </tr>
          </table>
        </td>
      </tr>`
    })
    .join("\n")
}

function itemsPlainText(items: OrderItem[]): string {
  return items
    .map((item) => `${item.productName} x ${item.quantity} - ${formatPrice(item.priceInCents * item.quantity)}`)
    .join("\n")
}

function subtotalRow(label: string, value: string, big = false): string {
  return `
    <tr>
      <td style="font-family: ${FONT_STACK}; padding: ${big ? "20px" : "2px"} 0 0;">
        <p style="color: #777; line-height: 1.2em; font-size: 16px; margin: 4px 0 0;">${escapeHtml(label)}</p>
      </td>
      <td style="font-family: ${FONT_STACK}; padding: ${big ? "20px" : "2px"} 0 0;" align="right">
        <strong style="font-size: ${big ? "24px" : "16px"}; color: #555;">${escapeHtml(value)}</strong>
      </td>
    </tr>`
}

// ── 1. Order Confirmation (transactional) ──

export function buildOrderConfirmationEmail(data: OrderEmailData): { html: string; text: string } {
  const baseUrl = getBaseUrl()
  const paidToday = data.paymentMethod === "card" ? data.totalAmount : 0
  const toBePaid = data.paymentMethod === "cod" ? data.totalAmount : 0
  const safeFirstName = escapeHtml(data.firstName)
  const shortId = escapeHtml(data.orderId.slice(0, 8))

  const discountRowHtml =
    data.discountAmount > 0
      ? `<tr>
          <td style="font-family: ${FONT_STACK}; padding: 2px 0;">
            <p style="color: #777; line-height: 1.2em; font-size: 16px; margin: 4px 0 0;">Отстъпка${data.promoCode ? ` (${escapeHtml(data.promoCode)})` : ""}</p>
          </td>
          <td style="font-family: ${FONT_STACK}; padding: 2px 0;" align="right">
            <strong style="font-size: 16px; color: #555;">-${formatPrice(data.discountAmount)}</strong>
          </td>
        </tr>`
      : ""

  const codFeeRowHtml =
    data.codFee > 0
      ? `<tr>
          <td style="font-family: ${FONT_STACK}; padding: 2px 0;">
            <p style="color: #777; line-height: 1.2em; font-size: 16px; margin: 4px 0 0;">Наложен платеж</p>
          </td>
          <td style="font-family: ${FONT_STACK}; padding: 2px 0;" align="right">
            <strong style="font-size: 16px; color: #555;">${formatPrice(data.codFee)}</strong>
          </td>
        </tr>`
      : ""

  const content = `
    ${section(`
      <h2 style="font-weight: normal; font-size: 24px; margin: 0 0 10px;">Благодарим Ви за поръчката!</h2>
      <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;">
        Поръчка <strong>#${shortId}</strong> от ${formatDate(data.date)}<br/>
        Ще получите известие от куриера, когато покупките Ви са на път към Вас.
      </p>
    `)}
    ${section(`
      <h3 style="font-weight: normal; font-size: 20px; margin: 0 0 25px;">Обобщение на поръчката</h3>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        ${itemRowsHtml(data.items, baseUrl)}
      </table>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse; margin-top: 15px; border-top: 1px solid #e5e5e5;">
        <tr>
          <td style="font-family: ${FONT_STACK}; width: 40%;"></td>
          <td style="font-family: ${FONT_STACK};">
            <table style="width: 100%; border-spacing: 0; border-collapse: collapse; margin-top: 20px;">
              ${subtotalRow("Междинна сума", formatPrice(data.subtotal))}
              ${discountRowHtml}
              ${subtotalRow("Доставка", data.shippingFee === 0 ? "Безплатна" : formatPrice(data.shippingFee))}
              ${codFeeRowHtml}
            </table>
            <table style="width: 100%; border-spacing: 0; border-collapse: collapse; margin-top: 20px; border-top: 2px solid #e5e5e5;">
              ${subtotalRow("Обща сума", formatPrice(data.totalAmount), true)}
              ${subtotalRow("Платено днес", formatPrice(paidToday))}
              ${subtotalRow("За плащане при доставка", formatPrice(toBePaid))}
            </table>
          </td>
        </tr>
      </table>
    `)}`

  const html = emailShell({
    content,
    orderLabel: `Поръчка #${data.orderId.slice(0, 8)}`,
    preheaderText: `Поръчка #${data.orderId.slice(0, 8)} — ${formatPrice(data.totalAmount)}`,
  })

  const discountText = data.discountAmount > 0
    ? `\nОтстъпка${data.promoCode ? ` (${data.promoCode})` : ""}: -${formatPrice(data.discountAmount)}`
    : ""
  const codFeeText = data.codFee > 0 ? `\nНаложен платеж: ${formatPrice(data.codFee)}` : ""

  const text = `
Благодарим Ви за поръчката!

Поръчка #${data.orderId.slice(0, 8)} от ${formatDate(data.date)}

Детайли на поръчката:
${itemsPlainText(data.items)}

Междинна сума: ${formatPrice(data.subtotal)}${discountText}
Доставка: ${data.shippingFee === 0 ? "Безплатна" : formatPrice(data.shippingFee)}${codFeeText}

Обща сума: ${formatPrice(data.totalAmount)}
Платено днес: ${formatPrice(paidToday)}
За плащане при доставка: ${formatPrice(toBePaid)}

Ще получите известие от куриера, когато покупките Ви са на път към Вас.

Поздрави,
Екипът на Egg Origin
  `.trim()

  return { html, text }
}

// ── 2. Shipping Notification (transactional) ──

export function buildShippingEmail(data: ShippingEmailData): { html: string; text: string } {
  const baseUrl = getBaseUrl()
  const safeFirstName = escapeHtml(data.firstName)
  const safeCarrier = escapeHtml(data.carrierName)
  const shortId = escapeHtml(data.orderId.slice(0, 8))

  const trackingHtml = data.trackingNumber
    ? `<p style="color: #999; font-size: 14px; margin: 20px 0 0;">${safeCarrier} номер за проследяване: <strong style="color: #555;">${escapeHtml(data.trackingNumber)}</strong></p>`
    : ""

  const content = `
    ${section(`
      <h2 style="font-weight: normal; font-size: 24px; margin: 0 0 10px;">Поръчката Ви е на път!</h2>
      <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;">
        Здравейте ${safeFirstName}, Вашата поръчка <strong>#${shortId}</strong> е изпратена с ${safeCarrier}.<br/>
        Ще получите известие от куриера за доставката.
      </p>
      ${trackingHtml}
    `)}
    ${section(`
      <h3 style="font-weight: normal; font-size: 20px; margin: 0 0 25px;">Продукти в тази пратка</h3>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        ${itemRowsHtml(data.items, baseUrl, false)}
      </table>
    `)}`

  const html = emailShell({
    content,
    orderLabel: `Поръчка #${data.orderId.slice(0, 8)}`,
    preheaderText: `Поръчка #${data.orderId.slice(0, 8)} е изпратена с ${data.carrierName}`,
  })

  const trackingText = data.trackingNumber
    ? `\n${data.carrierName} номер за проследяване: ${data.trackingNumber}\n`
    : ""

  const text = `
Поръчката Ви е на път!

Здравейте ${data.firstName}, Вашата поръчка #${data.orderId.slice(0, 8)} е изпратена с ${data.carrierName}.
${trackingText}
Продукти:
${itemsPlainText(data.items)}

Ще получите известие от куриера за доставката.

Поздрави,
Екипът на Egg Origin
  `.trim()

  return { html, text }
}

// ── 3. Delivery Confirmation (transactional) ──

export function buildDeliveryEmail(data: DeliveryEmailData): { html: string; text: string } {
  const baseUrl = getBaseUrl()
  const safeFirstName = escapeHtml(data.firstName)
  const shortId = escapeHtml(data.orderId.slice(0, 8))

  const content = `
    ${section(`
      <h2 style="font-weight: normal; font-size: 24px; margin: 0 0 10px;">Поръчката Ви е доставена!</h2>
      <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;">
        Здравейте ${safeFirstName}, Вашата поръчка <strong>#${shortId}</strong> е доставена успешно.
      </p>
      <p style="color: #999; font-size: 14px; margin: 16px 0 0;">
        Още не сте получили пратката си? Свържете се с нас на <a href="mailto:info@eggorigin.com" style="color: ${BRAND_COLOR};">info@eggorigin.com</a>
      </p>
    `)}
    ${section(`
      <h3 style="font-weight: normal; font-size: 20px; margin: 0 0 25px;">Артикули в тази пратка</h3>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        ${itemRowsHtml(data.items, baseUrl, false)}
      </table>
      ${ctaButton("Посетете нашия магазин", utmUrl(baseUrl, "delivery", "cta"))}
    `)}`

  const html = emailShell({
    content,
    orderLabel: `Поръчка #${data.orderId.slice(0, 8)}`,
    preheaderText: `Поръчка #${data.orderId.slice(0, 8)} е доставена успешно`,
  })

  const text = `
Поръчката Ви е доставена!

Здравейте ${data.firstName}, Вашата поръчка #${data.orderId.slice(0, 8)} е доставена успешно.

Артикули:
${itemsPlainText(data.items)}

Още не сте получили пратката си? Свържете се с нас на info@eggorigin.com

Поздрави,
Екипът на Egg Origin
  `.trim()

  return { html, text }
}

// ── 4. Post-delivery Review / Feedback (marketing — requires unsubscribe) ──

export function buildReviewRequestEmail(data: ReviewEmailData): { html: string; text: string } {
  const baseUrl = getBaseUrl()
  const safeFirstName = escapeHtml(data.firstName)
  const productNames = data.items.map((i) => escapeHtml(i.productName)).join(", ")

  const content = `
    ${section(`
      <h2 style="font-weight: normal; font-size: 24px; margin: 0 0 10px;">Как Ви се стори?</h2>
      <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;">
        Здравейте ${safeFirstName}, надяваме се, че се наслаждавате на Вашата поръчка!<br/><br/>
        Ще се радваме да чуем мнението Ви за ${productNames}. Вашият отзив ни помага да ставаме по-добри и помага на други хора да направят своя избор.
      </p>
      ${ctaButton("Оставете отзив", utmUrl(`${baseUrl}/contact`, "review_request", "cta"))}
    `)}
    ${section(`
      <h3 style="font-weight: normal; font-size: 20px; margin: 0 0 25px;">Вашата поръчка</h3>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        ${itemRowsHtml(data.items, baseUrl, false)}
      </table>
    `)}`

  const html = emailShell({
    content,
    orderLabel: `Поръчка #${data.orderId.slice(0, 8)}`,
    preheaderText: `Как Ви се стори поръчката от Egg Origin?`,
    isMarketing: true,
  })

  const rawProductNames = data.items.map((i) => i.productName).join(", ")
  const text = `
Как Ви се стори?

Здравейте ${data.firstName}, надяваме се, че се наслаждавате на Вашата поръчка!

Ще се радваме да чуем мнението Ви за ${rawProductNames}. Вашият отзив ни помага да ставаме по-добри и помага на други хора да направят своя избор.

Оставете отзив: ${utmUrl(`${baseUrl}/contact`, "review_request", "cta")}

Отписване: ${baseUrl}/unsubscribe

Поздрави,
Екипът на Egg Origin
  `.trim()

  return { html, text }
}

// ── 5. Cross-sell / Repeat Purchase (marketing — requires unsubscribe) ──

export function buildCrossSellEmail(data: CrossSellEmailData): { html: string; text: string } {
  const baseUrl = getBaseUrl()
  const safeFirstName = escapeHtml(data.firstName)

  // Recommend products the customer hasn't purchased
  const recommended = PRODUCTS.filter((p) => !data.purchasedProductIds.includes(p.id))
  // Fall back to all products if they've bought everything
  const productsToShow = recommended.length > 0 ? recommended : PRODUCTS

  const productCardsHtml = productsToShow
    .map((product) => {
      const imageUrl = `${baseUrl}${product.image}`
      const productUrl = utmUrl(`${baseUrl}/products/${product.slug}`, "cross_sell", "product")
      const safeName = escapeHtml(product.name)
      const safeDesc = escapeHtml(product.shortDescription.slice(0, 80))
      return `
      <tr style="border-top: 1px solid #e5e5e5;">
        <td style="font-family: ${FONT_STACK}; padding: 16px 0;" valign="middle">
          <table style="border-spacing: 0; border-collapse: collapse;">
            <tr>
              <td style="font-family: ${FONT_STACK};" valign="middle">
                <a href="${escapeHtml(productUrl)}">
                  <img src="${escapeHtml(imageUrl)}" alt="${safeName}" width="80" height="80" style="margin-right: 15px; border-radius: 8px; border: 1px solid #e5e5e5;" />
                </a>
              </td>
              <td style="font-family: ${FONT_STACK}; width: 100%;">
                <a href="${escapeHtml(productUrl)}" style="text-decoration: none;">
                  <span style="font-size: 16px; font-weight: 600; line-height: 1.4; color: #555;">${safeName}</span>
                </a>
                <p style="color: #777; font-size: 14px; margin: 4px 0 0; line-height: 1.4;">${safeDesc}...</p>
              </td>
              <td style="font-family: ${FONT_STACK}; white-space: nowrap;" align="right">
                <p style="color: ${BRAND_COLOR}; font-size: 16px; font-weight: 600; margin: 0 0 0 15px;">${formatPrice(product.priceInCents)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    })
    .join("\n")

  const content = `
    ${section(`
      <h2 style="font-weight: normal; font-size: 24px; margin: 0 0 10px;">Време е за презареждане!</h2>
      <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;">
        Здравейте ${safeFirstName}, надяваме се, че Ви хареса поръчката!<br/><br/>
        Ето какво друго можете да опитате:
      </p>
    `)}
    ${section(`
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        ${productCardsHtml}
      </table>
      ${ctaButton("Разгледайте продуктите", utmUrl(`${baseUrl}/products`, "cross_sell", "cta"))}
    `)}`

  const html = emailShell({
    content,
    preheaderText: "Време е за презареждане! Вижте нови продукти от Egg Origin.",
    isMarketing: true,
  })

  const productListText = productsToShow
    .map((p) => `- ${p.name} — ${formatPrice(p.priceInCents)}\n  ${utmUrl(`${baseUrl}/products/${p.slug}`, "cross_sell", "product")}`)
    .join("\n")

  const text = `
Време е за презареждане!

Здравейте ${data.firstName}, надяваме се, че Ви хареса поръчката!

Ето какво друго можете да опитате:

${productListText}

Разгледайте продуктите: ${utmUrl(`${baseUrl}/products`, "cross_sell", "cta")}

Отписване: ${baseUrl}/unsubscribe

Поздрави,
Екипът на Egg Origin
  `.trim()

  return { html, text }
}

// ── 6. Abandoned Cart (marketing — requires unsubscribe) ──

export function buildAbandonedCartEmail(data: AbandonedCartEmailData): { html: string; text: string } {
  const baseUrl = getBaseUrl()

  const safeGreeting = data.firstName
    ? `Здравейте ${escapeHtml(data.firstName)}, забелязахме`
    : "Забелязахме"

  const content = `
    ${section(`
      <h2 style="font-weight: normal; font-size: 24px; margin: 0 0 10px;">Забравихте нещо?</h2>
      <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;">
        ${safeGreeting}, че не завършихте поръчката си. Артикулите Ви все още Ви чакат!
      </p>
    `)}
    ${section(`
      <h3 style="font-weight: normal; font-size: 20px; margin: 0 0 25px;">Вашата количка</h3>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse;">
        ${itemRowsHtml(data.items, baseUrl)}
      </table>
      <table style="width: 100%; border-spacing: 0; border-collapse: collapse; margin-top: 15px; border-top: 2px solid #e5e5e5;">
        <tr>
          <td style="font-family: ${FONT_STACK}; width: 40%;"></td>
          <td style="font-family: ${FONT_STACK};">
            <table style="width: 100%; border-spacing: 0; border-collapse: collapse; margin-top: 20px;">
              ${subtotalRow("Обща сума", formatPrice(data.totalAmount), true)}
            </table>
          </td>
        </tr>
      </table>
      ${ctaButton("Завършете поръчката", utmUrl(`${baseUrl}/cart`, "abandoned_cart", "cta"))}
    `)}`

  const html = emailShell({
    content,
    preheaderText: "Артикулите Ви все още Ви чакат в количката!",
    isMarketing: true,
  })

  const plainGreeting = data.firstName
    ? `Здравейте ${data.firstName}, забелязахме`
    : "Забелязахме"

  const text = `
Забравихте нещо?

${plainGreeting}, че не завършихте поръчката си. Артикулите Ви все още Ви чакат!

Вашата количка:
${itemsPlainText(data.items)}

Обща сума: ${formatPrice(data.totalAmount)}

Завършете поръчката: ${utmUrl(`${baseUrl}/cart`, "abandoned_cart", "cta")}

Отписване: ${baseUrl}/unsubscribe

Поздрави,
Екипът на Egg Origin
  `.trim()

  return { html, text }
}
