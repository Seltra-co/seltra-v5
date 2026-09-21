// apps/api/src/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common'
import { prisma } from './db'
import type { PrismaClient } from './db'

@Injectable()
export class PrismaService implements OnModuleInit {
  private client = prisma

  async onModuleInit() {
    await this.client.$connect()
  }

  get tenant(): PrismaClient['tenant'] {
    return this.client.tenant
  }

  get product(): PrismaClient['product'] {
    return this.client.product
  }

  get category(): PrismaClient['category'] {
    return this.client.category
  }

  get order(): PrismaClient['order'] {
    return this.client.order
  }

  get paymentProvider(): PrismaClient['paymentProvider'] {
    return this.client.paymentProvider
  }

  get shippingZone(): PrismaClient['shippingZone'] {
    return this.client.shippingZone
  }
}
