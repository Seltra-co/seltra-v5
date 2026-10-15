//seltra-merchant-v5/frontend/app/apply/page.tsx
import type { Metadata } from 'next'
import { SignupFlow } from '@/components/marketing/SignupFlow'
import { publicAsset } from '@/lib/public-asset'
import { pageMeta } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Create your account | Seltra',
  description: 'Create your Seltra merchant account and launch your online store.',
}

export default function MerchantApplyPage() {
  return (
    <SignupFlow
      formPhoto={publicAsset('/seltra/signup/signup.png')}
      donePhoto={publicAsset('/seltra/signup/complete.png')}
    />
  )
}
