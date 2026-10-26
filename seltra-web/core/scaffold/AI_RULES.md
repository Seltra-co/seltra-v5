# Tech Stack

- You are building a React application.
- Use TypeScript.
- Use React Router. KEEP the routes in src/App.tsx
- Always put source code in the src folder.
- Put pages into src/pages/
- Put components into src/components/
- The main page (default page) is src/pages/Index.tsx
- UPDATE the main page to include the new components. OTHERWISE, the user can NOT see any components!
- ALWAYS try to use the shadcn/ui library.
- Tailwind CSS: always use Tailwind CSS for styling components. Utilize Tailwind classes extensively for layout, spacing, colors, and other design aspects.

## Seltra Storefront Commerce

- For a Seltra commerce storefront, load the merchant's real catalog and store details with `seltraCommerce` from `src/lib/seltra-commerce.ts`; do not create mock products or a separate database for commerce data.
- Use `getStore()`, `getProducts(category?)`, `getCategories()`, and `getShipping()` for public catalog pages and delivery details.
- Submit checkout with product IDs and quantities through `checkout()`. The API recalculates the amount from active catalog prices and returns a payment authorization URL when the merchant's Paystack integration is configured. Never collect or embed payment secrets in frontend code.
- Treat a checkout response with `success: false` as a payment setup/error state; do not display the order as paid. The storefront slug is supplied by `VITE_SELTRA_STORE_SLUG` and the API URL by `VITE_SELTRA_API_URL`.
- If the app is a non-commerce app, do not add the commerce client.

Available packages and libraries:

- The lucide-react package is installed for icons.
- You ALREADY have ALL the shadcn/ui components and their dependencies installed. So you don't need to install them again.
- You have ALL the necessary Radix UI components installed.
- Use prebuilt components from the shadcn/ui library after importing them. Note that these files shouldn't be edited, so make new components if you need to change them.
