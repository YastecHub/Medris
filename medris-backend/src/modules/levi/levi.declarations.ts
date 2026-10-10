/**
 * Function declarations Levi exposes to Gemini. Each maps to a tool in
 * levi.tools.ts. Descriptions are part of the model contract: change with care.
 */
export const TOOL_DECLARATIONS = [
  {
    name: "search_products",
    description: "Search the live Levromart catalogue using product names, descriptions, categories and sectors. Use this for exact products and broad concepts such as shoes, watches, jewelry, food, medical equipment, ice cream, etc. Related terms are supported.",
    parameters: { type: "OBJECT", properties: {
      query: { type: "STRING" }, sector: { type: "STRING" }, category: { type: "STRING" }, listingType: { type: "STRING", enum: ["sale", "rent", "both"] }, buyOnly: { type: "BOOLEAN" }, rentOnly: { type: "BOOLEAN" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["relevance", "rating", "newest", "popular"] }, limit: { type: "INTEGER" }
    }, required: ["query"] }
  },
  {
    name: "search_vendors",
    description: "Find verified active Levromart vendors. Can search by vendor name, sector, city, rating, nearest distance, or by the products they actually carry/rent.",
    parameters: { type: "OBJECT", properties: {
      query: { type: "STRING" }, productQuery: { type: "STRING" }, sector: { type: "STRING" }, city: { type: "STRING" }, minRating: { type: "NUMBER" }, listingType: { type: "STRING", enum: ["sale", "rent", "both"] }, buyOnly: { type: "BOOLEAN" }, rentOnly: { type: "BOOLEAN" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["rating", "reviews", "name"] }, limit: { type: "INTEGER" }
    } }
  },
  {
    name: "get_catalog_overview",
    description: "Read the live sectors, categories, active product count and verified vendor count by sector. Use for questions such as how many vendors are in a sector or what categories exist.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_product",
    description: "Get one real product by id or resolve a product search. Use when the user wants details or a destination for a specific listing.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, query: { type: "STRING" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["relevance", "rating", "newest", "popular"] }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_vendor",
    description: "Get one vendor's public storefront details by id or search for a vendor.",
    parameters: { type: "OBJECT", properties: { vendorId: { type: "STRING" }, query: { type: "STRING" }, sector: { type: "STRING" }, city: { type: "STRING" }, minRating: { type: "NUMBER" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["rating", "reviews", "name"] }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_latest_products",
    description: "Find the newest active listings, optionally scoped to a sector/category or query.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, sector: { type: "STRING" }, category: { type: "STRING" }, listingType: { type: "STRING", enum: ["sale", "rent", "both"] }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_popular_products",
    description: "Find active products with the highest marketplace view counts, optionally scoped to a sector.",
    parameters: { type: "OBJECT", properties: { sector: { type: "STRING" }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_my_cart",
    description: "Read the signed-in user's own cart. Never use this for another person.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_my_orders",
    description: "Read the signed-in buyer's own order history and statuses. Never expose another user's orders.",
    parameters: { type: "OBJECT", properties: { status: { type: "STRING" }, ordinal: { type: "INTEGER" }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_my_messages",
    description: "Read the signed-in buyer's own vendor conversations and recent message snippets. Never expose other users' private chats.",
    parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } }
  },
  {
    name: "get_my_vendor_analytics",
    description: "Read private analytics for the signed-in user's own vendor shop only: views, wishlist saves, orders, revenue, and products. Returns no data for buyers.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "add_to_cart",
    description: "Add one real buyable product to the signed-in buyer's cart. Use only after identifying a real product id. Do not use for rentals/services.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, quantity: { type: "INTEGER" } }, required: ["productId", "quantity"] }
  },
  {
    name: "remove_from_cart",
    description: "Remove one real product from the signed-in buyer's cart. Use only with the user's own cart.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" } }, required: ["productId"] }
  },
  {
    name: "clear_cart",
    description: "Prepare to clear the signed-in buyer's entire cart. This never deletes immediately; the browser asks the user to confirm first.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "search_everything",
    description: "Unified Levromart search across active products, packages, verified vendors, categories and sectors. Use for broad or ambiguous requests such as watches, jewelry, food, clothing, medical equipment, or related concepts.",
    parameters: { type: "OBJECT", properties: { query:{type:"STRING"}, sector:{type:"STRING"}, category:{type:"STRING"}, productQuery:{type:"STRING"}, city:{type:"STRING"}, minRating:{type:"NUMBER"}, listingType:{type:"STRING",enum:["sale","rent","both"]}, nearest:{type:"BOOLEAN"}, sort:{type:"STRING",enum:["relevance","rating","newest","popular"]}, limit:{type:"INTEGER"} }, required:["query"] }
  },
  {
    name: "search_packages",
    description: "Search active vendor packages by name, description or vendor.",
    parameters: { type:"OBJECT", properties:{query:{type:"STRING"},limit:{type:"INTEGER"}}, required:["query"] }
  },
  { name:"get_my_profile", description:"Read the signed-in user's own profile details.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_my_wishlist", description:"Read the signed-in user's own saved products.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_my_vendor_products", description:"Read the signed-in vendor's own product catalogue, statuses, views and stock.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_my_vendor_orders", description:"Read the signed-in vendor's own orders and order items. Never expose private data belonging to other vendors.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_marketplace_trends", description:"Return aggregate public marketplace signals such as active product counts by sector, popular products by views, newest listings and verified vendor counts. Never identify individual customers.", parameters:{type:"OBJECT",properties:{}} },
  { name:"draft_message", description:"Prepare a message for a real vendor for the user to review and send. Never send it automatically.", parameters:{type:"OBJECT",properties:{vendorId:{type:"STRING"},message:{type:"STRING"}},required:["vendorId","message"]} },
  { name:"request_item", description:"Open the Levromart request flow prefilled with the item the user could not find.", parameters:{type:"OBJECT",properties:{query:{type:"STRING"}},required:["query"]} },
];
