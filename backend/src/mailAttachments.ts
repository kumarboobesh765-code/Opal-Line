/**
 * Pure attachment-budget rules for backup emails. Kept side-effect free so
 * the limits are unit-testable without a mail transport.
 *
 * Gmail (and most providers) reject messages over 25 MB; base64 encoding
 * inflates attachments by ~33%, so the total attach budget is intentionally
 * below the transport limit.
 */

export const MAX_TOTAL_ATTACHMENT_MB = 20
export const MAX_SINGLE_ATTACHMENT_MB = 25

export interface AttachableFile {
  fileName: string
  content: Buffer
}

export interface AttachmentFilterResult {
  attachable: AttachableFile[]
  skipped: Array<{ fileName: string; reason: string }>
  totalMb: number
}

/**
 * Decide which files can be attached to a single email:
 *  - a file larger than MAX_SINGLE_ATTACHMENT_MB is dropped on its own
 *  - files are kept in order until adding the next one would push the total
 *    over MAX_TOTAL_ATTACHMENT_MB; everything after that is skipped
 */
export function filterAttachableFiles(files: AttachableFile[]): AttachmentFilterResult {
  const attachable: AttachableFile[] = []
  const skipped: Array<{ fileName: string; reason: string }> = []
  let totalBytes = 0
  for (const file of files) {
    if (file.content.length > MAX_SINGLE_ATTACHMENT_MB * 1024 * 1024) {
      skipped.push({ fileName: file.fileName, reason: `exceeds the ${MAX_SINGLE_ATTACHMENT_MB} MB per-file limit` })
      continue
    }
    if (totalBytes + file.content.length > MAX_TOTAL_ATTACHMENT_MB * 1024 * 1024) {
      skipped.push({ fileName: file.fileName, reason: `would exceed the ${MAX_TOTAL_ATTACHMENT_MB} MB total attachment budget` })
      continue
    }
    totalBytes += file.content.length
    attachable.push(file)
  }
  return { attachable, skipped, totalMb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100 }
}
