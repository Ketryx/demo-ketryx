```sql
-- tests/database/integrity_tests.sql

BEGIN;

SELECT plan(15);

-- Fixture setup
INSERT INTO users (id, username, email) VALUES
  (1, 'alice', 'alice@example.com'),
  (2, 'bob', 'bob@example.com'),
  (3, 'charlie', 'charlie@example.com');

INSERT INTO orders (id, user_id, total) VALUES
  (1, 1, 100.00),
  (2, 2, 50.00);

-- 1. Constraint validation: invalid email format should fail
SELECT
  throws_ok(
    $$ INSERT INTO users (id, username, email) VALUES (4, 'david', 'invalid-email') $$,
    '.*invalid input syntax for type email.*|.*check_email_format.*',
    'Constraint validation catches invalid email format'
  );

-- 2. Constraint validation: negative order total should fail
SELECT
  throws_ok(
    $$ INSERT INTO orders (id, user_id, total) VALUES (3, 1, -5) $$,
    '.*check_total_positive.*',
    'Constraint validation catches negative order total'
  );

-- 3. Orphaned record detection: Insert orphan order (user_id = 999)
INSERT INTO orders (id, user_id, total) VALUES (3, 999, 20.00);

SELECT is(
  (SELECT count(*) FROM orders o
   LEFT JOIN users u ON o.user_id = u.id
   WHERE u.id IS NULL),
  1,
  'Orphaned record detection: one order with missing user detected'
);

-- Cleanup orphan
DELETE FROM orders WHERE id = 3;

-- 4. Consistency check: Order total matches sum of order_items
-- Setup order_items table and data
CREATE TEMP TABLE order_items (
  id serial PRIMARY KEY,
  order_id int NOT NULL,
  product_id int NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  price numeric(10,2) NOT NULL CHECK (price >= 0)
);

INSERT INTO order_items (order_id, product_id, quantity, price) VALUES
  (1, 101, 2, 25.00),
  (1, 102, 1, 50.00),
  (2, 103, 1, 50.00);

-- Test consistency function: sum(quantity*price) = order total
SELECT is(
  (SELECT round(sum(quantity*price), 2) FROM order_items WHERE order_id = 1),
  (SELECT total FROM orders WHERE id = 1),
  'Consistency check: order 1 total matches sum of order_items'
);

SELECT is(
  (SELECT round(sum(quantity*price), 2) FROM order_items WHERE order_id = 2),
  (SELECT total FROM orders WHERE id = 2),
  'Consistency check: order 2 total matches sum of order_items'
);

-- 5. Referential integrity: prevent order with non-existing user (foreign key test)
SELECT
  throws_ok(
    $$ INSERT INTO orders (id, user_id, total) VALUES (4, 9999, 30) $$,
    '.*foreign key violation.*',
    'Referential integrity: foreign key violation on user_id'
  );

-- 6. Edge case: null username (should fail NOT NULL)
SELECT
  throws_ok(
    $$ INSERT INTO users (id, username, email) VALUES (5, NULL, 'nulluser@example.com') $$,
    '.*null value in column.*',
    'Edge case: null username violates NOT NULL constraint'
  );

-- 7. Edge case: empty string email should fail if format constraint exists
SELECT
  throws_ok(
    $$ INSERT INTO users (id, username, email) VALUES (6, 'emptyemail', '') $$,
    '.*invalid input syntax for type email.*|.*check_email_format.*',
    'Edge case: empty string email violates email format constraint'
  );

-- 8. Edge case: zero quantity in order_items violates CHECK
SELECT
  throws_ok(
    $$ INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (1, 104, 0, 10.00) $$,
    '.*check_quantity_positive.*',
    'Edge case: zero quantity violates check constraint'
  );

-- 9. Edge case: negative price in order_items violates CHECK
SELECT
  throws_ok(
    $$ INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (1, 105, 1, -10.00) $$,
    '.*check_price_non_negative.*',
    'Edge case: negative price violates check constraint'
  );

-- 10. Data cleanup tests
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM users;

SELECT finish();

ROLLBACK;
```