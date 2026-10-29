import { canonicalLocale } from '@odudu/contracts';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { messageOverrides } from '#/schema/message-overrides';

// ADR 0043: bounded in count per tenant, across every locale.
export const MAX_MESSAGE_OVERRIDES = 500;

export interface MessageOverrideRecord {
  locale: string;
  key: string;
  message: string;
  updatedAt: Date;
}

export interface NewMessageOverride {
  tenantId: string;
  locale: string;
  key: string;
  message: string;
}

export type PutMessageOverrideOutcome = 'ok' | 'over_bound' | 'unknown_key' | 'invalid_locale';

export interface MessageOverrideDeps {
  // Whether a key is an entry of the English catalogue of some page; the
  // packages that own the catalogues answer it.
  isKnownKey: (key: string) => boolean;
}

export function messageOverrideRepository(tx: TenantScopedDatabase, deps: MessageOverrideDeps) {
  return {
    // One page of a locale's overrides in key order, starting after `after`;
    // never more than a page over MAX_LIMIT whatever `limit` asks for.
    async list(
      tenantId: string,
      locale: string,
      page: { after?: string | undefined; limit: number },
    ): Promise<MessageOverrideRecord[]> {
      const tag = canonicalLocale(locale);
      if (tag === null) return [];
      return tx
        .select({
          locale: messageOverrides.locale,
          key: messageOverrides.key,
          message: messageOverrides.message,
          updatedAt: messageOverrides.updatedAt,
        })
        .from(messageOverrides)
        .where(
          and(
            eq(messageOverrides.tenantId, tenantId),
            eq(messageOverrides.locale, tag),
            page.after === undefined ? undefined : gt(messageOverrides.key, page.after),
          ),
        )
        .orderBy(asc(messageOverrides.key))
        .limit(Math.max(1, Math.min(page.limit, MAX_LIMIT + 1)));
    },

    async get(
      tenantId: string,
      locale: string,
      key: string,
    ): Promise<MessageOverrideRecord | null> {
      const tag = canonicalLocale(locale);
      if (tag === null) return null;
      const [row] = await tx
        .select({
          locale: messageOverrides.locale,
          key: messageOverrides.key,
          message: messageOverrides.message,
          updatedAt: messageOverrides.updatedAt,
        })
        .from(messageOverrides)
        .where(
          and(
            eq(messageOverrides.tenantId, tenantId),
            eq(messageOverrides.locale, tag),
            eq(messageOverrides.key, key),
          ),
        );
      return row ?? null;
    },

    // Every override the tenant holds, in locale and key order: at most
    // MAX_MESSAGE_OVERRIDES rows, by the primary key. What an export carries.
    async all(tenantId: string): Promise<MessageOverrideRecord[]> {
      return tx
        .select({
          locale: messageOverrides.locale,
          key: messageOverrides.key,
          message: messageOverrides.message,
          updatedAt: messageOverrides.updatedAt,
        })
        .from(messageOverrides)
        .where(eq(messageOverrides.tenantId, tenantId))
        .orderBy(asc(messageOverrides.locale), asc(messageOverrides.key))
        .limit(MAX_MESSAGE_OVERRIDES);
    },

    // Every override of one locale as a key-to-message map, which a page
    // render reads: at most MAX_MESSAGE_OVERRIDES rows, by the primary key.
    async forRender(tenantId: string, locale: string): Promise<Record<string, string>> {
      const tag = canonicalLocale(locale);
      if (tag === null) return {};
      const rows = await tx
        .select({ key: messageOverrides.key, message: messageOverrides.message })
        .from(messageOverrides)
        .where(and(eq(messageOverrides.tenantId, tenantId), eq(messageOverrides.locale, tag)))
        .limit(MAX_MESSAGE_OVERRIDES);
      return Object.fromEntries(rows.map((row) => [row.key, row.message]));
    },

    // Every override of the tenant as locale to key-to-message maps, which a
    // mail reads because the language it is written in is only known once
    // the recipient is: one statement, at most MAX_MESSAGE_OVERRIDES rows.
    async forMail(tenantId: string): Promise<Record<string, Record<string, string>>> {
      const rows = await tx
        .select({
          locale: messageOverrides.locale,
          key: messageOverrides.key,
          message: messageOverrides.message,
        })
        .from(messageOverrides)
        .where(eq(messageOverrides.tenantId, tenantId))
        .limit(MAX_MESSAGE_OVERRIDES);
      const byLocale: Record<string, Record<string, string>> = {};
      for (const { locale, key, message } of rows) {
        (byLocale[locale] ??= {})[key] = message;
      }
      return byLocale;
    },

    // Writers of one tenant are serialised, so the count read below is the
    // count the insert lands on. Changing an override that exists never
    // counts against the bound.
    async put(override: NewMessageOverride): Promise<PutMessageOverrideOutcome> {
      const locale = canonicalLocale(override.locale);
      if (locale === null) return 'invalid_locale';
      if (!deps.isKnownKey(override.key)) return 'unknown_key';
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`message_overrides:${override.tenantId}`}, 0))`,
      );
      const [held] = await tx
        .select({
          n: sql<number>`count(*)::int`,
          same: sql<number>`count(*) filter (where ${messageOverrides.locale} = ${locale} and ${messageOverrides.key} = ${override.key})::int`,
        })
        .from(messageOverrides)
        .where(eq(messageOverrides.tenantId, override.tenantId));
      if ((held?.same ?? 0) === 0 && (held?.n ?? 0) >= MAX_MESSAGE_OVERRIDES) return 'over_bound';
      await tx
        .insert(messageOverrides)
        .values({ ...override, locale })
        .onConflictDoUpdate({
          target: [messageOverrides.tenantId, messageOverrides.locale, messageOverrides.key],
          set: { message: override.message, updatedAt: sql`now()` },
        });
      return 'ok';
    },

    async delete(tenantId: string, locale: string, key: string): Promise<boolean> {
      const tag = canonicalLocale(locale);
      if (tag === null) return false;
      const rows = await tx
        .delete(messageOverrides)
        .where(
          and(
            eq(messageOverrides.tenantId, tenantId),
            eq(messageOverrides.locale, tag),
            eq(messageOverrides.key, key),
          ),
        )
        .returning({ key: messageOverrides.key });
      return rows.length > 0;
    },
  };
}
