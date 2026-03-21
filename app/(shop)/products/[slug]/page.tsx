import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PRODUCTS, getProductBySlug } from "@/lib/products"
import { getProductsWithSales } from "@/lib/sales"
import { ProductDetail } from "@/components/products/product-detail"

export const revalidate = 60

interface ProductPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return PRODUCTS.map((product) => ({
    slug: product.slug,
  }))
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params
  const product = getProductBySlug(slug)

  if (!product) {
    return { title: "Продуктът не е намерен - Ovva Sculpt" }
  }

  return {
    title: `${product.name} - Ovva Sculpt`,
    description: product.shortDescription,
    openGraph: {
      title: `${product.name} - Ovva Sculpt`,
      description: product.shortDescription,
      images: product.images,
    },
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params
  const products = await getProductsWithSales()
  const product = products.find((p) => p.slug === slug)

  if (!product) {
    notFound()
  }

  const otherProducts = products.filter((p) => p.id !== product.id)

  return <ProductDetail product={product} otherProducts={otherProducts} />
}
