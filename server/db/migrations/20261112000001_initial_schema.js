// Phase 4 — Initial schema.
// Conventions: money is stored as integer cents; timestamps are set by the DB
// (UTC); "is_active" soft-disables rows instead of deleting referenced data.

const { ROLES } = require('../../config/roles');

exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('username').notNullable().unique();
    t.string('display_name').notNullable();
    t.string('password_hash').notNullable();
    t.string('role').notNullable().defaultTo(ROLES.EMPLOYEE).checkIn(Object.values(ROLES));
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('stores', (t) => {
    t.increments('id');
    t.string('name').notNullable().unique();
    t.string('code').unique();
    t.string('address');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('products', (t) => {
    t.increments('id');
    t.string('sku').notNullable().unique();
    t.string('name').notNullable();
    t.integer('unit_price_cents').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('orders', (t) => {
    t.increments('id');
    t.integer('store_id').notNullable().references('id').inTable('stores').onDelete('RESTRICT');
    t.integer('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.date('order_date').notNullable();
    // 'approved' orders are locked: only admins edit them; employees file correction requests.
    t.string('status').notNullable().defaultTo('pending').checkIn(['pending', 'approved']);
    t.integer('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.text('notes');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['store_id']);
    t.index(['created_by']);
    t.index(['status']);
    t.index(['order_date']);
  });

  await knex.schema.createTable('order_lines', (t) => {
    t.increments('id');
    t.integer('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.integer('product_id').notNullable().references('id').inTable('products').onDelete('RESTRICT');
    t.integer('quantity').notNullable();
    // Price snapshot at entry time so later product price changes don't rewrite history.
    t.integer('unit_price_cents').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['order_id']);
    t.index(['product_id']);
  });

  await knex.schema.createTable('correction_requests', (t) => {
    t.increments('id');
    t.integer('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');
    t.integer('requested_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('message').notNullable();
    t.string('status').notNullable().defaultTo('open').checkIn(['open', 'resolved', 'rejected']);
    t.integer('resolved_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('resolved_at');
    t.text('resolution_note');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['order_id']);
    t.index(['status']);
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id');
    // Nullable + SET NULL so the log survives user removal; username kept as a snapshot.
    t.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('username');
    t.string('action').notNullable();      // e.g. 'order.approve', 'order.delete'
    t.string('entity_type').notNullable(); // e.g. 'order'
    t.integer('entity_id');
    t.text('details');                     // JSON string: before/after values, etc.
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['entity_type', 'entity_id']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  // Reverse dependency order.
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('correction_requests');
  await knex.schema.dropTableIfExists('order_lines');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('stores');
  await knex.schema.dropTableIfExists('users');
};
