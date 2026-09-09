import { config, isConfigured } from './config'
import { getRawClient } from './db/client'
import { logger } from './logger'

/**
 * Enhanced Shopify data fetching.
 *
 * Shopify webhooks send minimal data (name, city, country only).
 * This module uses the GraphQL Admin API to fetch full customer details:
 * - Email, phone, full address
 * - Order history and total spent
 * - Tags, notes, created/updated dates
 *
 * Also supports CSV import for bulk data enrichment.
 */

interface GraphQLResponse<T = any> {
  data?: T
  errors?: Array<{ message: string }>
}

async function graphqlRequest<T>(query: string, variables?: Record<string, any>): Promise<T | null> {
  if (!isConfigured()) return null

  const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': config.accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!res.ok) {
      logger.error({ status: res.status }, 'Shopify GraphQL request failed')
      return null
    }

    const json: GraphQLResponse<T> = await res.json()
    if (json.errors?.length) {
      logger.error({ errors: json.errors }, 'Shopify GraphQL errors')
      return null
    }
    return json.data ?? null
  } catch (err) {
    logger.error({ err }, 'Shopify GraphQL request exception')
    return null
  }
}

// ─── Fetch full customer details ──────────────────────────────────

export interface ShopifyCustomer {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  ordersCount: number
  totalSpent: string
  tags: string[]
  createdAt: string
  updatedAt: string
  defaultAddress?: {
    address1: string
    address2: string
    city: string
    province: string
    zip: string
    country: string
    phone: string
  }
}

export async function fetchCustomerById(shopifyCustomerId: string): Promise<ShopifyCustomer | null> {
  const gql = `query ($q: String!) {
    customers(first: 1, query: $q) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          ordersCount
          totalSpent
          tags
          createdAt
          updatedAt
          defaultAddress {
            address1
            address2
            city
            province
            zip
            country
            phone
          }
        }
      }
    }
  }`

  const data = await graphqlRequest<{ customers: { edges: Array<{ node: any }> } }>(gql, { q: `id:${shopifyCustomerId}` })
  if (!data?.customers?.edges?.length) return null

  const c = data.customers.edges[0].node
  return {
    id: c.id?.replace('gid://shopify/Customer/', '') || shopifyCustomerId,
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email || null,
    phone: c.phone || null,
    ordersCount: c.ordersCount || 0,
    totalSpent: c.totalSpent || '0.0',
    tags: c.tags || [],
    createdAt: c.createdAt || '',
    updatedAt: c.updatedAt || '',
    defaultAddress: c.defaultAddress ? {
      address1: c.defaultAddress.address1 || '',
      address2: c.defaultAddress.address2 || '',
      city: c.defaultAddress.city || '',
      province: c.defaultAddress.province || '',
      zip: c.defaultAddress.zip || '',
      country: c.defaultAddress.country || '',
      phone: c.defaultAddress.phone || '',
    } : undefined,
  }
}

export async function fetchCustomerBySearch(query: string): Promise<ShopifyCustomer | null> {
  const gql = `query ($q: String!) {
    customers(first: 1, query: $q) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          ordersCount
          totalSpent
          tags
          createdAt
          updatedAt
          defaultAddress {
            address1
            address2
            city
            province
            zip
            country
            phone
          }
        }
      }
    }
  }`

  const data = await graphqlRequest<{ customers: { edges: Array<{ node: any }> } }>(gql, { q: query })
  if (!data?.customers?.edges?.length) return null

  const c = data.customers.edges[0].node
  return {
    id: c.id?.replace('gid://shopify/Customer/', '') || '',
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email || null,
    phone: c.phone || null,
    ordersCount: c.ordersCount || 0,
    totalSpent: c.totalSpent || '0.0',
    tags: c.tags || [],
    createdAt: c.createdAt || '',
    updatedAt: c.updatedAt || '',
    defaultAddress: c.defaultAddress ? {
      address1: c.defaultAddress.address1 || '',
      address2: c.defaultAddress.address2 || '',
      city: c.defaultAddress.city || '',
      province: c.defaultAddress.province || '',
      zip: c.defaultAddress.zip || '',
      country: c.defaultAddress.country || '',
      phone: c.defaultAddress.phone || '',
    } : undefined,
  }
}

