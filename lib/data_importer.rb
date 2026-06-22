require 'pg'
require 'csv'
require 'dotenv/load'

class DataImporter
  def initialize
    @conn = PG.connect(
      host: ENV['POSTGRES_HOST'],
      port: ENV['POSTGRES_PORT'],
      dbname: ENV['POSTGRES_DB'],
      user: ENV['POSTGRES_USER'],
      password: ENV['POSTGRES_PASSWORD']
    )
    puts "データベースに接続しました"
  rescue PG::Error => e
    puts "データベース接続エラー: #{e.message}"
    exit 1
  end

  def import_all
    puts "データインポートを開始します..."
    
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

  def import_product_category_translations
    puts "商品カテゴリ翻訳データをインポート中..."
    csv_file = 'data/product_category_name_translation.csv'
    
    CSV.foreach(csv_file, headers: true, encoding: 'UTF-8') do |row|
      # BOMを除去
      category_name = row[0].to_s.gsub(/\A\uFEFF/, '')
      category_name_en = row[1].to_s
      
      @conn.exec_params(
        'INSERT INTO product_category_translations (product_category_name, product_category_name_english) VALUES ($1, $2) ON CONFLICT (product_category_name) DO NOTHING',
        [category_name, category_name_en]
      )
    end
    puts "商品カテゴリ翻訳データのインポート完了"
  rescue => e
    puts "商品カテゴリ翻訳データインポートエラー: #{e.message}"
  end

  def import_customers
    puts "顧客データをインポート中..."
    csv_file = 'data/olist_customers_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO customers (customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (customer_id) DO NOTHING',
        [row['customer_id'], row['customer_unique_id'], row['customer_zip_code_prefix']&.to_i, row['customer_city'], row['customer_state']]
      )
    end
    puts "顧客データのインポート完了"
  rescue => e
    puts "顧客データインポートエラー: #{e.message}"
  end

  def import_sellers
    puts "販売者データをインポート中..."
    csv_file = 'data/olist_sellers_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO sellers (seller_id, seller_zip_code_prefix, seller_city, seller_state) VALUES ($1, $2, $3, $4) ON CONFLICT (seller_id) DO NOTHING',
        [row['seller_id'], row['seller_zip_code_prefix']&.to_i, row['seller_city'], row['seller_state']]
      )
    end
    puts "販売者データのインポート完了"
  rescue => e
    puts "販売者データインポートエラー: #{e.message}"
  end

  def import_products
    puts "商品データをインポート中..."
    csv_file = 'data/olist_products_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      category_name = row['product_category_name']
      
      # カテゴリが存在しない場合は先に追加
      if category_name && !category_name.empty?
        @conn.exec_params(
          'INSERT INTO product_category_translations (product_category_name, product_category_name_english) VALUES ($1, $2) ON CONFLICT (product_category_name) DO NOTHING',
          [category_name, category_name]
        )
      end
      
      @conn.exec_params(
        'INSERT INTO products (product_id, product_category_name, product_name_lenght, product_description_lenght, product_photos_qty, product_weight_g, product_length_cm, product_height_cm, product_width_cm) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (product_id) DO NOTHING',
        [
          row['product_id'],
          category_name,
          row['product_name_lenght']&.to_i,
          row['product_description_lenght']&.to_i,
          row['product_photos_qty']&.to_i,
          row['product_weight_g']&.to_f,
          row['product_length_cm']&.to_f,
          row['product_height_cm']&.to_f,
          row['product_width_cm']&.to_f
        ]
      )
    end
    puts "商品データのインポート完了"
  rescue => e
    puts "商品データインポートエラー: #{e.message}"
  end

  def import_orders
    puts "注文データをインポート中..."
    csv_file = 'data/olist_orders_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO orders (order_id, customer_id, order_status, order_purchase_timestamp, order_approved_at, order_delivered_carrier_date, order_delivered_customer_date, order_estimated_delivery_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (order_id) DO NOTHING',
        [
          row['order_id'],
          row['customer_id'],
          row['order_status'],
          parse_timestamp(row['order_purchase_timestamp']),
          parse_timestamp(row['order_approved_at']),
          parse_timestamp(row['order_delivered_carrier_date']),
          parse_timestamp(row['order_delivered_customer_date']),
          parse_timestamp(row['order_estimated_delivery_date'])
        ]
      )
    end
    puts "注文データのインポート完了"
  rescue => e
    puts "注文データインポートエラー: #{e.message}"
  end

  def import_order_items
    puts "注文アイテムデータをインポート中..."
    csv_file = 'data/olist_order_items_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO order_items (order_id, order_item_id, product_id, seller_id, shipping_limit_date, price, freight_value) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (order_id, order_item_id) DO NOTHING',
        [
          row['order_id'],
          row['order_item_id']&.to_i,
          row['product_id'],
          row['seller_id'],
          parse_timestamp(row['shipping_limit_date']),
          row['price']&.to_f,
          row['freight_value']&.to_f
        ]
      )
    end
    puts "注文アイテムデータのインポート完了"
  rescue => e
    puts "注文アイテムデータインポートエラー: #{e.message}"
  end

  def import_order_payments
    puts "支払いデータをインポート中..."
    csv_file = 'data/olist_order_payments_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO order_payments (order_id, payment_sequential, payment_type, payment_installments, payment_value) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id, payment_sequential) DO NOTHING',
        [
          row['order_id'],
          row['payment_sequential']&.to_i,
          row['payment_type'],
          row['payment_installments']&.to_i,
          row['payment_value']&.to_f
        ]
      )
    end
    puts "支払いデータのインポート完了"
  rescue => e
    puts "支払いデータインポートエラー: #{e.message}"
  end

  def import_order_reviews
    puts "レビューデータをインポート中..."
    csv_file = 'data/olist_order_reviews_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO order_reviews (review_id, order_id, review_score, review_comment_title, review_comment_message, review_creation_date, review_answer_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (review_id) DO NOTHING',
        [
          row['review_id'],
          row['order_id'],
          row['review_score']&.to_i,
          row['review_comment_title'],
          row['review_comment_message'],
          parse_timestamp(row['review_creation_date']),
          parse_timestamp(row['review_answer_timestamp'])
        ]
      )
    end
    puts "レビューデータのインポート完了"
  rescue => e
    puts "レビューデータインポートエラー: #{e.message}"
  end

  def import_geolocations
    puts "地理データをインポート中..."
    csv_file = 'data/olist_geolocation_dataset.csv'
    
    CSV.foreach(csv_file, headers: true) do |row|
      @conn.exec_params(
        'INSERT INTO geolocations (geolocation_zip_code_prefix, geolocation_lat, geolocation_lng, geolocation_city, geolocation_state) VALUES ($1, $2, $3, $4, $5)',
        [
          row['geolocation_zip_code_prefix']&.to_i,
          row['geolocation_lat']&.to_f,
          row['geolocation_lng']&.to_f,
          row['geolocation_city'],
          row['geolocation_state']
        ]
      )
    end
    puts "地理データのインポート完了"
  rescue => e
    puts "地理データインポートエラー: #{e.message}"
  end

  def parse_timestamp(timestamp_str)
    return nil if timestamp_str.nil? || timestamp_str.empty?
    timestamp_str
  rescue
    nil
  end
end