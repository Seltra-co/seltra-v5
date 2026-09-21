export type ApplicationDto = {
  full_name: string
  phone: string
  email: string
  business_name: string
  business_type: string
  store_name: string
  what_you_sell: string
  based_in: string
  monthly_revenue: string
  existing_links?: string
  ai_familiarity?: string
  ai_used_before?: boolean
  ai_tools_used?: string
  ai_feelings?: string
  allow_ai_help?: string
}

export function normalizeApplicationDto(data: ApplicationDto) {
  return {
    fullName: data.full_name.trim(),
    phone: data.phone.trim(),
    email: data.email.trim().toLowerCase(),    businessName: data.business_name.trim(),
    businessType: data.business_type,
    storeName: data.store_name.trim(),
    whatYouSell: data.what_you_sell.trim(),
    basedIn: data.based_in.trim(),
    monthlyRevenue: data.monthly_revenue,
    existingLinks: data.existing_links?.trim() || null,
    aiFamiliarity: data.ai_familiarity || null,
    aiUsedBefore: data.ai_used_before ?? null,
    aiToolsUsed: data.ai_tools_used?.trim() || null,
    aiFeelings: data.ai_feelings?.trim() || null,
    allowAiHelp: data.allow_ai_help || null,
  }
}
