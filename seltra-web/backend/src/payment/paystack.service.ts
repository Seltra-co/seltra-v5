//seltra/backend/src/payment/paystack.service.ts

import { Injectable } from '@nestjs/common'

type InitializeParams = {
  email: string
  amount: number
  reference: string
  currency?: string
  callback_url?: string
  metadata?: Record<string, unknown>
}

export type PaystackVerifyResponse = {
  status: boolean
  message: string
  data?: {
    status?: string
    reference?: string
    amount?: number
    currency?: string
    customer?: {
      email?: string
      first_name?: string
      last_name?: string
    }
    metadata?: Record<string, unknown>
  }
}

@Injectable()
export class PaystackService {
  private readonly baseUrl = 'https://api.paystack.co'

  private headers() {
    return {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || ''}`,
      'Content-Type': 'application/json',
    }
  }

  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: this.headers(),
    })
    return res.json()
  }

  async initializeTransaction(params: InitializeParams): Promise<{
    authorization_url: string
    access_code?: string
    reference: string
  }> {
    const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(params),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.status) {
      throw new Error(data?.message || 'Could not initialize Paystack transaction')
    }
    return {
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference || params.reference,
    }
  }

  async listTransactions(page = 1, perPage = 50) {
    const url = new URL(`${this.baseUrl}/transaction`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', String(perPage))
    const res = await fetch(url, { headers: this.headers() })
    return res.json()
  }
}
