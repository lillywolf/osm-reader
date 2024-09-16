import postgres from 'postgres';
import { getLogger } from './logger.mjs';

const logger = getLogger();

export const connect = async ({onclose, onnotice}) => {
  const { SUPABASE_HOST, SUPABASE_PORT, SUPABASE_USER, SUPABASE_PASSWORD } = process.env;

  const connectionString = `postgresql://${SUPABASE_USER}:${SUPABASE_PASSWORD}@${SUPABASE_HOST}:${SUPABASE_PORT}/postgres`;
  return postgres(connectionString, { prepare: false, onclose, onnotice, max_lifetime: 86400, idle_timeout: 30 });
};

export const upsert = async ({
  sql,
  table,
  data,
  conflict,
  updateFields,
}) => {
  try {
    await sql`insert into ${sql(table)} ${sql(data, Object.keys(data))} on conflict (${sql(conflict || [])}) do update set ${
      sql(data, ...updateFields)
    }`;
  }
  catch (e) {
    logger.error(`POSTGRES ERROR: upsert failed for table ${table} and data ${JSON.stringify(data)}`, e);
  }
};

export const insert = async ({
  sql,
  table,
  data,
}) => {
  try {
    await sql`insert into ${sql(table)} ${sql(data, Object.keys(data))} on conflict do nothing`;
  }
  catch (e) {
    logger.error(`POSTGRES ERROR: insert failed for table ${table} and data ${JSON.stringify(data)}`, e);
  }
};

export const remove = async ({
  sql,
  table,
  conditions,
}) => {
  try {
    await sql`delete from ${sql(table)} where ${Object.entries(conditions)
      .map(([k, v], i) => {
        return i === 0
          ? sql`${sql(k)} = ${sql(v)}`
          : sql`and ${sql(k)} = ${sql(v)}`;
      })
      .join(' ')}`;
  }
  catch (e) {
    logger.error(`POSTGRES ERROR: remove failed for table ${table} and conditions ${JSON.stringify(conditions)}`, e);
  }
}
