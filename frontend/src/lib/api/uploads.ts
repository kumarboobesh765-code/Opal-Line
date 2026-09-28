import { request } from './core'

export const uploadsApi = {
  uploadImages: (dataUrls: string[]) =>
    request<{ ok: boolean; paths: string[]; errors?: string[] }>('/uploads/image', {
      method: 'POST',
      body: JSON.stringify({ dataUrls }),
    }),
}
