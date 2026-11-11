// Adds a platform to every store. Existing stores become Lazada; change them afterwards if needed.
exports.up = async (knex) => {
  if (await knex.schema.hasColumn('stores', 'platform')) return;
  await knex.schema.alterTable('stores', (t) => {
    t.string('platform', 20).notNullable().defaultTo('Lazada');
  });
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasColumn('stores', 'platform'))) return;
  await knex.schema.alterTable('stores', (t) => t.dropColumn('platform'));
};