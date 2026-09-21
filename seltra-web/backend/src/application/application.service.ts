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
    if (existing) {
      throw new BadRequestException(
        'An application with this email already exists. Try using a different email address or reach out to support.'
      )
    }
   
    const application = await prisma.merchantApplication.create({ data })

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