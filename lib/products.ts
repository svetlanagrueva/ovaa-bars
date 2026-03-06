export interface Product {
  id: string
  slug: string
  name: string
  shortDescription: string
  fullDescription: string
  priceInCents: number
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
    id: 'ovva-dark-chocolate-box',
    slug: 'dark-chocolate-box',
    name: 'Dark Chocolate Box',
    shortDescription: 'Box of 12 Dark Chocolate protein bars. Rich cocoa flavor with complete egg white protein.',
    fullDescription: `Indulge in the intense, satisfying taste of premium dark chocolate while fueling your body with complete protein. Each Ovva Sculpt Dark Chocolate bar delivers 20g of egg white protein - a complete animal protein containing all essential amino acids your body needs.

Unlike whey protein bars that can cause bloating and digestive discomfort, our egg white formula is gentle on your stomach and easy to digest. Perfect for everyday use, whether after a workout, as a mid-day snack, or when you need sustained energy.

This box contains 12 individually wrapped bars - your month's supply of clean, functional protein.`,
    priceInCents: 5999, // 59.99 BGN
    image: '/images/dark-chocolate-bar.png',
    images: ['/images/dark-chocolate-bar.png'],
    badge: 'Bestseller',
    boxContents: '12 x Dark Chocolate bars',
    barsCount: 12,
    nutritionHighlights: ['20g Protein', 'Low Sugar', 'Clean Label'],
    nutritionFacts: {
      calories: 195,
      protein: 20,
      carbs: 15,
      sugar: 2,
      fat: 7,
      fiber: 4,
    },
    ingredients: [
      'Egg white protein',
      'Dark chocolate coating (cocoa mass, cocoa butter, sweetener)',
      'Chicory root fiber',
      'Almonds',
      'Natural flavors',
      'Sea salt',
    ],
    benefits: [
      'Complete protein with all essential amino acids',
      'No whey, no bloating',
      'Low sugar formula',
      'Clean label - no unnecessary ingredients',
      'Perfect for everyday use',
    ],
  },
  {
    id: 'ovva-white-chocolate-raspberry-box',
    slug: 'white-chocolate-raspberry-box',
    name: 'White Chocolate Raspberry Box',
    shortDescription: 'Box of 12 White Chocolate Raspberry protein bars. Delicate sweetness with real raspberry pieces.',
    fullDescription: `Experience the perfect balance of creamy white chocolate and tangy raspberry in every bite. Each Ovva Sculpt White Chocolate Raspberry bar is crafted with 20g of egg white protein - nature's most complete protein source.

The delicate sweetness of white chocolate pairs beautifully with real freeze-dried raspberry pieces, creating a taste that feels indulgent yet delivers serious nutrition. Our egg white protein formula ensures easy digestion without the discomfort often associated with whey-based products.

This box contains 12 individually wrapped bars - ideal for keeping at home, at the office, or in your gym bag.`,
    priceInCents: 5999, // 59.99 BGN
    image: '/images/white-chocolate-raspberry-bar.png',
    images: ['/images/white-chocolate-raspberry-bar.png'],
    badge: 'New',
    boxContents: '12 x White Chocolate Raspberry bars',
    barsCount: 12,
    nutritionHighlights: ['20g Protein', 'Low Sugar', 'Clean Label'],
    nutritionFacts: {
      calories: 190,
      protein: 20,
      carbs: 14,
      sugar: 2,
      fat: 6,
      fiber: 4,
    },
    ingredients: [
      'Egg white protein',
      'White chocolate coating (cocoa butter, milk powder, sweetener)',
      'Freeze-dried raspberries',
      'Chicory root fiber',
      'Natural flavors',
      'Sea salt',
    ],
    benefits: [
      'Complete protein with all essential amino acids',
      'Real freeze-dried raspberries',
      'No whey, no bloating',
      'Low sugar formula',
      'Gentle on digestion',
    ],
  },
  {
    id: 'ovva-mix-box',
    slug: 'mix-box',
    name: 'Mix Box',
    shortDescription: 'Box of 12 mixed bars - 6 Dark Chocolate + 6 White Chocolate Raspberry. Best of both worlds.',
    fullDescription: `Can't decide between rich dark chocolate and delicate white chocolate raspberry? Get the best of both worlds with our Mix Box. This variety pack includes 6 Dark Chocolate bars and 6 White Chocolate Raspberry bars - perfect for discovering your favorite or keeping things interesting.

Both flavors are crafted with 20g of premium egg white protein per bar, delivering complete nutrition without whey, without bloating, and without unnecessary ingredients. Whether you prefer the intense satisfaction of dark chocolate or the fruity sweetness of white chocolate raspberry, this box has you covered.

The perfect introduction to Ovva Sculpt or a great way to share with friends and family.`,
    priceInCents: 5999, // 59.99 BGN
    image: '/images/dark-chocolate-bar.png',
    images: ['/images/dark-chocolate-bar.png', '/images/white-chocolate-raspberry-bar.png'],
    badge: 'Popular',
    boxContents: '6 x Dark Chocolate + 6 x White Chocolate Raspberry bars',
    barsCount: 12,
    nutritionHighlights: ['20g Protein', 'Low Sugar', 'Clean Label'],
    nutritionFacts: {
      calories: 192,
      protein: 20,
      carbs: 14,
      sugar: 2,
      fat: 6,
      fiber: 4,
    },
    ingredients: [
      'Egg white protein',
      'Dark chocolate coating',
      'White chocolate coating',
      'Freeze-dried raspberries',
      'Chicory root fiber',
      'Natural flavors',
      'Sea salt',
    ],
    benefits: [
      'Try both flavors',
      'Complete protein with all essential amino acids',
      'No whey, no bloating',
      'Perfect for sharing',
      'Clean label ingredients',
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
  return `${(priceInCents / 100).toFixed(2)} лв.`
}
