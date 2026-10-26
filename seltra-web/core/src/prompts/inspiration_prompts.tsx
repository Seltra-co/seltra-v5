import {
  CreditCard,
  Gift,
  PackageCheck,
  Store,
  Tags,
  Truck,
} from "lucide-react";

export const INSPIRATION_PROMPTS = [
  {
    icon: <Store className="size-5" />,
    label: "Fashion storefront",
    prompt:
      "Build a polished e-commerce storefront for a Ghanaian fashion brand with a responsive product catalog, collections, product details, size selection, and a refined checkout flow.",
  },
  {
    icon: <Tags className="size-5" />,
    label: "Beauty products shop",
    prompt:
      "Build an e-commerce beauty shop with skincare product cards, category filters, product reviews, bundles, a shopping cart, and clear delivery information.",
  },
  {
    icon: <PackageCheck className="size-5" />,
    label: "Artisan goods marketplace",
    prompt:
      "Build an online marketplace for handmade goods with seller collections, product variants, wishlists, customer reviews, and a secure cart and checkout experience.",
  },
  {
    icon: <Truck className="size-5" />,
    label: "Grocery delivery store",
    prompt:
      "Build an online grocery store with searchable products, category filters, delivery time selection, cart totals, and a mobile-friendly checkout.",
  },
  {
    icon: <CreditCard className="size-5" />,
    label: "Modern checkout flow",
    prompt:
      "Build a smooth e-commerce checkout for a boutique store with an order summary, delivery address form, shipping options, promo code, and payment confirmation.",
  },
  {
    icon: <Gift className="size-5" />,
    label: "Gift box shop",
    prompt:
      "Build an online gift box store with curated bundles, product customization, occasion filters, gift notes, and an easy checkout for local delivery.",
  },
];
