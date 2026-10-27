import { Injectable, Logger } from '@nestjs/common'
import { Resend } from 'resend'
import type { ApplicationDto } from '../application/application.dto'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

const resend = {
  emails: {
    send: async (payload: Parameters<Resend['emails']['send']>[0]) => {
      const client = getResend()
      if (!client) {
        console.warn('[Resend] RESEND_API_KEY is not set; email skipped')
        return { data: null, error: null }
      }
      return client.emails.send(payload)
    },
  },
}
const FROM = process.env.RESEND_FROM ?? 'Seltra <careers@send.seltra.co>'
const NOTIFY_TO = process.env.RESEND_NOTIFY_TO ?? 'williamofosu677@gmail.com'

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type V5IntroductionEmailInput = {
  to: string
  firstName: string
  userId: string
  loginUrl: string
  unsubscribeUrl: string
}

function buildV5IntroductionEmail(input: V5IntroductionEmailInput) {
  const firstName = escapeHtml(input.firstName || 'there')
  const loginUrl = escapeHtml(input.loginUrl)
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl)
  // const iconUrl = 'https://seltra.co/assets/brand/Glossy%20Green%20Geometric%20App%20Icon%20-%20v5.png'
  const iconUrl = 'https://res.cloudinary.com/rsgy1lxe/image/upload/v1793044394/Glossy_Green_Geometric_App_Icon_-_v5.png'

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;color:#292929;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff">
    <tr><td align="center" style="padding:32px 16px 48px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:720px">
        <tr><td style="padding:12px 0 26px;font-size:16px;line-height:1.6">Hey ${firstName},</td></tr>
        <tr><td style="padding:0 0 18px">
          <h1 style="margin:0 0 18px;color:#171717;font-size:30px;line-height:1.2;font-weight:500;letter-spacing:-.5px">Introducing Seltra v5.0</h1>
          <p style="margin:0;font-size:17px;line-height:1.65;color:#383838">When we last wrote to you, we shared that we were building Seltra v5 to make the platform more capable and reliable. Since then, we’ve been working on a much bigger step forward: a new foundation for how Seltra builds storefronts, reasons through tasks, and supports your commerce workflows.</p>
        </td></tr>
        <tr><td style="padding:14px 0 30px">
          <a href="${loginUrl}" style="display:inline-block;border-radius:7px;background:#353535;padding:14px 20px;color:#ffffff;text-decoration:none;font-size:16px;line-height:1.2;font-weight:600">Try Seltra for free</a>
        </td></tr>
        <tr><td style="padding:0 0 34px">
          <img src="${iconUrl}" width="720" alt="Seltra v5 — a new era of AI-powered commerce" style="display:block;width:100%;max-width:720px;height:auto;border:0;border-radius:10px;background:#050505" />
        </td></tr>
        <tr><td style="padding:0 0 10px"><h2 style="margin:0;color:#202020;font-size:22px;line-height:1.35;font-weight:600">What’s new in Seltra v5?</h2></td></tr>
        <tr><td style="padding:0 0 16px">
          <p style="margin:0 0 5px;font-size:17px;line-height:1.5;font-weight:600;color:#303030">A stronger foundation for AI.</p>
          <p style="margin:0;font-size:16px;line-height:1.65;color:#444444">Our new agent runtime gives Seltra a more capable foundation to reason through tasks and take action across your commerce workflows.</p>
        </td></tr>
        <tr><td style="padding:0 0 16px">
          <p style="margin:0 0 5px;font-size:17px;line-height:1.5;font-weight:600;color:#303030">More reliable, end-to-end workflows.</p>
          <p style="margin:0;font-size:16px;line-height:1.65;color:#444444">From setting up your storefront to managing products and handling orders, we’re building a smoother experience with fewer interruptions and more dependable results.</p>
        </td></tr>
        <tr><td style="padding:0 0 16px">
          <p style="margin:0 0 5px;font-size:17px;line-height:1.5;font-weight:600;color:#303030">Smarter storefront creation.</p>
          <p style="margin:0;font-size:16px;line-height:1.65;color:#444444">Design intelligence and our Build Integrity Engine are advancing how Seltra turns business ideas into polished, functional commerce experiences.</p>
        </td></tr>
        <tr><td style="padding:0 0 28px">
          <p style="margin:0 0 5px;font-size:17px;line-height:1.5;font-weight:600;color:#303030">Commerce that works harder for you.</p>
          <p style="margin:0;font-size:16px;line-height:1.65;color:#444444">Our vision is simple: you set the direction for your business, and Seltra’s AI agents take on more of the work needed to run it.</p>
        </td></tr>
        <tr><td style="padding:0 0 22px">
          <h2 style="margin:0 0 10px;color:#202020;font-size:22px;line-height:1.35;font-weight:600">Why this matters for your business</h2>
          <p style="margin:0 0 12px;font-size:16px;line-height:1.65;color:#444444">Running a business shouldn’t mean spending your day switching between tools, updating products, managing orders, and figuring out software.</p>
          <p style="margin:0;font-size:16px;line-height:1.65;color:#444444">Seltra v5 is built to bring more of that work together in one place—giving you more time to focus on your customers, your products, and your growth. This is more than an upgrade. It’s a new foundation for how Seltra works.</p>
        </td></tr>
        <tr><td style="padding:0 0 30px;font-size:16px;line-height:1.65;color:#444444">Thank you for being part of Seltra’s journey. Your trust is a big part of why we’re building this.<br><br>Warm regards,<br>William Ofosu Parwar<br>Co-founder &amp; Head of Product, Seltra Inc.</td></tr>
        <tr><td style="border-top:1px solid #e7e7e7;padding:20px 0 0;text-align:center;font-size:12px;line-height:1.7;color:#777777">
          <p style="margin:0 0 6px">You’re receiving this product update because you signed up for Seltra.</p>
          <p style="margin:0 0 6px">Seltra Inc. · 17 Antoine Street, Animal Research, Yellow House, Adenta, Accra, Ghana</p>
          <p style="margin:0"><a href="${unsubscribeUrl}" style="color:#555555;text-decoration:underline">Unsubscribe from product updates</a> · <a href="https://seltra.co" style="color:#555555;text-decoration:underline">seltra.co</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildV5IntroductionText(input: V5IntroductionEmailInput) {
  const firstName = input.firstName || 'there'
  return `Hey ${firstName},\n\nIntroducing Seltra v5.0 — A new era of AI-powered commerce.\n\nWhen we last wrote to you, we shared that we were building Seltra v5 to make the platform more capable and reliable. Since then, we’ve been working on a much bigger step forward: a new foundation for how Seltra builds storefronts, reasons through tasks, and supports your commerce workflows.\n\nTry Seltra for free: ${input.loginUrl}\n\nWHAT’S NEW IN SELTRA V5?\n\nA stronger foundation for AI.\nOur new agent runtime gives Seltra a more capable foundation to reason through tasks and take action across your commerce workflows.\n\nMore reliable, end-to-end workflows.\nFrom setting up your storefront to managing products and handling orders, we’re building a smoother experience with fewer interruptions and more dependable results.\n\nSmarter storefront creation.\nDesign intelligence and our Build Integrity Engine are advancing how Seltra turns business ideas into polished, functional commerce experiences.\n\nCommerce that works harder for you.\nYou set the direction for your business, and Seltra’s AI agents take on more of the work needed to run it.\n\nWHY THIS MATTERS\nRunning a business shouldn’t mean spending your day switching between tools, updating products, managing orders, and figuring out software. Seltra v5 is being built to bring more of that work together in one place—giving you more time to focus on your customers, your products, and your growth.\n\nWHAT HAPPENS NEXT?\nWe’re continuing to build and test Seltra v5. We’ll keep you informed as we move toward release. You don’t need to do anything right now.\n\nWarm regards,\nWilliam Ofosu Parwar\nCo-founder & Head of Product, Seltra Inc.\n\nUnsubscribe from product updates: ${input.unsubscribeUrl}\nSeltra Inc. · 17 Antoine Street, Animal Research, Yellow House, Adenta, Accra, Ghana`
}

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name)

  async sendApplicationNotification(dto: ApplicationDto, applicationId: string) {
    await Promise.allSettled([
      this.sendAdminNotification(dto, applicationId),
      dto.email ? this.sendMerchantWelcome(dto) : Promise.resolve(),
    ])
  }

  async sendPasswordResetOtp(input: { to: string; code: string }) {
    await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: 'Your Seltra password reset code',
      html: emailShell(`
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0a0a0a">Reset your password</p>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;line-height:1.7">Enter this code to choose a new password. It expires in 10 minutes.</p>
          <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:0.35em;color:#16803c">${escapeHtml(input.code)}</p>
        </td></tr>
      `),
    })
  }

  async sendLoginOtp(input: { to: string; code: string }) {
    if (!getResend()) throw new Error('RESEND_API_KEY is not configured')
    const result = await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: `${input.code} is your Seltra sign-in code`,
      html: emailShell(`
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0a0a0a">Your Seltra sign-in code:</p>
          <p style="margin:0 0 16px;font-size:34px;font-weight:750;letter-spacing:0.22em;color:#111827">✦ ${escapeHtml(input.code)}</p>
          <p style="margin:0;font-size:14px;color:#52525b;line-height:1.7">Enter this code in Seltra to finish signing in. It works once and expires in 10 minutes. If you didn’t request it, you can ignore this email.</p>
        </td></tr>
      `),
    })
    if (result.error) throw result.error
  }

  async sendNewMerchantWelcome(input: { to: string; name: string; merchantId: string }) {
    if (!getResend()) throw new Error('RESEND_API_KEY is not configured')
    const result = await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: `Welcome to Seltra, ${escapeHtml(input.name.split(/\s+/)[0] || 'there')}`,
      html: emailShell(`
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">Welcome to Seltra, ${escapeHtml(input.name.split(/\s+/)[0] || 'there')} ✨</p>
          <p style="margin:0 0 24px;font-size:14px;color:#52525b;line-height:1.7">Your account is ready. Describe the store you want to build and Seltra AI will help bring it to life.</p>
          <p style="margin:0 0 8px;font-size:13px;color:#71717a">Your merchant ID</p>
          <p style="margin:0 0 24px;padding:16px 18px;border-radius:10px;background:#f0fdf4;border:1px solid #bbf7d0;font-size:20px;font-weight:700;letter-spacing:.08em;color:#166534">${escapeHtml(input.merchantId)}</p>
          <p style="margin:0;font-size:13px;color:#71717a;line-height:1.7">Keep this ID safe. You can sign in with your email and password or this ID, followed by an email verification code.</p>
        </td></tr>
      `),
    })
    if (result.error) throw result.error
  }

  async sendV5Introduction(input: {
    to: string
    firstName: string
    userId: string
    scheduledEmailId: string
    loginUrl: string
    unsubscribeUrl: string
  }) {
    const client = getResend()
    if (!client) throw new Error('RESEND_API_KEY is not configured')
    const subject = 'Introducing Seltra v5.0 — A new era of AI-powered commerce'
    const result = await client.emails.send({
      from: FROM,
      to: input.to,
      subject,
      html: buildV5IntroductionEmail(input),
      text: buildV5IntroductionText(input),
      headers: {
        'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }, { idempotencyKey: `seltra-v5-introduction/${input.scheduledEmailId}` })
    if (result.error) throw result.error
  }

  async sendMerchantApproval(input: {
    to: string
    fullName: string
    storeName: string
    loginUrl: string
    merchantId: string
    merchantEmail: string
    temporaryPassword?: string
  }) {
    await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: `Your Seltra account is approved: ${input.storeName}`,
      html: buildMerchantApprovalEmail(input),
    })
  }

  async sendInvoice(input: {
    to: string
    customerName: string
    invoiceNumber: string
    total: string
    currency: string
    dueDate?: string
    pdfUrl?: string
  }) {
    await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: `Invoice ${input.invoiceNumber} from Seltra`,
      html: emailShell(`
        <tr><td style="background:#18181b;border-left:3px solid #22c55e;padding:20px 40px">
          <p style="margin:0;font-size:11px;color:#71717a;font-family:monospace;letter-spacing:1px;text-transform:uppercase">// invoice</p>
          <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff">${input.invoiceNumber}</p>
        </td></tr>
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0a0a0a">Hello ${input.customerName || 'there'},</p>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;line-height:1.7">Your invoice is ready.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:20px 24px">
              ${row('Invoice', input.invoiceNumber)}
              ${row('Amount', `${input.currency} ${input.total}`)}
              ${row('Due date', input.dueDate)}
              ${input.pdfUrl ? row('Download', input.pdfUrl) : ''}
            </td></tr>
          </table>
        </td></tr>
      `),
    })
  }

  async sendMerchantMessage(input: {
    to: string
    subject: string
    message: string
    storeName?: string | null
  }) {
    await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: input.subject,
      html: emailShell(`
        <tr><td style="background:#18181b;border-left:3px solid #22c55e;padding:20px 40px">
          <p style="margin:0;font-size:11px;color:#71717a;font-family:monospace;letter-spacing:1px;text-transform:uppercase">// message via seltra</p>
          <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff">${input.storeName || 'Seltra merchant'}</p>
        </td></tr>
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;white-space:pre-line">${escapeHtml(input.message)}</p>
          <p style="margin:24px 0 0;font-size:11px;color:#71717a">Sent securely via Seltra Commerce OS.</p>
        </td></tr>
      `),
    })
  }

  async sendMerchantReceipt(input: {
    to: string
    merchantName?: string | null
    storeName: string
    amount: string
    currency: string
    account: string
    provider?: string | null
    reference: string
  }) {
    await resend.emails.send({
      from: FROM,
      to: input.to,
      subject: `Seltra disbursement receipt: ${input.currency} ${input.amount}`,
      html: emailShell(`
        <tr><td style="background:#18181b;border-left:3px solid #22c55e;padding:20px 40px">
          <p style="margin:0;font-size:11px;color:#71717a;font-family:monospace;letter-spacing:1px;text-transform:uppercase">// disbursement receipt</p>
          <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff">${input.storeName}</p>
        </td></tr>
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0a0a0a">Hello ${input.merchantName || 'merchant'},</p>
          <p style="margin:0 0 20px;font-size:13px;color:#71717a;line-height:1.7">Your Seltra payout has been sent.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:20px 24px">
              ${row('Amount', `${input.currency} ${input.amount}`)}
              ${row('Provider', input.provider)}
              ${row('Account', input.account)}
              ${row('Reference', input.reference)}
            </td></tr>
          </table>
        </td></tr>
      `),
    })
  }

  private async sendAdminNotification(dto: ApplicationDto, applicationId: string) {
    try {
      await resend.emails.send({
        from: FROM,
        to: NOTIFY_TO,
        subject: `New Application: ${dto.full_name} (${dto.business_name})`,
        html: buildAdminEmail(dto, applicationId),
      })
    } catch (err) {
      this.logger.error('Admin notification failed', err)
    }
  }

  private async sendMerchantWelcome(dto: ApplicationDto) {
    try {
      await resend.emails.send({
        from: FROM,
        to: dto.email!,
        subject: `You're on the Seltra waitlist, ${dto.full_name.split(' ')[0]} 🌍`,
        html: buildMerchantWelcomeEmail(dto),
      })
    } catch (err) {
      this.logger.error('Merchant welcome email failed', err)
    }
  }
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function row(label: string, value: string | null | undefined) {
  if (!value) return ''
  return `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#71717a;white-space:nowrap;width:160px;vertical-align:top">${label}</td>
      <td style="padding:6px 0;font-size:13px;color:#0a0a0a;font-weight:500">${value}</td>
    </tr>`
}

