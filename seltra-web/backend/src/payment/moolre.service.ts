//seltra/backend/src/payment/moolre.service.ts
import { Injectable } from '@nestjs/common'

const MOOLRE_BASE = process.env.MOOLRE_SANDBOX === 'true'
  ? 'https://sandbox.moolre.com'
  : 'https://api.moolre.com'

export type MoolrePaymentLinkResponse = {
  success: boolean
  paymentUrl?: string
  reference: string
  moolreId?: string
  error?: string
}

export type MoolreStatusResponse = {
  success: boolean
  status?: 'pending' | 'success' | 'failed'
  txstatus?: number
  transactionid?: string
  externalref?: string
  amount?: string
  error?: string
}

export type MoolreWebhookBody = {
  status: number
  code: string
  message: string
  data?: {
    txstatus?: number
    txtype?: number
    accountnumber?: string
    payer?: string
    payee?: string
    amount?: string
    value?: string
    txid?: string          
    reference?: string 
    transactionid?: string
    externalref?: string
    thirdpartyref?: string
    ts?: string
    customerEmail?: string
    customerName?: string
    metadata?: string
  }
}

export type MoolreTransferResponse = {
  success: boolean
  transactionid?: string
  externalref?: string
  receivername?: string
  raw?: unknown
  error?: string
  testMode?: boolean
}

@Injectable()
export class MoolreService {
  private readonly apiUser = process.env.MOOLRE_API_USER || ''
  private readonly apiKey = process.env.MOOLRE_API_KEY || ''
  private readonly apiPubKey = process.env.MOOLRE_API_PUBKEY || ''
  private readonly accountNumber = process.env.MOOLRE_ACCOUNT_NUMBER || ''
  private readonly businessEmail = process.env.MOOLRE_BUSINESS_EMAIL || process.env.MOOLRE_API_USER || ''
  private readonly smsSender = process.env.MOOLRE_SMS_SENDER || 'Seltra'
  private readonly vasKey =
    process.env.MOOLRE_VAS_KEY ||
    process.env.MOOLRE_SMS_VAS_KEY ||
    process.env.MOOLRE_VASKEY ||
    process.env.VAS_KEY ||
    ''

  // NOTE: previously these headers were gated on `MOOLRE_SANDBOX !== 'true'`,
  // which meant if MOOLRE_SANDBOX wasn't the exact string 'true' (or was unset
  // in a non-sandbox deployment) AND the key env vars were also missing/blank,
  // requests silently went out with NO auth headers at all. Moolre then
  // correctly rejects them with "Authentication Error". Fixed to always send
  // whatever keys are actually configured, independent of the sandbox flag.
  private publicHeaders() {
    const headers: Record<string, string> = {
      'X-API-USER': this.apiUser,
      'Content-Type': 'application/json',
    }
    if (this.apiPubKey) headers['X-API-PUBKEY'] = this.apiPubKey
    return headers
  }

  private privateHeaders() {
    const headers: Record<string, string> = {
      'X-API-USER': this.apiUser,
      'Content-Type': 'application/json',
    }
    if (this.apiKey) headers['X-API-KEY'] = this.apiKey
    return headers
  }

  private smsHeaders() {
    return {
      'X-API-VASKEY': this.vasKey,
      'Content-Type': 'application/json',
    }
  }

  private logMissingCredentials(context: string) {
    const missing: string[] = []
    if (!this.apiUser) missing.push('MOOLRE_API_USER')
    if (!this.apiKey) missing.push('MOOLRE_API_KEY')
    if (!this.accountNumber) missing.push('MOOLRE_ACCOUNT_NUMBER')
    if (missing.length) {
      console.warn(`[Moolre] ${context} — missing env vars: ${missing.join(', ')}`)
    }
  }

