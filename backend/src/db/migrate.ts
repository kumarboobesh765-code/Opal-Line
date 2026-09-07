import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from './schema'
import { defaultRolePermissions } from '../rbac'
import { roleNames } from './seedData'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })

  console.log('Ensuring roles table and users.permissions column...')
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "roles" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "permissions" jsonb NOT NULL,
      "is_system" boolean DEFAULT false NOT NULL,
      "created_at" timestamp,
      CONSTRAINT "roles_name_unique" UNIQUE("name")
    );
  `)
  await client.unsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permissions" jsonb;`)
  await client.unsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;`)
  await client.unsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;`)

  console.log('Seeding default roles (idempotent)...')
  for (const [i, name] of roleNames.entries()) {
    const existing = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1)
    if (existing[0]) continue
    await db.insert(schema.roles).values({
      id: `ROLE${i + 1}`,
      name,
      description: `${name} role with default module permissions`,
      permissions: defaultRolePermissions(name),
      isSystem: true,
      createdAt: new Date().toISOString(),
    })
    console.log(`  + ${name}`)
  }

  const roles = await db.select().from(schema.roles)
  console.log('Roles present:', roles.map((r) => r.name).join(', '))

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