function badge(value: boolean | null | undefined) {
  if (value == null) return '<span style="color:#a1a1aa;font-size:12px">—</span>'
  return value
    ? '<span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px">Yes</span>'
    : '<span style="background:#fffbeb;border:1px solid #fde68a;color:#d97706;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px">No</span>'
}

function emailShell(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

      <!-- Header -->
      <tr><td style="background:#0a0a0a;border-radius:12px 12px 0 0;padding:36px 40px;text-align:center">
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 12px">
          <tr>
            <td style="background: #ffffff;border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle">
              <img src="https://res.cloudinary.com/dfmsaarli/image/upload/ICON_large_ngiv41.png" width="38" height="28" alt="Seltra" style="display:block;margin:auto" />
            </td>
            <td style="padding-left:10px;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;vertical-align:middle">seltra</td>
          </tr>
        </table>
        <p style="margin:0;font-size:13px;color:#71717a">Commerce that runs itself</p>
      </td></tr>

      ${content}

      <!-- Footer -->
      <tr><td style="background:#ffffff;padding:0 40px 36px;border-radius:0 0 12px 12px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;padding-top:20px">
          <tr><td style="text-align:center">
            <p style="margin:0;font-size:13px;font-weight:600;color:#0a0a0a">Seltra Inc.</p>
            <p style="margin:4px 0 0;font-size:11px;color:#a1a1aa">17 Antoine Street, Animal Research, Yellow House, Adenta, Accra, Ghana</p>
            <p style="margin:10px 0 0;font-size:11px"><a href="https://seltra.co" style="color:#22c55e;text-decoration:none">seltra.co</a></p>
          </td></tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

// ─── Admin notification email ───────────────────────────────────────────────

function buildAdminEmail(dto: ApplicationDto, applicationId: string): string {
  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra',
  })

  return emailShell(`
    <!-- Banner -->
    <tr><td style="background:#18181b;border-left:3px solid #22c55e;padding:20px 40px">
      <p style="margin:0;font-size:11px;color:#71717a;font-family:monospace;letter-spacing:1px;text-transform:uppercase">business type</p>
      <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff">${dto.business_name} · ${dto.business_type}</p>
    </td></tr>

    <!-- Body -->
    <tr><td style="background:#ffffff;padding:36px 40px">

      <!-- Contact card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e4e7;border-top:3px solid #22c55e;border-radius:8px;margin-bottom:28px">
        <tr><td style="padding:20px 24px">
          <p style="margin:0 0 16px;font-size:11px;color:#22c55e;font-family:monospace;text-transform:uppercase;letter-spacing:1px">// contact</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${row('Name', dto.full_name)}
            ${row('Business', dto.business_name)}
            ${row('Store', dto.store_name)}
            ${row('Type', dto.business_type)}
            ${row('Phone', dto.phone)}
            ${dto.email ? `<tr><td style="padding:6px 0;font-size:12px;color:#71717a;width:160px;vertical-align:top">Email</td><td style="padding:6px 0;font-size:13px;color:#0a0a0a;font-weight:500"><a href="mailto:${dto.email}" style="color:#22c55e;text-decoration:none">${dto.email}</a></td></tr>` : ''}
            ${row('Based in', dto.based_in)}
            ${row('Revenue stage', dto.monthly_revenue)}
            ${row('What they sell', dto.what_you_sell)}
            ${row('Existing links', dto.existing_links)}
            ${row('Submitted', now)}
            <tr><td style="padding:6px 0;font-size:12px;color:#71717a;width:160px;vertical-align:top">App ID</td><td style="padding:6px 0;font-size:11px;color:#71717a;font-family:monospace">${applicationId}</td></tr>
          </table>
        </td></tr>
      </table>

      <!-- AI readiness -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e4e7;border-top:3px solid #18181b;border-radius:8px;margin-bottom:28px">
        <tr><td style="padding:20px 24px">
          <p style="margin:0 0 16px;font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">// ai readiness</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${row('AI familiarity', dto.ai_familiarity)}
            <tr><td style="padding:6px 0;font-size:12px;color:#71717a;width:160px;vertical-align:top">Used AI before</td><td style="padding:6px 0">${badge(dto.ai_used_before)}</td></tr>
            ${dto.ai_used_before ? row('Tools used', dto.ai_tools_used) : ''}
            ${dto.ai_used_before ? row('How it felt', dto.ai_feelings) : ''}
            ${row('Allow Seltra AI', dto.allow_ai_help)}
          </table>
        </td></tr>
      </table>

      <!-- Reply CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
        <tr><td style="padding:16px 20px;text-align:center">
          <p style="margin:0;font-size:13px;color:#166534">
            Hit <strong>Reply</strong> to reach ${dto.full_name.split(' ')[0]} directly${dto.email ? ` at ${dto.email}` : ''}.
          </p>
        </td></tr>
      </table>

    </td></tr>
  `)
}

