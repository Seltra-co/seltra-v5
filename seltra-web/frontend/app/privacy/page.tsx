export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background px-6 py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
        <div className="prose prose-invert max-w-none text-muted-foreground space-y-4 text-sm leading-relaxed">
          <p>Seltra collects only the information needed to operate your store: your email, store details, products, and order data.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">What we collect</h2>
          <p>Account email, store name and configuration, product catalog, order and customer data from your store buyers.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">How we use it</h2>
          <p>To operate your storefront, process orders, and improve the platform. We never sell your data.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">Third parties</h2>
          <p>Moolre processes payments. No advertising networks have access to your data.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">Contact</h2>
          <p>hello@seltra.co</p>
        </div>
      </div>
    </div>
  )
}
