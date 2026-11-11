// One row per sold item on a store's monthly order sheet. Money is stored as integer cents.
exports.up = async (knex) => {
  if (await knex.schema.hasTable('sales_rows')) return;
  await knex.schema.createTable('sales_rows', (t) => {
    t.increments('id');
    t.integer('store_id').notNullable().references('id').inTable('stores').onDelete('RESTRICT');
    t.string('entry_month', 7).notNullable(); // 'YYYY-MM'
    t.string('order_number').notNullable();
    t.string('tracking_no');
    t.string('product_code');
    t.string('product_name').notNullable();
    t.integer('distributor_price_cents').notNullable().defaultTo(0);
    t.integer('qty').notNullable().defaultTo(1);
    t.integer('retail_price_cents');
    t.integer('paid_by_customer_cents');
    t.integer('received_cents');
    t.integer('price_adjustment_cents');
    t.string('shipping_status').notNullable().defaultTo('Shipping');
    t.string('remarks');
    t.boolean('approved').notNullable().defaultTo(false);
    t.integer('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.integer('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['store_id', 'entry_month']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sales_rows');
};