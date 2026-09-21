export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background px-6 py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
        <div className="prose prose-invert max-w-none text-muted-foreground space-y-4 text-sm leading-relaxed">
          <p>Seltra is a platform that enables merchants to create and operate AI-generated online stores. By using Seltra, you agree to these terms.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">Use of Service</h2>
          <p>You may use Seltra to create and manage storefronts for legitimate commercial purposes. You are responsible for the content of your store and compliance with local laws.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">Payments</h2>
          <p>Payment processing is handled by Moolre. Seltra is not responsible for payment disputes, but we assist in instant resolution and payment reliability. A platform fee applies to each transaction.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">Data</h2>
          <p>We store your store data, product catalog, and order information to operate the platform. We do not sell your data to third parties.</p>
          <h2 className="text-foreground text-lg font-semibold mt-6">Contact</h2>
          <p>For questions: hello@seltra.co</p>
        </div>
      </div>
    </div>
  )
}