// ─── Fetch full order details ─────────────────────────────────────

export interface ShopifyOrder {
  id: string
  name: string
  email: string | null
  phone: string | null
  totalPrice: string
  subtotalPrice: string
  totalTax: string
  currency: string
  financialStatus: string
  fulfillmentStatus: string
  createdAt: string
  updatedAt: string
  customer?: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  billingAddress?: {
    firstName: string
    lastName: string
    address1: string
    address2: string
    city: string
    province: string
    zip: string
    country: string
    phone: string
  }
  shippingAddress?: {
    firstName: string
    lastName: string
    address1: string
    address2: string
    city: string
    province: string
    zip: string
    country: string
    phone: string
  }
  lineItems: Array<{
    title: string
    sku: string
    quantity: number
    price: string
    variant?: { sku: string }
  }>
}

export async function fetchOrderById(shopifyOrderId: string): Promise<ShopifyOrder | null> {
  const query = `query ($id: ID!) {
    orderById(id: $id) {
      id
      name
      email
      phone
      totalPrice
      subtotalPrice
      totalTax
      currency
      financialStatus
      fulfillmentStatus
      createdAt
      updatedAt
      customer {
        id
        firstName
        lastName
        email
        phone
      }
      billingAddress {
        firstName
        lastName
        address1
        address2
        city
        province
        zip
        country
        phone
      }
      shippingAddress {
        firstName
        lastName
        address1
        address2
        city
        province
        zip
        country
        phone
      }
      lineItems(first: 50) {
        edges {
          node {
            title
            sku
            quantity
            price
            variant { sku }
          }
        }
      }
    }
  }`

  const data = await graphqlRequest<{ orderById: any }>(query, { id: `gid://shopify/Order/${shopifyOrderId}` })
  if (!data?.orderById) return null

  const o = data.orderById
  return {
    id: o.id?.replace('gid://shopify/Order/', '') || shopifyOrderId,
    name: o.name || '',
    email: o.email || null,
    phone: o.phone || null,
    totalPrice: o.totalPrice || '0.0',
    subtotalPrice: o.subtotalPrice || '0.0',
    totalTax: o.totalTax || '0.0',
    currency: o.currency || 'INR',
    financialStatus: o.financialStatus || '',
    fulfillmentStatus: o.fulfillmentStatus || '',
    createdAt: o.createdAt || '',
    updatedAt: o.updatedAt || '',
    customer: o.customer ? {
      id: o.customer.id?.replace('gid://shopify/Customer/', '') || '',
      firstName: o.customer.firstName || '',
      lastName: o.customer.lastName || '',
      email: o.customer.email || '',
      phone: o.customer.phone || '',
    } : undefined,
    billingAddress: o.billingAddress ? {
      firstName: o.billingAddress.firstName || '',
      lastName: o.billingAddress.lastName || '',
      address1: o.billingAddress.address1 || '',
      address2: o.billingAddress.address2 || '',
      city: o.billingAddress.city || '',
      province: o.billingAddress.province || '',
      zip: o.billingAddress.zip || '',
      country: o.billingAddress.country || '',
      phone: o.billingAddress.phone || '',
    } : undefined,
    shippingAddress: o.shippingAddress ? {
      firstName: o.shippingAddress.firstName || '',
      lastName: o.shippingAddress.lastName || '',
      address1: o.shippingAddress.address1 || '',
      address2: o.shippingAddress.address2 || '',
      city: o.shippingAddress.city || '',
      province: o.shippingAddress.province || '',
      zip: o.shippingAddress.zip || '',
      country: o.shippingAddress.country || '',
      phone: o.shippingAddress.phone || '',
    } : undefined,
    lineItems: o.lineItems?.edges?.map((e: any) => ({
      title: e.node.title || '',
      sku: e.node.sku || e.node.variant?.sku || '',
      quantity: e.node.quantity || 0,
      price: e.node.price || '0.0',
      variant: e.node.variant ? { sku: e.node.variant.sku || '' } : undefined,
    })) || [],
  }
}

