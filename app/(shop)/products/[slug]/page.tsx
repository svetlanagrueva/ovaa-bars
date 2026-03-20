import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getProductBySlug, PRODUCTS } from "@/lib/products"
import { ProductDetail } from "@/components/products/product-detail"

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
  const product = getProductBySlug(slug)

  if (!product) {
    notFound()
  }

  const otherProducts = PRODUCTS.filter((p) => p.id !== product.id)

  return <ProductDetail product={product} otherProducts={otherProducts} />
}
