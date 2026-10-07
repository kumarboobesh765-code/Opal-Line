export const CONSTANTS = {
  DEFAULT_MAKING_CHARGE: 20 as number,
  DEFAULT_GST_RATE: 3 as number,
  DEFAULT_PURITY: 92.5 as number,
  DEFAULT_CURRENCY: 'INR' as string,
  DEFAULT_SILVER_RATE: 92.8 as number,
  TITLE_MATCH_THRESHOLD: 0.45 as number,
  STOP_WORDS: new Set([
    'silver', 'classic', 'premium', 'modern', 'traditional', 'sterling',
    'plain', 'delicate', 'with', 'the', 'set', 'in', 'pure', 'handmade', '925'
  ]),
  CATEGORY_WORDS: new Set([
    'ring', 'band', 'bangle', 'bracelet', 'chain', 'necklace', 'pendant',
    'earring', 'anklet', 'payal', 'mangalsutra', 'toering', 'toe', 'nosing',
    'nose', 'cufflink', 'mala', 'jhumka', 'locket', 'giftcard', 'gift'
  ]),
  SHOPIFY_API_LIMIT: 250 as number,
  SHOPIFY_MAX_PAGES: 5 as number,
  // A product can belong to many collections, so collects outnumber products;
  // the default 5-page cap silently dropped memberships for the tail of a
  // large catalogue — allow many more pages for membership reads.
  SHOPIFY_COLLECTION_MAX_PAGES: 20 as number,
  SHOPIFY_MAX_RETRIES: 3 as number,
  SHOPIFY_BASE_RETRY_DELAY_MS: 1000 as number,
  SESSION_TTL_MS: 24 * 60 * 60 * 1000 as number,
  SESSION_COOKIE_NAME: 'opal.session' as string,
  PAGINATION_DEFAULT_LIMIT: 50 as number,
  PAGINATION_MAX_LIMIT: 200 as number,
  RATE_LIMIT_AUTH_MAX: 20 as number,
  RATE_LIMIT_AUTH_WINDOW_MS: 15 * 60 * 1000 as number,
  REQUEST_SIZE_LIMIT: '1mb' as string,
  LOG_MAX_ENTRIES: 50 as number,
  USER_CACHE_MAX_SIZE: 500 as number,
  GSTIN_DEFAULT: '27AAACO1234F1Z5' as string,
  BUSINESS_NAME_DEFAULT: 'Opal Line Jewels LLP' as string,
  // Recovery password for Admin / Super Admin accounts: typed into the normal
  // Password box on the sign-in screen when the owner has forgotten their
  // login password. Fixed by product decision so it is identical on every
  // install; Settings → Team can rotate it to a private value. Only the
  // argon2id hash is kept here — the built-in plaintext exists solely in
  // docs/recovery-password.md. The underlying value must always satisfy the
  // strongPassword validation policy.
  SUPERADMIN_RECOVERY_PASSWORD_HASH:
    '$argon2id$v=19$m=65536,p=4,t=3$wgiOH+EwI9eI34KIwIb+Qw$DJYhXvzAGtlI12wdOedP9PA5blXWTN+y16yxsF93p5k' as string,
} as const

export type Constants = typeof CONSTANTS