// ─── Enrich local customers with Shopify data ─────────────────────

export async function enrichCustomersFromShopify(): Promise<{ enriched: number; failed: number }> {
  const client = getRawClient()
  if (!client) return { enriched: 0, failed: 0 }

  let enriched = 0
  let failed = 0

  try {
    // Find customers missing email or phone
    const incomplete = await client.unsafe(
      `SELECT id, name, email, phone, shopify_id FROM customers
       WHERE (email IS NULL OR email = '' OR phone IS NULL OR phone = '')
       AND shopify_id IS NOT NULL AND shopify_id != ''
       LIMIT 50`
    )

    for (const cust of incomplete as any[]) {
      try {
        const shopifyData = await fetchCustomerById(cust.shopify_id)
        if (!shopifyData) { failed++; continue }

        const updates: string[] = []
        const values: any[] = []

        if (!cust.email && shopifyData.email) {
          updates.push(`email = $${values.length + 1}`)
          values.push(shopifyData.email)
        }
        if (!cust.phone && shopifyData.phone) {
          updates.push(`phone = $${values.length + 1}`)
          values.push(shopifyData.phone)
        }
        if (shopifyData.defaultAddress?.city && !cust.city) {
          updates.push(`city = $${values.length + 1}`)
          values.push(shopifyData.defaultAddress.city)
        }
        if (shopifyData.defaultAddress?.province) {
          updates.push(`province = $${values.length + 1}`)
          values.push(shopifyData.defaultAddress.province)
        }

        if (updates.length > 0) {
          values.push(cust.id)
          await client.unsafe(`UPDATE customers SET ${updates.join(', ')} WHERE id = $${values.length}`, values)
          enriched++
          logger.info({ customerId: cust.id, shopifyId: cust.shopify_id }, 'Customer enriched from Shopify')
        }
      } catch (err) {
        logger.error({ err, customerId: cust.id }, 'Customer enrichment failed')
        failed++
      }

      // Rate limit: 500ms between requests
      await new Promise(r => setTimeout(r, 500))
    }
  } catch (err) {
    logger.error({ err }, 'Customer enrichment batch failed')
  }

  return { enriched, failed }
}

// ─── Enrich orders with full customer data ────────────────────────

export async function enrichOrdersFromShopify(): Promise<{ enriched: number; failed: number }> {
  const client = getRawClient()
  if (!client) return { enriched: 0, failed: 0 }

  let enriched = 0
  let failed = 0

  try {
    // Find orders missing billing address or with minimal customer data
    const incomplete = await client.unsafe(
      `SELECT id, shopify_id, customer FROM sales_orders
       WHERE (billing_address IS NULL OR billing_address = '{}'::jsonb OR customer IS NULL OR customer = '')
       AND shopify_id IS NOT NULL AND shopify_id != ''
       LIMIT 50`
    )

    for (const order of incomplete as any[]) {
      try {
        const shopifyId = order.shopify_id?.replace('gid://shopify/Order/', '') || ''
        if (!shopifyId) { failed++; continue }

        const shopifyData = await fetchOrderById(shopifyId)
        if (!shopifyData) { failed++; continue }

        const updates: string[] = []
        const values: any[] = []

        if (shopifyData.billingAddress) {
          const addr = {
            name: `${shopifyData.billingAddress.firstName} ${shopifyData.billingAddress.lastName}`.trim(),
            address1: shopifyData.billingAddress.address1,
            address2: shopifyData.billingAddress.address2,
            city: shopifyData.billingAddress.city,
            province: shopifyData.billingAddress.province,
            zip: shopifyData.billingAddress.zip,
            country: shopifyData.billingAddress.country,
            phone: shopifyData.billingAddress.phone,
          }
          updates.push(`billing_address = $${values.length + 1}`)
          values.push(JSON.stringify(addr))
        }
        if (shopifyData.shippingAddress) {
          const addr = {
            name: `${shopifyData.shippingAddress.firstName} ${shopifyData.shippingAddress.lastName}`.trim(),
            address1: shopifyData.shippingAddress.address1,
            address2: shopifyData.shippingAddress.address2,
            city: shopifyData.shippingAddress.city,
            province: shopifyData.shippingAddress.province,
            zip: shopifyData.shippingAddress.zip,
            country: shopifyData.shippingAddress.country,
            phone: shopifyData.shippingAddress.phone,
          }
          updates.push(`shipping_address = $${values.length + 1}`)
          values.push(JSON.stringify(addr))
        }

        if (updates.length > 0) {
          values.push(order.id)
          await client.unsafe(`UPDATE sales_orders SET ${updates.join(', ')} WHERE id = $${values.length}`, values)
          enriched++
          logger.info({ orderId: order.id, shopifyId }, 'Order enriched from Shopify')
        }
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Order enrichment failed')
        failed++
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500))
    }
  } catch (err) {
    logger.error({ err }, 'Order enrichment batch failed')
  }

  return { enriched, failed }
}

