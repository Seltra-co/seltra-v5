//seltra-merchant-v5/backend/src/application/application.service.ts
import { BadRequestException, Injectable } from '@nestjs/common'
import { prisma } from '../db'
import { ApplicationDto, normalizeApplicationDto } from './application.dto'
import { ResendService } from '../resend/resend.service'

@Injectable()
export class ApplicationService {
  constructor(private readonly resendService: ResendService) {}

  async submitApplication(dto: ApplicationDto) {
     const data = normalizeApplicationDto(dto)

    const existing = await prisma.merchantApplication.findUnique({
      where: { email: data.email },
    })

    // Approved / suspended accounts keep their seat — ask them to log in instead.
    if (existing && existing.status !== 'rejected' && existing.status !== 'pending') {
      throw new BadRequestException(
        'An application with this email already exists. Try using a different email address or reach out to support.'
      )
    }

    // Pending (or rejected reopen) — upsert so a retry after a flaky network still lands in Ops.
    const application = existing
      ? await prisma.merchantApplication.update({
          where: { id: existing.id },
          data: {
            ...data,
            status: 'pending',
            // Re-applications should appear as newest on the Ops waitlist
            createdAt: new Date(),
            reviewNotes: null,
            reviewedAt: null,
            merchantId: null,
            userId: null,
            credentialsGeneratedAt: null,
            welcomeEmailSentAt: null,
          },
        })
      : await prisma.merchantApplication.create({ data })

    // Fire-and-forget — email failure never blocks the applicant
    void this.resendService.sendApplicationNotification(dto, application.id)

    return { success: true, applicationId: application.id }
  }

  async verifyMerchantId(merchantId: string) {
    const id = merchantId?.trim()
    if (!id) throw new BadRequestException('Missing Merchant ID')

    const application = await prisma.merchantApplication.findFirst({
      where: { merchantId: id, status: 'approved' },
    })

    if (!application) return { valid: false }
    return {
      valid: true,
      businessName: application.businessName,
      storeName: application.storeName,
      fullName: application.fullName,
    }
  }
}