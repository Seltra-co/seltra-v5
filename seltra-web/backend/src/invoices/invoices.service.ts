import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { ResendService } from '../resend/resend.service'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { AgentEventsService } from '../agent/agent-events.service'

type InvoiceItemInput = { description: string; quantity: number; unitPrice: string | number }

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMoney(value: Prisma.Decimal | string | number, currency: string) {
  return `${currency} ${Number(value).toFixed(2)}`
}

const SELTRA_LOGO = 'https://res.cloudinary.com/dfmsaarli/image/upload/seltra_logo_1_wdtlfv.png'

@Injectable()
export class InvoicesService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly resend: ResendService,
    private readonly tenantEvents: TenantEventsService,
    private readonly agentEvents: AgentEventsService,
  ) {}

  async list(authorization?: string, tenantId?: string, pageInput = 1, perPageInput = 10) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const page = Math.max(1, pageInput)
    const perPage = Math.min(50, Math.max(1, perPageInput))
    const where = { tenantId: resolvedTenantId }
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.invoice.count({ where }),
    ])
    return { data: rows, total, page, perPage }
  }

  async create(authorization: string | undefined, body: {
    tenantId?: string
    customerName: string
    customerEmail: string
    dueDate?: string
    tax?: string | number
    discount?: string | number
    items: InvoiceItemInput[]
  }) {
    const tenantId = await this.resolveTenantId(authorization, body.tenantId)
    if (!body.customerName?.trim()) throw new BadRequestException('Customer name is required')
    if (!body.customerEmail?.trim()) throw new BadRequestException('Customer email is required')
    const invoiceCount = await prisma.invoice.count({ where: { tenantId } })
    const number = `INV-${String(invoiceCount + 1).padStart(5, '0')}`
    const items = (body.items || []).filter((item) => item.description && Number(item.quantity) > 0)
    if (items.length === 0) throw new BadRequestException('At least one invoice item is required')
    const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0)
    const tax = Number(body.tax ?? 0)
    const discount = Number(body.discount ?? 0)
    const total = Math.max(0, subtotal + tax - discount)

    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        number,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        subtotal: new Prisma.Decimal(subtotal),
        tax: new Prisma.Decimal(tax),
        discount: new Prisma.Decimal(discount),
        total: new Prisma.Decimal(total),
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        pdfUrl: `/api/v1/invoices/${number}/pdf`,
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: new Prisma.Decimal(item.unitPrice),
            total: new Prisma.Decimal(Number(item.unitPrice) * Number(item.quantity)),
          })),
        },
      },
      include: { items: true },
    })

    void this.tenantEvents.recordForTenant(tenantId, 'invoice_created', { invoiceId: invoice.id, number, total: total.toFixed(2), customerEmail: body.customerEmail })
    void this.agentEvents.emit({ tenantId, agent: 'InvoiceAgent', type: 'invoice.created', action: 'CREATE_INVOICE', payload: { invoiceId: invoice.id, number } as object }).catch(() => null)
    return invoice
  }

  async send(authorization: string | undefined, invoiceId: string, tenantId?: string) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const invoice = await prisma.invoice.findFirst({ where: { OR: [{ id: invoiceId }, { number: invoiceId }], tenantId: resolvedTenantId }, include: { items: true } })
    if (!invoice) throw new NotFoundException('Invoice not found')

    await this.resend.sendInvoice({
      to: invoice.customerEmail,
      customerName: invoice.customerName,
      invoiceNumber: invoice.number,
      total: invoice.total.toString(),
      currency: invoice.currency,
      dueDate: invoice.dueDate?.toISOString().slice(0, 10),
      pdfUrl: invoice.pdfUrl || undefined,
    })

    const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: invoice.status === 'draft' ? 'sent' : invoice.status, sentAt: new Date() }, include: { items: true } })
    void this.tenantEvents.recordForTenant(resolvedTenantId, 'invoice_sent', { invoiceId: invoice.id, number: invoice.number, customerEmail: invoice.customerEmail })
    return updated
  }

  async markPaid(authorization: string | undefined, invoiceId: string, tenantId?: string) {
    const resolvedTenantId = await this.resolveTenantId(authorization, tenantId)
    const invoice = await prisma.invoice.findFirst({ where: { OR: [{ id: invoiceId }, { number: invoiceId }], tenantId: resolvedTenantId } })
    if (!invoice) throw new NotFoundException('Invoice not found')
    const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'paid', paidAt: new Date() }, include: { items: true } })
    void this.tenantEvents.recordForTenant(resolvedTenantId, 'invoice_paid', { invoiceId: invoice.id, number: invoice.number, total: invoice.total.toString() })
    return updated
  }

  async renderDocument(invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({ where: { OR: [{ id: invoiceId }, { number: invoiceId }] }, include: { items: true, tenant: true } })
    if (!invoice) throw new NotFoundException('Invoice not found')
    const status = invoice.status.toUpperCase()
    const rows = invoice.items.map((item) => `
      <tr>
        <td data-label="Description">${escapeHtml(item.description)}</td>
        <td data-label="Qty" class="num">${item.quantity}</td>
        <td data-label="Unit" class="num">${formatMoney(item.unitPrice, invoice.currency)}</td>
        <td data-label="Total" class="num">${formatMoney(item.total, invoice.currency)}</td>
      </tr>
    `).join('')
    const due = invoice.dueDate ? invoice.dueDate.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : 'On receipt'
    const created = invoice.createdAt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(invoice.number)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    :root { color-scheme: light; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --soft:#f8fafc; --brand:#16a34a; }
    * { box-sizing: border-box; }
    body { margin:0; background:#eef2f7; color:var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .toolbar { position:sticky; top:0; display:flex; justify-content:flex-end; gap:10px; padding:14px 18px; background:rgba(238,242,247,.86); backdrop-filter:blur(12px); }
    button { border:0; border-radius:999px; background:var(--ink); color:white; padding:10px 16px; font-weight:700; cursor:pointer; }
    .sheet { width:min(920px, calc(100vw - 28px)); margin:18px auto 40px; background:white; border:1px solid var(--line); border-radius:22px; box-shadow:0 24px 80px rgba(15,23,42,.12); overflow:hidden; }
    .hero { display:flex; justify-content:space-between; gap:24px; padding:42px; background:linear-gradient(135deg,#0f172a,#111827 65%,#14532d); color:white; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:800; font-size:22px; }
    .brand img { width:auto; height:34px; border-radius:8px; background:rgba(255,255,255,.9); padding:5px; }
    .invoice-title { text-align:right; }
    .invoice-title h1 { margin:0; font-size:38px; letter-spacing:-.04em; }
    .invoice-title p { margin:8px 0 0; color:rgba(255,255,255,.72); font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
    .status { display:inline-flex; margin-top:14px; border:1px solid rgba(255,255,255,.24); border-radius:999px; padding:6px 10px; color:#bbf7d0; font:700 11px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:.12em; }
    .content { padding:38px 42px 42px; }
    .meta { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:32px; }
    .box { border:1px solid var(--line); border-radius:16px; padding:16px; background:var(--soft); min-width:0; }
    .label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.12em; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
    .value { margin-top:7px; font-weight:700; word-break:break-word; }
    table { width:100%; border-collapse:collapse; }
    th { color:var(--muted); font-size:11px; text-align:left; text-transform:uppercase; letter-spacing:.12em; padding:12px 0; border-bottom:1px solid var(--line); font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
    td { padding:18px 0; border-bottom:1px solid var(--line); vertical-align:top; }
    .num { text-align:right; white-space:nowrap; }
    .totals { margin-left:auto; width:min(360px,100%); padding-top:24px; }
    .totals div { display:flex; justify-content:space-between; gap:20px; padding:8px 0; color:var(--muted); }
    .totals .grand { margin-top:8px; padding-top:16px; border-top:2px solid var(--ink); color:var(--ink); font-size:22px; font-weight:800; }
    .note { margin-top:32px; border-left:4px solid var(--brand); background:#f0fdf4; border-radius:14px; padding:16px; color:#166534; }
    @media (max-width: 700px) {
      .toolbar { justify-content:center; }
      .hero { flex-direction:column; padding:28px; }
      .invoice-title { text-align:left; }
      .content { padding:24px; }
      .meta { grid-template-columns:1fr; }
      thead { display:none; }
      tr { display:block; border:1px solid var(--line); border-radius:16px; margin-bottom:12px; padding:8px 14px; }
      td { display:flex; justify-content:space-between; gap:20px; border-bottom:1px solid var(--line); padding:12px 0; text-align:right; word-break:break-word; }
      td:last-child { border-bottom:0; }
      td::before { content:attr(data-label); color:var(--muted); font-weight:700; text-align:left; }
    }
    @media print {
      body { background:white; }
      .toolbar { display:none; }
      .sheet { width:100%; margin:0; border:0; border-radius:0; box-shadow:none; }
      .note { break-inside:avoid; }
      tr, .box, .totals { break-inside:avoid; }
      .hero, .content { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Download PDF</button></div>
  <main class="sheet">
    <section class="hero">
      <div>
        <div class="brand"><img src="${SELTRA_LOGO}" alt="Seltra"><span>${escapeHtml(invoice.tenant.name)}</span></div>
        <p style="margin:14px 0 0;color:rgba(255,255,255,.72)">Issued by ${escapeHtml(invoice.tenant.name)} via Seltra Commerce OS</p>
      </div>
      <div class="invoice-title">
        <h1>Invoice</h1>
        <p>${escapeHtml(invoice.number)}</p>
        <span class="status">${escapeHtml(status)}</span>
      </div>
    </section>
    <section class="content">
      <div class="meta">
        <div class="box"><div class="label">Bill to</div><div class="value">${escapeHtml(invoice.customerName)}<br><span style="color:var(--muted);font-weight:500">${escapeHtml(invoice.customerEmail)}</span></div></div>
        <div class="box"><div class="label">Issued</div><div class="value">${created}</div></div>
        <div class="box"><div class="label">Due</div><div class="value">${due}</div></div>
      </div>
      <table>
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div><span>Subtotal</span><strong>${formatMoney(invoice.subtotal, invoice.currency)}</strong></div>
        <div><span>Tax</span><strong>${formatMoney(invoice.tax, invoice.currency)}</strong></div>
        <div><span>Discount</span><strong>${formatMoney(invoice.discount, invoice.currency)}</strong></div>
        <div class="grand"><span>Total</span><span>${formatMoney(invoice.total, invoice.currency)}</span></div>
      </div>
      <div class="note">Thank you for your business. Please include invoice ${escapeHtml(invoice.number)} with your payment reference. Powered by Seltra.</div>
    </section>
  </main>
</body>
</html>`
  }

  private async resolveTenantId(authorization?: string, requestedTenantId?: string) {
    const userId = await this.userIdFromAuth(authorization)
    if (requestedTenantId) {
      const tenant = await prisma.tenant.findFirst({ where: { id: requestedTenantId, ownerId: userId }, select: { id: true } })
      if (!tenant) throw new NotFoundException('Store not found')
      return tenant.id
    }
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: userId }, orderBy: { updatedAt: 'desc' }, select: { id: true } })
    if (!tenant) throw new NotFoundException('No store found for this merchant')
    return tenant.id
  }

  private async userIdFromAuth(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, { secret: process.env.JWT_SECRET || 'change-me' })
      return payload.sub
    } catch {
      throw new UnauthorizedException('Invalid bearer token')
    }
  }
}
