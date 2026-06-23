/**
 * LLMへ渡すtenant DBの固定スキーマ情報と業務ルールである。
 */
export const schemaContext = `
PostgreSQL tenant schema:

customers(customer_id text primary key, customer_unique_id text, customer_zip_code_prefix integer, customer_city text, customer_state text)
sellers(seller_id text primary key, seller_zip_code_prefix integer, seller_city text, seller_state text)
product_category_translations(product_category_name text primary key, product_category_name_english text)
products(product_id text primary key, product_category_name text, product_name_lenght integer, product_description_lenght integer, product_photos_qty integer, product_weight_g numeric, product_length_cm numeric, product_height_cm numeric, product_width_cm numeric)
orders(order_id text primary key, customer_id text, order_status text, order_purchase_timestamp timestamp, order_approved_at timestamp, order_delivered_carrier_date timestamp, order_delivered_customer_date timestamp, order_estimated_delivery_date timestamp)
order_items(order_id text, order_item_id integer, product_id text, seller_id text, shipping_limit_date timestamp, price numeric, freight_value numeric)
order_payments(order_id text, payment_sequential integer, payment_type text, payment_installments integer, payment_value numeric)
order_reviews(review_id text primary key, order_id text, review_score integer, review_comment_title text, review_comment_message text, review_creation_date timestamp, review_answer_timestamp timestamp)
geolocations(geolocation_zip_code_prefix integer, geolocation_lat numeric, geolocation_lng numeric, geolocation_city text, geolocation_state text)

Business rules:
- "2018年" means order_purchase_timestamp >= TIMESTAMP '2018-01-01 00:00:00' and < TIMESTAMP '2019-01-01 00:00:00'.
- "売り上げ" or "売上" means SUM(order_items.price), unless the user explicitly asks for payment amount.
- Ranking should use ORDER BY in descending order and a LIMIT when the user asks for top N.
- Return PostgreSQL SELECT SQL only.
`.trim();