  /**
   * Generate a hosted Moolre POS payment link.
   * Endpoint: POST /embed/link
   * Returns authorization_url like https://pos.moolre.com/xxxxx
   */
  async generatePaymentLink(params: {
    amount: number
    reference: string
    callbackUrl: string
    redirectUrl?: string
  }): Promise<MoolrePaymentLinkResponse> {
    try {
      const body = {
        type: 1,
        amount: String(params.amount),
        email: this.businessEmail,
        externalref: params.reference,
        callback: params.callbackUrl,
        redirect: params.redirectUrl || params.callbackUrl,
        reusable: '0',
        currency: 'GHS',
        accountnumber: this.accountNumber,
      }

      console.log('[Moolre] generatePaymentLink request:', JSON.stringify({ ...body, accountnumber: '***' }))

      const res = await fetch(`${MOOLRE_BASE}/embed/link`, {
        method: 'POST',
        headers: this.publicHeaders(),
        body: JSON.stringify(body),
      })

      const raw = await res.json().catch(() => null)
      console.log('[Moolre] generatePaymentLink response:', JSON.stringify(raw))

      if (!raw || raw.status !== 1) {
        this.logMissingCredentials('generatePaymentLink')
        return {
          success: false,
          reference: params.reference,
          error: raw?.message || `Moolre payment link generation failed (code: ${raw?.code})`,
        }
      }

      // Response: { status:1, code:"POS09", data: { authorization_url, reference } }
      const paymentUrl = raw.data?.authorization_url as string | undefined

      if (!paymentUrl) {
        return {
          success: false,
          reference: params.reference,
          error: 'Moolre returned success but no authorization_url in response',
        }
      }

      return {
        success: true,
        paymentUrl,
        reference: raw.data?.reference || params.reference,
        moolreId: raw.data?.reference,
      }
    } catch (err) {
      console.error('[Moolre] generatePaymentLink error:', err)
      return {
        success: false,
        reference: params.reference,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  /**
   * Check payment status by externalref.
   * Endpoint: POST /open/transact/status
   */
  async checkPaymentStatus(externalref: string): Promise<MoolreStatusResponse> {
    try {
      const res = await fetch(`${MOOLRE_BASE}/open/transact/status`, {
        method: 'POST',
        headers: this.privateHeaders(),
        body: JSON.stringify({
          type: 1,
          idtype: '1', // 1 = externalref
          id: externalref,
          accountnumber: this.accountNumber,
        }),
      })

      const raw = await res.json().catch(() => null)
      console.log('[Moolre] checkPaymentStatus response:', JSON.stringify(raw))

      if (!raw || raw.status !== 1) {
        this.logMissingCredentials('checkPaymentStatus')
        return {
          success: false,
          status: 'pending', // treat unknown as pending, not failed
          error: raw?.message || 'Status check failed',
        }
      }

      const txstatus = raw.data?.txstatus as number | undefined
      // txstatus: 1=success, 2=failed, 0/undefined=pending
      const mappedStatus =
        txstatus === 1 ? 'success' : txstatus === 2 ? 'failed' : 'pending'

      return {
        success: true,
        status: mappedStatus,
        txstatus,
        transactionid: raw.data?.transactionid,
        externalref: raw.data?.externalref,
        amount: raw.data?.amount,
      }
    } catch (err) {
      console.error('[Moolre] checkPaymentStatus error:', err)
      return {
        success: false,
        status: 'pending',
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  private normalizeSmsRecipient(to: string) {
    const digits = to.replace(/[^\d]/g, '')
    if (!digits) return ''
    if (digits.startsWith('2330') && digits.length === 13) {
      return `233${digits.slice(4)}`
    }
    if (digits.startsWith('0') && digits.length === 10) {
      return `233${digits.slice(1)}`
    }
    if (digits.length === 9) {
      return `233${digits}`
    }
    return digits
  }

  async sendSms(params: { to?: string | null; message: string }) {
    if (!params.to) return { success: false, skipped: true, error: 'Missing phone number' }
    if (process.env.MOOLRE_SMS_ENABLED === 'false') {
      console.log('[Moolre] SMS skipped:', JSON.stringify({ to: params.to, message: params.message }))
      return { success: true, skipped: true }
    }
    if (!this.vasKey) return { success: false, skipped: true, error: 'Missing Moolre VAS key' }

    try {
      const recipient = this.normalizeSmsRecipient(params.to)
      if (!recipient) {
        return { success: false, error: 'Invalid recipient phone number' }
      }
      const res = await fetch(`${MOOLRE_BASE}/open/sms/send`, {
        method: 'POST',
        headers: this.smsHeaders(),
        body: JSON.stringify({
          type: 1,
          senderid: this.smsSender,
          messages: [
            {
              recipient,
              message: params.message,
            },
          ],
        }),
      })
      const raw = await res.json().catch(() => null)
      const success = raw?.status === 1
      if (!res.ok || !success) {
        console.error('[Moolre] sendSms failed:', JSON.stringify(raw))
      }
      return {
        success,
        raw,
        error: success ? undefined : raw?.message || raw?.code || 'SMS send failed',
      }
    } catch (err) {
      console.error('[Moolre] sendSms error:', err)
      return { success: false, error: err instanceof Error ? err.message : 'SMS failed' }
    }
  }

  async checkSmsBalance() {
    if (process.env.MOOLRE_SMS_ENABLED === 'false') {
      return { success: true, balance: Number.POSITIVE_INFINITY }
    }
    if (!this.vasKey) {
      return { success: false, error: 'Missing Moolre VAS key' }
    }

    try {
      const res = await fetch(`${MOOLRE_BASE}/open/sms/status`, {
        method: 'POST',
        headers: this.smsHeaders(),
        body: JSON.stringify({ type: 2 }),
      })
      const raw = await res.json().catch(() => null)
      if (!res.ok || raw?.status !== 1) {
        console.error('[Moolre] checkSmsBalance failed:', JSON.stringify(raw))
        this.logMissingCredentials('checkSmsBalance')
        return {
          success: false,
          raw,
          error: raw?.message || raw?.code || 'SMS balance check failed',
        }
      }

      const balance = Number(raw.data?.balance ?? 0)
      return { success: true, balance, raw }
    } catch (err) {
      console.error('[Moolre] checkSmsBalance error:', err)
      return { success: false, error: err instanceof Error ? err.message : 'SMS balance check failed' }
    }
  }

  // async validateReceiverName(params: {
  //   method: 'mobile_money' | 'bank'
  //   providerCode: string
  //   account: string
  // }): Promise<{ success: boolean; accountName?: string; raw?: unknown; error?: string }> {
  //   try {
  //     const body = {
  //       type: 1,
  //       channel: params.method === 'bank' ? '2' : params.providerCode,
  //       receiver: params.account,
  //       sublistid: params.method === 'bank' ? params.providerCode : undefined,
  //       accountnumber: this.accountNumber,
  //     }

  //     console.log('[Moolre] validateReceiverName request:', JSON.stringify(body), 'headers:', Object.keys(this.privateHeaders()))

  //     const res = await fetch(`${MOOLRE_BASE}/open/transact/validate`, {
  //       method: 'POST',
  //       headers: this.privateHeaders(),
  //       body: JSON.stringify(body),
  //     })
  //     const raw = await res.json().catch(() => null)
  //     console.log('[Moolre] validateReceiverName response:', res.status, JSON.stringify(raw))

  //     const accountName = raw?.data?.receivername || raw?.data?.accountname || raw?.data?.name
  //     if (!res.ok || raw?.status === 0 || !accountName) {
  //       this.logMissingCredentials('validateReceiverName')
  //       return { success: false, raw, error: raw?.message || 'Could not validate payout account name' }
  //     }
  //     return { success: true, accountName, raw }
  //   } catch (err) {
  //     console.error('[Moolre] validateReceiverName error:', err)
  //     return { success: false, error: err instanceof Error ? err.message : 'Name validation failed' }
  //   }
  // }
  async validateReceiverName(params: {
  method: 'mobile_money' | 'bank'
  providerCode: string
  account: string
}): Promise<{ success: boolean; accountName?: string; raw?: unknown; error?: string }> {
  try {
    const body = {
      type: 1,
      channel: params.method === 'bank' ? '2' : params.providerCode,
      receiver: params.account,
      sublistid: params.method === 'bank' ? params.providerCode : undefined,
      currency: 'GHS',
      accountnumber: this.accountNumber,
    }

    console.log('[Moolre] validateReceiverName request:', JSON.stringify(body), 'headers:', Object.keys(this.privateHeaders()))
    console.log('[Moolre] apiKey debug:', JSON.stringify(this.apiKey), 'length:', this.apiKey.length)

    const res = await fetch(`${MOOLRE_BASE}/open/transact/validate`, {
      method: 'POST',
      headers: this.privateHeaders(),
      body: JSON.stringify(body),
    })
    const raw = await res.json().catch(() => null)
    console.log('[Moolre] validateReceiverName response:', res.status, JSON.stringify(raw))

    // Moolre returns the account name as a plain string in `data` on success,
    // not as data.receivername / data.accountname / data.name
    const accountName = typeof raw?.data === 'string' ? raw.data : undefined

    if (!res.ok || raw?.status !== 1 || !accountName) {
      this.logMissingCredentials('validateReceiverName')
      return {
        success: false,
        raw,
        error: raw?.message || 'Could not validate payout account name',
      }
    }
    return { success: true, accountName, raw }
  } catch (err) {
    console.error('[Moolre] validateReceiverName error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Name validation failed' }
  }
}

  async initiateTransfer(params: {
    method: 'mobile_money' | 'bank'
    providerCode: string
    amount: string
    account: string
    externalRef: string
    reference?: string
    receiverName?: string
  }): Promise<MoolreTransferResponse> {
    if (this.isLocalTransferTest()) {
      return {
        success: true,
        transactionid: `test_${Date.now()}`,
        externalref: params.externalRef,
        receivername: params.receiverName,
        raw: { status: 1, data: { testMode: true, amount: params.amount, receiver: params.account, receivername: params.receiverName } },
        testMode: true,
      }
    }

    try {
      const body = {
        type: 1,
        channel: params.method === 'bank' ? '2' : params.providerCode,
        currency: 'GHS',
        amount: params.amount,
        receiver: params.account,
        sublistid: params.method === 'bank' ? params.providerCode : undefined,
        externalref: params.externalRef,
        reference: params.reference,
        accountnumber: this.accountNumber,
        receivername: params.receiverName,
      }
      const res = await fetch(`${MOOLRE_BASE}/open/transact/transfer`, {
        method: 'POST',
        headers: this.privateHeaders(),
        body: JSON.stringify(body),
      })
      const raw = await res.json().catch(() => null)
      if (!res.ok || raw?.status === 0 || raw?.status === '0') {
        this.logMissingCredentials('initiateTransfer')
        return { success: false, raw, error: raw?.message || 'Moolre transfer failed' }
      }
      // return {
      //   success: true,
      //   transactionid: raw?.data?.transactionid,
      //   externalref: raw?.data?.externalref || params.externalRef,
      //   receivername: raw?.data?.receivername,
      //   raw,
      // }
      return {
        success: true,
        transactionid: raw?.data?.transactionid != null ? String(raw.data.transactionid) : undefined,
        externalref: raw?.data?.externalref ? String(raw.data.externalref) : params.externalRef,
        receivername: raw?.data?.receivername,
        raw,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Transfer failed' }
    }
  }

  private isLocalTransferTest() {
    return process.env.MOOLRE_TRANSFER_DRY_RUN === 'true'
  }
}