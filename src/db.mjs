import postgres from 'postgres';

export const connect = async () => {
  const { SUPABASE_HOST, SUPABASE_PORT, SUPABASE_USER, SUPABASE_PASSWORD } = process.env;

  const connectionString = `postgresql://${SUPABASE_USER}:${SUPABASE_PASSWORD}@${SUPABASE_HOST}:${SUPABASE_PORT}/postgres`;
  return postgres(connectionString, { prepare: true });
};

export const upsert = async ({
  sql,
  table,
  data,
  conflict,
  updateFields,
}) => {
  await sql`insert into ${sql(table)} ${sql(data, Object.keys(data))} on conflict (${sql(conflict || [])}) do update set ${
    sql(data, ...updateFields)
  }`;
};

export const insert = async ({
  sql,
  table,
  data,
}) => {
  await sql`insert into ${sql(table)} ${sql(data, Object.keys(data))} on conflict do nothing`;
};

export const remove = async ({
  sql,
  table,
  conditions,
}) => {
  await sql`delete from ${sql(table)} where ${Object.entries(conditions)
    .map(([k, v], i) => {
      return i === 0
        ? sql`${sql(k)} = ${sql(v)}`
        : sql`and ${sql(k)} = ${sql(v)}`;
    })
    .join(' ')}`;
}