// ─── Merchant welcome email ─────────────────────────────────────────────────

function buildMerchantWelcomeEmail(dto: ApplicationDto): string {
  const firstName = dto.full_name.split(' ')[0]

  const perks = [
    {
      icon: '✦',
      title: '30 days on us',
      desc: 'Your first month is completely free. No credit card, no catch — just your store, live and selling.',
    },
    {
      icon: '⚡',
      title: 'AI agents that work while you sleep',
      desc: 'Seltra handles your storefront, orders, and customer messages automatically so you can focus on your craft.',
    },
    {
      icon: '🌍',
      title: 'Founding merchant status',
      desc: 'You are among the first. Early merchants get priority onboarding, a founding badge, and a direct line to our team.',
    },
  ]

  const perkRows = perks.map(p => `
    <tr>
      <td style="padding:0 0 20px 0">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e4e7;border-left:3px solid #22c55e;border-radius:8px">
          <tr><td style="padding:16px 20px">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#0a0a0a">
              <span style="color:#22c55e;font-family:monospace;margin-right:8px">${p.icon}</span>${p.title}
            </p>
            <p style="margin:0;font-size:13px;color:#71717a;line-height:1.6">${p.desc}</p>
          </td></tr>
        </table>
      </td>
    </tr>
  `).join('')

  return emailShell(`
    <!-- Banner -->
    <tr><td style="background:#18181b;border-left:3px solid #22c55e;padding:20px 40px">
      <p style="margin:0;font-size:11px;color:#71717a;font-family:monospace;letter-spacing:1px;text-transform:uppercase">// waitlist confirmed</p>
      <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff">Welcome to Seltra, ${firstName}.</p>
    </td></tr>

    <!-- Body -->
    <tr><td style="background:#ffffff;padding:36px 40px">

      <!-- Intro -->
      <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0a0a0a">We cannot wait to build the future with you.</p>
      <p style="margin:0 0 28px;font-size:13px;color:#71717a;line-height:1.7">
        Your application for <strong style="color:#0a0a0a">${dto.business_name}</strong> is saved.
        We are onboarding merchants personally as we launch, and you are on the list.
        Here is what is waiting for you when we open doors.
      </p>

      <!-- Perks -->
      <table width="100%" cellpadding="0" cellspacing="0">
        ${perkRows}
      </table>

      <!-- Gift banner -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:28px">
        <tr><td style="padding:20px 24px;text-align:center">
          <p style="margin:0 0 4px;font-size:11px;color:#22c55e;font-family:monospace;text-transform:uppercase;letter-spacing:1px">// your gift</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:#166534">30 days free — no strings attached.</p>
          <p style="margin:6px 0 0;font-size:12px;color:#166534;opacity:0.8">Applied automatically when you activate your store.</p>
        </td></tr>
      </table>

      <!-- Sign off -->
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.7">
        We will reach out to you at <span style="font-family:monospace;color:#0a0a0a">${dto.phone}</span> as soon as we launch.<br/>
        Until then — stay building. 🌍
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#0a0a0a;font-weight:500">— The Seltra Team</p>

    </td></tr>
  `)
}

