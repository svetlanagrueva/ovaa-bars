export default function CheckoutLoading() {
  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="animate-pulse">
          <div className="h-8 w-48 rounded bg-secondary" />
          <div className="mt-8 h-96 rounded-lg bg-secondary" />
        </div>
      </div>
    </div>
  )
}
