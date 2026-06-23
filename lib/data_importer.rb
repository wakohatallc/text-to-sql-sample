require 'pg'
require 'csv'
require 'dotenv/load'

class DataImporter
  TABLES = %w[
    order_reviews
    order_payments
    order_items
    orders
    products
    product_category_translations
    sellers
    customers
    geolocations
  ].freeze

  def initialize
    @conn = PG.connect(
      host: ENV.fetch('POSTGRES_HOST', 'localhost'),
      port: ENV.fetch('POSTGRES_PORT', '5432'),
      dbname: ENV.fetch('POSTGRES_DB', 'data_0001'),
      user: ENV.fetch('POSTGRES_USER', 'postgres'),
      password: ENV.fetch('POSTGRES_PASSWORD', 'postgres')
    )
    puts "データベースに接続しました"
  rescue PG::Error => e
    puts "データベース接続エラー: #{e.message}"
    exit 1
  end

  def import_all
    puts "データインポートを開始します..."

    truncate_tables
    import_product_category_translations
    import_customers
    import_sellers
    import_products
    import_orders
    import_order_items
    import_order_payments
    import_order_reviews
    import_geolocations
    
    puts "全てのデータのインポートが完了しました"
  ensure
    @conn.close if @conn
  end

  private

  def truncate_tables
    @conn.exec("TRUNCATE TABLE #{TABLES.join(', ')}")
  end

  def copy_csv(table_name, columns, csv_file)
    quoted_columns = columns.map { |column| PG::Connection.quote_ident(column) }.join(', ')
    @conn.copy_data("COPY #{table_name} (#{quoted_columns}) FROM STDIN WITH (FORMAT csv, HEADER true)") do
      File.foreach(csv_file) do |line|
        @conn.put_copy_data(line)
      end
    end
  end

  def import_product_category_translations
    puts "商品カテゴリ翻訳データをインポート中..."
    copy_csv(
      'product_category_translations',
      %w[product_category_name product_category_name_english],
      'data/product_category_name_translation.csv'
    )
    puts "商品カテゴリ翻訳データのインポート完了"
  rescue => e
    puts "商品カテゴリ翻訳データインポートエラー: #{e.message}"
    raise
  end

  def import_customers
    puts "顧客データをインポート中..."
    copy_csv(
      'customers',
      %w[customer_id customer_unique_id customer_zip_code_prefix customer_city customer_state],
      'data/olist_customers_dataset.csv'
    )
    puts "顧客データのインポート完了"
  rescue => e
    puts "顧客データインポートエラー: #{e.message}"
    raise
  end

  def import_sellers
    puts "販売者データをインポート中..."
    copy_csv(
      'sellers',
      %w[seller_id seller_zip_code_prefix seller_city seller_state],
      'data/olist_sellers_dataset.csv'
    )
    puts "販売者データのインポート完了"
  rescue => e
    puts "販売者データインポートエラー: #{e.message}"
    raise
  end

  def import_products
    puts "商品データをインポート中..."
    copy_csv(
      'products',
      %w[
        product_id
        product_category_name
        product_name_lenght
        product_description_lenght
        product_photos_qty
        product_weight_g
        product_length_cm
        product_height_cm
        product_width_cm
      ],
      'data/olist_products_dataset.csv'
    )
    puts "商品データのインポート完了"
  rescue => e
    puts "商品データインポートエラー: #{e.message}"
    raise
  end

  def import_orders
    puts "注文データをインポート中..."
    copy_csv(
      'orders',
      %w[
        order_id
        customer_id
        order_status
        order_purchase_timestamp
        order_approved_at
        order_delivered_carrier_date
        order_delivered_customer_date
        order_estimated_delivery_date
      ],
      'data/olist_orders_dataset.csv'
    )
    puts "注文データのインポート完了"
  rescue => e
    puts "注文データインポートエラー: #{e.message}"
    raise
  end

  def import_order_items
    puts "注文アイテムデータをインポート中..."
    copy_csv(
      'order_items',
      %w[order_id order_item_id product_id seller_id shipping_limit_date price freight_value],
      'data/olist_order_items_dataset.csv'
    )
    puts "注文アイテムデータのインポート完了"
  rescue => e
    puts "注文アイテムデータインポートエラー: #{e.message}"
    raise
  end

  def import_order_payments
    puts "支払いデータをインポート中..."
    copy_csv(
      'order_payments',
      %w[order_id payment_sequential payment_type payment_installments payment_value],
      'data/olist_order_payments_dataset.csv'
    )
    puts "支払いデータのインポート完了"
  rescue => e
    puts "支払いデータインポートエラー: #{e.message}"
    raise
  end

  def import_order_reviews
    puts "レビューデータをインポート中..."
    columns = %w[
      review_id
      order_id
      review_score
      review_comment_title
      review_comment_message
      review_creation_date
      review_answer_timestamp
    ]
    @conn.exec('CREATE TEMP TABLE order_reviews_import (LIKE order_reviews INCLUDING DEFAULTS)')
    copy_csv('order_reviews_import', columns, 'data/olist_order_reviews_dataset.csv')
    quoted_columns = columns.map { |column| PG::Connection.quote_ident(column) }.join(', ')
    @conn.exec(<<~SQL)
      INSERT INTO order_reviews (#{quoted_columns})
      SELECT DISTINCT ON (review_id) #{quoted_columns}
      FROM order_reviews_import
      ORDER BY review_id
    SQL
    puts "レビューデータのインポート完了"
  rescue => e
    puts "レビューデータインポートエラー: #{e.message}"
    raise
  end

  def import_geolocations
    puts "地理データをインポート中..."
    copy_csv(
      'geolocations',
      %w[
        geolocation_zip_code_prefix
        geolocation_lat
        geolocation_lng
        geolocation_city
        geolocation_state
      ],
      'data/olist_geolocation_dataset.csv'
    )
    puts "地理データのインポート完了"
  rescue => e
    puts "地理データインポートエラー: #{e.message}"
    raise
  end
end

DataImporter.new.import_all if $PROGRAM_NAME == __FILE__
