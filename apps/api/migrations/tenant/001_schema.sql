CREATE TABLE IF NOT EXISTS customers (
  customer_id text PRIMARY KEY,
  customer_unique_id text,
  customer_zip_code_prefix integer,
  customer_city text,
  customer_state text
);

CREATE TABLE IF NOT EXISTS sellers (
  seller_id text PRIMARY KEY,
  seller_zip_code_prefix integer,
  seller_city text,
  seller_state text
);

CREATE TABLE IF NOT EXISTS product_category_translations (
  product_category_name text PRIMARY KEY,
  product_category_name_english text
);

CREATE TABLE IF NOT EXISTS products (
  product_id text PRIMARY KEY,
  product_category_name text,
  product_name_lenght integer,
  product_description_lenght integer,
  product_photos_qty integer,
  product_weight_g numeric,
  product_length_cm numeric,
  product_height_cm numeric,
  product_width_cm numeric
);

CREATE TABLE IF NOT EXISTS orders (
  order_id text PRIMARY KEY,
  customer_id text,
  order_status text,
  order_purchase_timestamp timestamp,
  order_approved_at timestamp,
  order_delivered_carrier_date timestamp,
  order_delivered_customer_date timestamp,
  order_estimated_delivery_date timestamp
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id text NOT NULL,
  order_item_id integer NOT NULL,
  product_id text,
  seller_id text,
  shipping_limit_date timestamp,
  price numeric,
  freight_value numeric,
  PRIMARY KEY (order_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS order_payments (
  order_id text NOT NULL,
  payment_sequential integer NOT NULL,
  payment_type text,
  payment_installments integer,
  payment_value numeric,
  PRIMARY KEY (order_id, payment_sequential)
);

CREATE TABLE IF NOT EXISTS order_reviews (
  review_id text PRIMARY KEY,
  order_id text,
  review_score integer,
  review_comment_title text,
  review_comment_message text,
  review_creation_date timestamp,
  review_answer_timestamp timestamp
);

CREATE TABLE IF NOT EXISTS geolocations (
  geolocation_zip_code_prefix integer,
  geolocation_lat numeric,
  geolocation_lng numeric,
  geolocation_city text,
  geolocation_state text
);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_purchase_timestamp_idx ON orders(order_purchase_timestamp);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_seller_id_idx ON order_items(seller_id);
CREATE INDEX IF NOT EXISTS order_payments_order_id_idx ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS order_reviews_order_id_idx ON order_reviews(order_id);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(product_category_name);
CREATE INDEX IF NOT EXISTS geolocations_zip_idx ON geolocations(geolocation_zip_code_prefix);

DO $$
BEGIN
  CREATE ROLE tenant_readonly LOGIN PASSWORD 'tenant_readonly';
EXCEPTION
  WHEN duplicate_object THEN
    ALTER ROLE tenant_readonly WITH LOGIN PASSWORD 'tenant_readonly';
END
$$;

GRANT CONNECT ON DATABASE data_0001 TO tenant_readonly;
GRANT USAGE ON SCHEMA public TO tenant_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tenant_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tenant_readonly;