// ─── Enrich all incomplete orders via GraphQL ─────────────────────

export interface EnrichResult {
  enriched: number
  failed: number
  skipped: number
  errors: string[]
}

export async function enrichAllIncompleteOrders(): Promise<EnrichResult> {
  const client = getRawClient()
  if (!client) return { enriched: 0, failed: 0, skipped: 0, errors: ['Database not available'] }

  const result: EnrichResult = { enriched: 0, failed: 0, skipped: 0, errors: [] }

  try {
    // Find orders with incomplete data: missing billing address, Guest customer, or missing shipping address
    const incomplete = await client.unsafe(
      `SELECT id, shopify_id, customer, billing_address, shipping_address
       FROM sales_orders
       WHERE shopify_id IS NOT NULL AND shopify_id != ''
         AND (
           billing_address IS NULL OR billing_address = '{}'::jsonb OR billing_address->>'name' = ''
           OR customer IS NULL OR customer = '' OR customer = 'Guest'
           OR shipping_address IS NULL OR shipping_address = '{}'::jsonb OR shipping_address->>'name' = ''
         )
       ORDER BY date DESC
       LIMIT 100`
    )

    if ((incomplete as any[]).length === 0) {
      return { enriched: 0, failed: 0, skipped: 0, errors: [] }
    }

    logger.info({ count: (incomplete as any[]).length }, 'Starting order enrichment via GraphQL')

    for (const order of incomplete as any[]) {
      try {
        const shopifyIdNum = order.shopify_id?.replace('#', '') || ''
        if (!shopifyIdNum) { result.skipped++; continue }

        // Fetch full order details via GraphQL
        const gqlOrder = await fetchOrderById(shopifyIdNum)
        if (!gqlOrder) {
          result.skipped++
          continue
        }

        const updates: Record<string, any> = {}

        // Update customer name if we have a better one
        const currentName = order.customer || ''
        if (gqlOrder.customer && (currentName === 'Guest' || !currentName)) {
          const gqlName = `${gqlOrder.customer.firstName} ${gqlOrder.customer.lastName}`.trim()
          if (gqlName) updates.customer = gqlName
        }
        if (gqlOrder.email && (!currentName || currentName === 'Guest')) {
          const gqlName = `${gqlOrder.customer?.firstName || ''} ${gqlOrder.customer?.lastName || ''}`.trim()
          if (!gqlName && gqlOrder.email) updates.customer = gqlOrder.email
        }

        // Build billing address
        if (gqlOrder.billingAddress) {
          const addr = gqlOrder.billingAddress
          const existingBilling = order.billing_address
          const billingName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim()
          const existingName = existingBilling?.name || ''
          // Update if we have new data that's better than what exists
          if (billingName || addr.address1 || addr.city) {
            updates.billingAddress = {
              name: billingName || existingName,
              address1: addr.address1 || existingBilling?.address1 || '',
              address2: addr.address2 || existingBilling?.address2 || '',
              city: addr.city || existingBilling?.city || '',
              province: addr.province || existingBilling?.province || '',
              zip: addr.zip || existingBilling?.zip || '',
              country: addr.country || existingBilling?.country || '',
              phone: addr.phone || existingBilling?.phone || '',
            }
          }
        }

        // Build shipping address
        if (gqlOrder.shippingAddress) {
          const addr = gqlOrder.shippingAddress
          const existingShipping = order.shipping_address
          const shipName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim()
          const existingName = existingShipping?.name || ''
          if (shipName || addr.address1 || addr.city) {
            updates.shippingAddress = {
              name: shipName || existingName,
              address1: addr.address1 || existingShipping?.address1 || '',
              address2: addr.address2 || existingShipping?.address2 || '',
              city: addr.city || existingShipping?.city || '',
              province: addr.province || existingShipping?.province || '',
              zip: addr.zip || existingShipping?.zip || '',
              country: addr.country || existingShipping?.country || '',
              phone: addr.phone || existingShipping?.phone || '',
            }
          }
        }

        // Update line items if available
        if (gqlOrder.lineItems?.length) {
          updates.lineItems = gqlOrder.lineItems.map(li => ({
            title: li.title,
            sku: li.sku,
            quantity: li.quantity,
            price: Math.round(Number(li.price) * 100) / 100,
          }))
        }

        if (Object.keys(updates).length === 0) {
          result.skipped++
          continue
        }

        await client.unsafe(
          `UPDATE sales_orders SET
            customer = COALESCE($1, customer),
            billing_address = COALESCE($2::jsonb, billing_address),
            shipping_address = COALESCE($3::jsonb, shipping_address),
            line_items = COALESCE($4::jsonb, line_items)
          WHERE id = $5`,
          [
            updates.customer || null,
            updates.billingAddress ? JSON.stringify(updates.billingAddress) : null,
            updates.shippingAddress ? JSON.stringify(updates.shippingAddress) : null,
            updates.lineItems ? JSON.stringify(updates.lineItems) : null,
            order.id,
          ]
        )
        result.enriched++
        logger.info({ orderId: order.id, shopifyId: order.shopify_id }, 'Order enriched via GraphQL')

        // Also enrich the customer record if we have customer data from the order
        if (gqlOrder.customer?.id) {
          try {
            const gqlCustomer = await fetchCustomerById(gqlOrder.customer.id)
            if (gqlCustomer) {
              const customerEmail = gqlCustomer.email || gqlOrder.email || null
              const customerPhone = gqlCustomer.phone || gqlOrder.phone || null
              const fullName = `${gqlCustomer.firstName} ${gqlCustomer.lastName}`.trim()

              if (customerEmail || customerPhone) {
                await client.unsafe(
                  `UPDATE customers SET
                    name = CASE WHEN name = 'Guest' OR name IS NULL OR name = '' THEN COALESCE($1, name) ELSE name END,
                    email = COALESCE($2, email),
                    phone = COALESCE($3, phone),
                    city = COALESCE($4, city),
                    province = COALESCE($5, province)
                  WHERE shopify_id = $6 OR email = $2 OR phone = $3`,
                  [
                    fullName || null,
                    customerEmail,
                    customerPhone,
                    gqlCustomer.defaultAddress?.city || null,
                    gqlCustomer.defaultAddress?.province || null,
                    gqlOrder.customer.id,
                  ]
                )
              }
            }
          } catch {
            // Customer enrichment failure should not block order enrichment
          }
        }

        // Rate limit: 500ms between GraphQL requests
        await new Promise(r => setTimeout(r, 500))
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Order enrichment failed')
        result.failed++
        result.errors.push(err instanceof Error ? err.message : 'Unknown error')
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logger.error({ err }, 'Enrichment batch failed')
    result.errors.push(msg)
  }

  logger.info({ enriched: result.enriched, failed: result.failed, skipped: result.skipped }, 'Order enrichment complete')
  return result
}

// ─── CSV Import ───────────────────────────────────────────────────

export interface CSVImportResult {
  imported: number
  updated: number
  errors: string[]
}

export async function importCustomersFromCSV(rows: Record<string, string>[]): Promise<CSVImportResult> {
  const client = getRawClient()
  if (!client) return { imported: 0, updated: 0, errors: ['DB unavailable'] }

  const result: CSVImportResult = { imported: 0, updated: 0, errors: [] }

  for (const row of rows) {
    try {
      const name = row.name || row.Name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown'
      const email = row.email || row.Email || null
      const phone = row.phone || row.Phone || row.mobile || row.Mobile || null
      const address = row.address || row.Address || null
      const shopifyId = row.shopify_id || row.shopifyId || row.id || null

      if (!name || name === 'Unknown') {
        result.errors.push(`Row skipped: no name`)
        continue
      }

      // Check if customer exists by email, phone, or shopify_id
      let existing = null
      if (email) {
        const rows = await client.unsafe(`SELECT id FROM customers WHERE email = $1 LIMIT 1`, [email])
        existing = rows[0]
      }
      if (!existing && phone) {
        const rows = await client.unsafe(`SELECT id FROM customers WHERE phone = $1 LIMIT 1`, [phone])
        existing = rows[0]
      }
      if (!existing && shopifyId) {
        const rows = await client.unsafe(`SELECT id FROM customers WHERE shopify_id = $1 LIMIT 1`, [shopifyId])
        existing = rows[0]
      }

      if (existing) {
        // Update existing customer with new data
        const updates: string[] = []
        const values: any[] = []
        if (email && !existing.email) { updates.push(`email = $${values.length + 1}`); values.push(email) }
        if (phone && !existing.phone) { updates.push(`phone = $${values.length + 1}`); values.push(phone) }
        if (address) { updates.push(`address = $${values.length + 1}`); values.push(address) }

        if (updates.length > 0) {
          values.push(existing.id)
          await client.unsafe(`UPDATE customers SET ${updates.join(', ')} WHERE id = $${values.length}`, values)
          result.updated++
        }
      } else {
        // Create new customer
        const id = `cust-csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await client.unsafe(
          `INSERT INTO customers (id, name, email, phone, address, shopify_id) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, name, email, phone, address, shopifyId]
        )
        result.imported++
      }
    } catch (err) {
      result.errors.push(`Row error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  return result
}

export async function importOrdersFromCSV(rows: Record<string, string>[]): Promise<CSVImportResult> {
  const client = getRawClient()
  if (!client) return { imported: 0, updated: 0, errors: ['DB unavailable'] }

  const result: CSVImportResult = { imported: 0, updated: 0, errors: [] }

  for (const row of rows) {
    try {
      const orderNumber = row.order_number || row['Order Number'] || row.invoice || row.Invoice
      const customerName = row.customer || row.Customer || row.name || row.Name
      const email = row.email || row.Email || null
      const phone = row.phone || row.Phone || null
      const total = row.total || row.Total || row.grand_total || row['Grand Total'] || '0'
      const date = row.date || row.Date || row.created_at || new Date().toISOString()
      const status = row.status || row.Status || 'confirmed'

      if (!orderNumber) {
        result.errors.push(`Row skipped: no order number`)
        continue
      }

      const existing = await client.unsafe(`SELECT id FROM sales_orders WHERE shopify_id = $1 LIMIT 1`, [orderNumber])

      if (existing.length > 0) {
        result.updated++
      } else {
        const id = `ord-csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await client.unsafe(
          `INSERT INTO sales_orders (id, shopify_id, customer, email, phone, value, status, date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, orderNumber, customerName || 'Unknown', email, phone, parseFloat(total) || 0, status, date]
        )
        result.imported++
      }
    } catch (err) {
      result.errors.push(`Row error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  return result
}