function buildMerchantApprovalEmail(input: {
  fullName: string
  storeName: string
  loginUrl: string
  merchantId: string
  merchantEmail: string
  temporaryPassword?: string
}): string {
  const firstName = input.fullName.split(' ')[0]
  return emailShell(`
    <tr><td style="background:#18181b;border-left:3px solid #22c55e;padding:20px 40px">
      <p style="margin:0;font-size:11px;color:#71717a;font-family:monospace;letter-spacing:1px;text-transform:uppercase">// approved</p>
      <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff">${input.storeName} is ready for you.</p>
    </td></tr>

    <tr><td style="background:#ffffff;padding:36px 40px">
      <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0a0a0a">Welcome in, ${firstName}.</p>
      <p style="margin:0 0 24px;font-size:13px;color:#71717a;line-height:1.7">
        Your Seltra merchant account has been approved. Use the details below to sign in and start reviewing your store.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:24px">
        <tr><td style="padding:20px 24px">
          ${row('Merchant ID', input.merchantId)}
          ${row('Merchant Email', input.merchantEmail)}
          ${row('Temporary password', input.temporaryPassword)}
          ${row('Login', input.loginUrl)}
        </td></tr>
      </table>

      <table cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr><td style="background:#22c55e;border-radius:6px">
          <a href="${input.loginUrl}" style="display:inline-block;padding:12px 18px;color:#052e16;text-decoration:none;font-size:13px;font-weight:700">Open Seltra</a>
        </td></tr>
      </table>

      <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6">
        Keep this email private. You can rotate your login details after your first session.
      </p>
    </td></tr>
  `)
}
