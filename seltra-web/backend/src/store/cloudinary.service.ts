//store/cloudinary.service.ts
import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export async function uploadImageBuffer(
  base64: string,
  mimeType: string,
  publicId: string,
): Promise<{ secure_url: string }> {
  const dataUri = `data:${mimeType || 'image/jpeg'};base64,${base64}`
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: undefined,
    public_id: publicId,
    overwrite: true,
    resource_type: 'image',
  })

  return { secure_url: result.secure_url }
}
