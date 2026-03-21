export interface Product {
  id: string
  slug: string
  name: string
  shortDescription: string
  fullDescription: string
  priceInCents: number
  originalPriceInCents?: number // set when product is on sale (must be lowest price in last 30 days per EU Omnibus Directive)
  image: string
  images: string[]
  badge?: string
  boxContents: string
  barsCount: number
  nutritionHighlights: string[]
  nutritionFacts: {
    calories: number
    protein: number
    carbs: number
    sugar: number
    fat: number
    fiber: number
  }
  ingredients: string[]
  benefits: string[]
}

export const PRODUCTS: Product[] = [
  {
    id: 'egg-origin-dark-chocolate-box',
    slug: 'dark-chocolate-box',
    name: 'Тъмен Шоколад Кутия',
    shortDescription: 'Кутия от 12 протеинови бара с тъмен шоколад. Наситен какаов вкус с пълноценен яйчен протеин.',
    fullDescription: `Насладете се на интензивния, наситен вкус на висококачествен тъмен шоколад, докато зареждате тялото си с пълноценен протеин. Всеки бар Egg Origin Тъмен Шоколад съдържа 20g яйчен протеин - пълноценен животински протеин с всички есенциални аминокиселини, от които тялото ви се нуждае.

За разлика от суроватъчните протеинови барове, които могат да причинят подуване и храносмилателен дискомфорт, нашата формула с яйчен белтък е щадяща за стомаха и лесна за смилане. Перфектна за ежедневна употреба - след тренировка, като следобедна закуска или когато имате нужда от продължителна енергия.

Тази кутия съдържа 12 индивидуално опаковани бара - вашият месечен запас от чист, функционален протеин.`,
    priceInCents: 2570, // 25.70 EUR
    image: '/images/dark-chocolate-bar.png',
    images: ['/images/dark-chocolate-bar.png'],
    badge: 'Бестселър',
    boxContents: '12 x бара Тъмен Шоколад',
    barsCount: 12,
    nutritionHighlights: ['20g Протеин', 'Ниска Захар', 'Чиста Етикета'],
    nutritionFacts: {
      calories: 195,
      protein: 20,
      carbs: 15,
      sugar: 2,
      fat: 7,
      fiber: 4,
    },
    ingredients: [
      'Яйчен протеин',
      'Тъмен шоколадов кувертюр (какаова маса, какаово масло, подсладител)',
      'Цикориеви фибри',
      'Бадеми',
      'Натурални аромати',
      'Морска сол',
    ],
    benefits: [
      'Пълноценен протеин с всички есенциални аминокиселини',
      'Без суроватка, без подуване',
      'Формула с ниско съдържание на захар',
      'Чиста етикета - без излишни съставки',
      'Перфектен за ежедневна употреба',
    ],
  },
  {
    id: 'egg-origin-white-chocolate-raspberry-box',
    slug: 'white-chocolate-raspberry-box',
    name: 'Бял Шоколад с Малини Кутия',
    shortDescription: 'Кутия от 12 протеинови бара с бял шоколад и малини. Нежна сладост с истински парченца малини.',
    fullDescription: `Изживейте перфектния баланс между кремообразен бял шоколад и свежи малини във всяка хапка. Всеки бар Egg Origin Бял Шоколад с Малини е създаден с 20g яйчен протеин - най-пълноценният природен източник на протеин.

Нежната сладост на белия шоколад се съчетава прекрасно с истински лиофилизирани парченца малини, създавайки вкус, който е едновременно изкусителен и хранителен. Нашата формула с яйчен протеин осигурява лесно смилане без дискомфорта, често свързван със суроватъчни продукти.

Тази кутия съдържа 12 индивидуално опаковани бара - идеални за вкъщи, в офиса или в спортната чанта.`,
    priceInCents: 2570, // 25.70 EUR
    image: '/images/white-chocolate-raspberry-bar.png',
    images: ['/images/white-chocolate-raspberry-bar.png'],
    badge: 'Ново',
    boxContents: '12 x бара Бял Шоколад с Малини',
    barsCount: 12,
    nutritionHighlights: ['20g Протеин', 'Ниска Захар', 'Чиста Етикета'],
    nutritionFacts: {
      calories: 190,
      protein: 20,
      carbs: 14,
      sugar: 2,
      fat: 6,
      fiber: 4,
    },
    ingredients: [
      'Яйчен протеин',
      'Бял шоколадов кувертюр (какаово масло, мляко на прах, подсладител)',
      'Лиофилизирани малини',
      'Цикориеви фибри',
      'Натурални аромати',
      'Морска сол',
    ],
    benefits: [
      'Пълноценен протеин с всички есенциални аминокиселини',
      'Истински лиофилизирани малини',
      'Без суроватка, без подуване',
      'Формула с ниско съдържание на захар',
      'Лесно смилане',
    ],
  },
  {
    id: 'egg-origin-mix-box',
    slug: 'mix-box',
    name: 'Микс Кутия',
    shortDescription: 'Кутия от 12 смесени бара - 6 Тъмен Шоколад + 6 Бял Шоколад с Малини. Най-доброто от двата вкуса.',
    fullDescription: `Не можете да решите между наситения тъмен шоколад и нежния бял шоколад с малини? Вземете най-доброто от двата вкуса с нашата Микс Кутия. Този разнообразен пакет включва 6 бара Тъмен Шоколад и 6 бара Бял Шоколад с Малини - перфектен за да откриете любимия си вкус или да внесете разнообразие.

И двата вкуса са създадени с 20g висококачествен яйчен протеин на бар, доставяйки пълноценно хранене без суроватка, без подуване и без излишни съставки. Независимо дали предпочитате интензивното удоволствие от тъмния шоколад или плодовата сладост на белия шоколад с малини, тази кутия ви предлага и двете.

Перфектното въведение в Egg Origin или чудесен начин да споделите с приятели и семейство.`,
    priceInCents: 2570, // 25.70 EUR
    image: '/images/dark-chocolate-bar.png',
    images: ['/images/dark-chocolate-bar.png', '/images/white-chocolate-raspberry-bar.png'],
    badge: 'Популярен',
    boxContents: '6 x Тъмен Шоколад + 6 x Бял Шоколад с Малини',
    barsCount: 12,
    nutritionHighlights: ['20g Протеин', 'Ниска Захар', 'Чиста Етикета'],
    nutritionFacts: {
      calories: 192,
      protein: 20,
      carbs: 14,
      sugar: 2,
      fat: 6,
      fiber: 4,
    },
    ingredients: [
      'Яйчен протеин',
      'Тъмен шоколадов кувертюр',
      'Бял шоколадов кувертюр',
      'Лиофилизирани малини',
      'Цикориеви фибри',
      'Натурални аромати',
      'Морска сол',
    ],
    benefits: [
      'Опитайте и двата вкуса',
      'Пълноценен протеин с всички есенциални аминокиселини',
      'Без суроватка, без подуване',
      'Перфектен за споделяне',
      'Съставки с чиста етикета',
    ],
  },
]

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id)
}

export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug)
}

export function formatPrice(priceInCents: number): string {
  return (priceInCents / 100).toFixed(2).replace(".", ",") + " €"
}

export function isOnSale(product: Product): boolean {
  return (
    product.originalPriceInCents !== undefined &&
    product.originalPriceInCents > product.priceInCents
  )
}

export function getDiscountPercentage(product: Product): number {
  if (!isOnSale(product)) return 0
  return Math.round(
    ((product.originalPriceInCents! - product.priceInCents) /
      product.originalPriceInCents!) *
      100
  )
}
