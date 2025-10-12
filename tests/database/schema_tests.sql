```sql
-- tests/database/schema_tests.sql

BEGIN;

-- Load pgTAP
SET search_path = public, pg_catalog;

SELECT plan( (
    -- Count of tests
    10  -- Adjust if adding/removing tests below
) );

-- 1. Check tables exist
SELECT has_table('users', 'Table "users" exists');
SELECT has_table('orders', 'Table "orders" exists');
SELECT has_table('products', 'Table "products" exists');

-- 2. Check columns and data types (table: users)
SELECT col_is('users', 'id', 'integer', 'users.id column exists as integer');
SELECT col_is('users', 'email', 'text', 'users.email column exists as text');
SELECT col_is('users', 'created_at', 'timestamp with time zone', 'users.created_at column exists as timestamp with timezone');
SELECT col_is('users', 'encrypted_ssn', 'bytea', 'users.encrypted_ssn column exists as bytea (encrypted)');

-- 3. Check columns and data types (table: orders)
SELECT col_is('orders', 'id', 'integer', 'orders.id column exists as integer');
SELECT col_is('orders', 'user_id', 'integer', 'orders.user_id column exists as integer');
SELECT col_is('orders', 'created_at', 'timestamp with time zone', 'orders.created_at column exists as timestamp with timezone');
SELECT col_is('orders', 'total_amount', 'numeric', 'orders.total_amount column exists as numeric');

-- 4. Check indexes
SELECT has_index('users', 'users_email_idx', 'unique index on users.email');
SELECT has_index('orders', 'orders_user_id_idx', 'index on orders.user_id');

-- 5. Check foreign key constraints (orders.user_id -> users.id)
SELECT fk_exists('orders', 'user_id', 'users', 'id', 'orders.user_id fk references users.id');

-- 6. Check row level security enabled
SELECT row_level_security_enabled('users', 'Row Level Security is enabled on users');
SELECT row_level_security_enabled('orders', 'Row Level Security is enabled on orders');

-- 7. Check policies exist on tables
SELECT policy_exists('users', 'user_select_policy', 'Select policy exists on users');
SELECT policy_exists('orders', 'order_select_policy', 'Select policy exists on orders');

-- 8. Check encryption (column encrypted_ssn is of type bytea indicating encrypted data storage)
-- Already checked in column type; add a check for encryption function (assumed exists)
SELECT exists('SELECT 1 FROM pg_proc WHERE proname = ''encrypt_ssn''') AS has_encrypt_fn;
SELECT ok(has_encrypt_fn, 'Encryption function encrypt_ssn exists');

-- 9. Check default values
SELECT col_default_is('users', 'created_at', 'now()', 'users.created_at has default now()');
SELECT col_default_is('orders', 'created_at', 'now()', 'orders.created_at has default now()');

-- 10. Check presence of primary keys
SELECT has_primary_key('users', 'Primary key exists on users');
SELECT has_primary_key('orders', 'Primary key exists on orders');

SELECT * FROM finish();

ROLLBACK;

-- Helper functions for convenience
CREATE OR REPLACE FUNCTION has_table(tblname text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_plan(1) FROM pg_tables WHERE tablename = tblname;
$$;

CREATE OR REPLACE FUNCTION col_is(tbl text, col text, typ text, description text) RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY SELECT diag_is(
        (SELECT format_type(atttypid, atttypmod)
         FROM pg_attribute
         WHERE attrelid = tbl::regclass AND attname = col AND NOT attisdropped),
        typ,
        description
    );
END;
$$;

CREATE OR REPLACE FUNCTION fk_exists(tbl text, col text, reftbl text, refcol text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_is(
        (SELECT count(*) FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         JOIN pg_class r ON r.oid = c.confrelid
         JOIN pg_attribute ra ON ra.attrelid = r.oid AND ra.attnum = ANY(c.confkey)
         WHERE c.conrelid = tbl::regclass AND a.attname = col
           AND c.confrelid = reftbl::regclass AND ra.attname = refcol
           AND c.contype = 'f'),
        1,
        description);
$$;

CREATE OR REPLACE FUNCTION has_index(tbl text, idxname text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_is(
        (SELECT count(*) FROM pg_class c
         JOIN pg_index i ON i.indexrelid = c.oid
         WHERE c.relname = idxname AND i.indrelid = tbl::regclass),
        1,
        description);
$$;

CREATE OR REPLACE FUNCTION row_level_security_enabled(tbl text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_is(
        (SELECT relrowsecurity FROM pg_class WHERE oid = tbl::regclass),
        true,
        description);
$$;

CREATE OR REPLACE FUNCTION policy_exists(tbl text, polname text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_is(
        (SELECT count(*) FROM pg_policy WHERE polname = polname AND polrelid = tbl::regclass),
        1,
        description);
$$;

CREATE OR REPLACE FUNCTION col_default_is(tbl text, col text, deftext text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_is(
        (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
         WHERE adrelid = tbl::regclass AND adnum = 
               (SELECT attnum FROM pg_attribute WHERE attrelid = tbl::regclass AND attname = col)),
        deftext,
        description);
$$;

CREATE OR REPLACE FUNCTION has_primary_key(tbl text, description text) RETURNS SETOF text LANGUAGE sql AS $$
    SELECT diag_is(
        (SELECT count(*) FROM pg_constraint WHERE conrelid = tbl::regclass AND contype = 'p'),
        1,
        description);
$$;
```