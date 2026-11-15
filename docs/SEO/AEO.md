# SELTRA — GLOBAL WEB VISIBILITY, SEO, AEO & AI DISCOVERABILITY INFRASTRUCTURE

## Mission

Perform a comprehensive, production-grade implementation of SEO (Search Engine Optimization), AEO (Answer Engine Optimization), GEO (Generative Engine Optimization), and social media discoverability across the entire Seltra ecosystem.

Seltra has two distinct but interconnected products:

1. **Seltra.co:** Our AI-powered commerce platform, which enables merchants to create and operate online stores and websites.
2. **Generated Stores/Websites:** Every independent storefront and website generated, deployed, or hosted through Seltra. They have our wildcard extension *.seltra.co

Both products must have strong, independent web visibility and discoverability.

The objective is to make Seltra and its generated stores highly discoverable across traditional search engines, AI-powered search engines, conversational AI assistants, agentic browsing systems, social media platforms, and other relevant discovery channels.

This is an engineering implementation task, not a strategy document or SEO audit alone.

You have access to the entire repository in VS Code. Thoroughly inspect the existing architecture, frameworks, routing, rendering strategy, backend, frontend, database, AI infrastructure, store generation pipeline, deployment architecture, and existing metadata implementation before making changes.

Do not assume the architecture. Discover it from the actual codebase.

---

## 1. COMPREHENSIVE SEO INFRASTRUCTURE

Implement a complete technical SEO foundation for Seltra.co and every generated store.

### Search engine optimization
- Dynamic, page-specific title tags and meta descriptions.
- Correct canonical URLs for every indexable page.
- Proper robots directives and indexability controls.
- XML sitemap generation and automatic sitemap updates.
- Sitemap index support for large numbers of generated stores.
- Dynamic sitemap generation for products, categories, collections, pages, and articles.
- Correct robots.txt generation.
- Semantic HTML5 structure.
- Proper heading hierarchy (H1–H6).
- Image optimization, descriptive alt attributes, and appropriate image formats.
- Internal linking architecture.
- Breadcrumb navigation and breadcrumb structured data.
- Open Graph and Twitter/X metadata.
- Correct handling of pagination, filtering, query parameters, and duplicate URLs.
- Redirect management and canonical URL normalization.
- HTTP status code correctness, including 404, 301, 302, and 410 where appropriate.
- Structured handling of unavailable, deleted, unpublished, and private stores.
- Mobile-first indexing compatibility.
- Core Web Vitals and performance optimization.
- International SEO and hreflang support where applicable.
- Correct language and locale declarations.
- Search engine crawler accessibility.

Ensure SEO metadata is rendered in a way that search engine crawlers can reliably access, including when pages are dynamically generated.

Do not rely exclusively on client-side JavaScript for critical SEO metadata or structured content.

---

## 2. AEO — ANSWER ENGINE OPTIMIZATION

Optimize Seltra and its generated stores for answer engines.

The infrastructure should make information easy for search engines and AI systems to understand, extract, reference, and present as answers.

Implement:
- Clear, structured, semantically meaningful page content.
- Descriptive page titles and headings.
- Well-organized product descriptions and specifications.
- FAQ sections and FAQ structured data where appropriate and compliant with search engine guidelines.
- Organization, website, product, offer, article, and breadcrumb schema.
- Structured business information.
- Accurate business identity, contact information, location, and operating hours where available.
- Concise and informative summaries of products, services, categories, and businesses.
- Entity relationships between brands, businesses, products, services, and categories.
- Machine-readable information wherever useful.
- Proper content hierarchy and answer-oriented content presentation.

Ensure generated stores expose their business and product information in a consistent, machine-readable format.

---

## 3. GEO — GENERATIVE ENGINE OPTIMIZATION & AI DISCOVERABILITY

This is a major priority.

Optimize Seltra and its generated stores for discovery, recommendations, citations, and references through AI-powered search and conversational systems.

Consider platforms and ecosystems such as:

- ChatGPT Search.
- Perplexity.
- Google AI Overviews and AI Mode.
- Microsoft Copilot.
- Gemini.
- Claude and other AI-powered research assistants.
- Other emerging agentic search and discovery systems.

Implement a technically sound AI discoverability architecture.

Requirements:

### Machine-readable business identity
Every Seltra-powered store should expose:
- Business name and identity.
- Business description.
- Business category.
- Products and services.
- Product specifications.
- Pricing and availability where publicly available.
- Location and contact details where provided.
- Website identity and canonical domain.
- Relevant business policies.
- Frequently asked questions.

### AI-readable content architecture
- Generate comprehensive, descriptive, factual content.
- Make important information accessible without requiring complex JavaScript interactions.
- Structure product and business information for machine consumption.
- Ensure consistent entity information across pages.
- Make important content easy to crawl and retrieve.
- Create useful, descriptive category and collection pages.
- Avoid thin, duplicated, automatically generated SEO content.
- Establish strong relationships between the store, its products, categories, and brand.

### AI discovery endpoints
Evaluate and implement appropriate machine-readable discovery resources, including:
- llms.txt where useful.
- llms-full.txt where useful and maintainable.
- Machine-readable store information endpoints where appropriate.
- Public product and catalog feeds.
- Structured API endpoints for publicly accessible store information.

Do not assume that publishing llms.txt guarantees AI indexing or recommendations. Implement it as an additional discoverability resource, not a replacement for conventional crawling, indexing, or structured data.

Respect crawler policies, robots directives, privacy, and access restrictions.

Do not expose private merchant data, unpublished products, internal APIs, credentials, or proprietary platform information.

---

## 4. AGENTIC COMMERCE & AI AGENT COMPATIBILITY

Seltra should prepare its generated stores for a future where AI agents discover products, compare options, recommend merchants, and potentially initiate purchasing workflows.

Build the technical foundations for agent-friendly commerce.

Investigate and implement appropriate standards and interfaces, including:

- Schema.org product and offer structured data.
- Machine-readable product catalogs.
- Product availability and pricing information.
- Public product discovery endpoints.
- Stable product identifiers and canonical product URLs.
- Merchant and seller identity.
- Structured shipping, return, and refund information.
- Machine-readable checkout and purchasing capabilities where applicable.
- Appropriate commerce interoperability standards and protocols.

Evaluate relevant emerging standards and protocols, including:
- Universal Commerce Protocol (UCP).
- Agentic commerce interfaces.
- Relevant Model Context Protocol (MCP) use cases.
- Other established or emerging open commerce interoperability standards.

Do not implement speculative or unnecessary protocols merely to claim compatibility.

Where implementation is appropriate, create modular adapters so Seltra can support additional agentic commerce ecosystems without rewriting its core commerce architecture.

IMPORTANT:

Distinguish between:
1. Being discoverable by AI search systems.
2. Being understandable and recommendable by AI agents.
3. Being technically interoperable with agents that can interact with commerce systems.
4. Supporting actual agent-initiated purchasing.

Do not claim that one automatically guarantees another.

---

## 5. SOCIAL MEDIA DISCOVERABILITY

Implement social sharing and social discovery foundations for Seltra and every generated store.

Support relevant platforms, including:
- Facebook.
- Instagram.
- TikTok.
- Pinterest.
- LinkedIn.
- X.
- WhatsApp.
- Other relevant social platforms.

Implement:
- Open Graph metadata.
- Twitter/X card metadata.
- Dynamic social preview images.
- Product-specific sharing previews.
- Store-specific sharing previews.
- Descriptive social titles and descriptions.
- Canonical sharing URLs.
- Appropriate product images and image dimensions.
- Social sharing functionality where appropriate.
- Product and store link-sharing capabilities.

Ensure shared product and store URLs generate accurate previews instead of generic platform branding or incorrect metadata.

Where relevant, investigate social commerce catalog feeds and platform-specific product discovery integrations.

Do not claim to publish content automatically to social platforms without the required API integrations and merchant authorization.

---

## 6. SELTRA PLATFORM SEO

Treat seltra.co as an independent product and brand that must establish authority and discoverability.

Audit and optimize all relevant public-facing pages, including:
- Homepage.
- Product and platform feature pages.
- Pricing.
- About.
- Contact.
- Documentation and help resources.
- Blog and editorial resources, if present.
- Merchant onboarding and other publicly accessible pages.

Implement:
- Organization schema.
- Website schema.
- SoftwareApplication schema where appropriate.
- Relevant product and service schema.
- Consistent Seltra brand identity.
- Social profile references through sameAs where verified.
- Clear positioning and descriptive product information.
- Internal linking and topical architecture.
- Search-friendly landing pages.

Ensure the platform's value proposition is consistently communicated:

"Seltra is an AI-powered commerce platform enabling businesses to create, launch, and operate online stores and websites."

Use the actual product positioning and branding found in the repository where more accurate.

Do not create fake testimonials, fabricated statistics, unsupported claims, or keyword-stuffed landing pages.

---

## 7. AUTOMATED SEO FOR EVERY GENERATED STORE

This is one of the most important requirements.

SEO and discoverability must be built into Seltra's core store-generation infrastructure.

Every new store generated by Seltra should automatically receive a complete SEO and AI-discoverability foundation.

Integrate this into the existing AI generation pipeline, store configuration, publishing process, and runtime architecture.

For every generated store, automatically establish:

1. Store-level SEO configuration.
2. Unique homepage title and description.
3. Store-specific canonical URLs.
4. Dynamic product metadata.
5. Dynamic category and collection metadata.
6. Product structured data.
7. Business structured data.
8. Open Graph and social previews.
9. XML sitemap.
10. Robots.txt.
11. AI-readable discovery resources where appropriate.
12. Semantic page structure.
13. Product and category internal linking.
14. Image alt-text generation.
15. Search engine indexability controls.
16. Machine-readable product information.

### AI-generated SEO intelligence

Leverage Seltra's existing AI infrastructure to generate relevant SEO information from actual merchant and store data.

For example:
- Generate optimized product titles and meta descriptions.
- Generate useful, accurate product descriptions.
- Generate category descriptions.
- Identify missing product information.
- Suggest relevant keywords and search intent.
- Generate meaningful image alt text.
- Identify duplicate or weak metadata.
- Recommend improvements to store content.

AI-generated metadata must be editable by merchants and must never fabricate product specifications, prices, availability, business credentials, or other factual information.

SEO generation should not unnecessarily slow down store creation or publishing.

Use asynchronous processing, caching, background jobs, or existing infrastructure where appropriate.

---

## 8. MULTI-TENANT SEO ISOLATION

Seltra generates multiple independent stores. Ensure the SEO infrastructure respects multi-tenant boundaries.

Every store must have:
- Its own SEO identity.
- Its own canonical domain.
- Its own sitemap.
- Its own robots configuration.
- Its own structured business identity.
- Its own social metadata.
- Its own AI discovery resources.
- Its own product catalog exposure rules.

Support both Seltra subdomains and custom merchant domains if these are supported by the existing architecture.

Prevent:
- Cross-store metadata leakage.
- Incorrect canonical domains.
- Duplicate sitemap entries.
- One merchant's products appearing in another merchant's sitemap.
- Private or unpublished content becoming indexable.
- Incorrect robots rules being applied across tenants.

Handle custom-domain mapping, domain verification, redirects, and canonical URL changes correctly.

---

## 9. PERFORMANCE, SECURITY & RELIABILITY

All implementations must meet production standards.

SEO infrastructure must not:
- Significantly increase page response times.
- Introduce unnecessary database queries.
- Cause expensive repeated AI calls.
- Expose internal application data.
- Break existing store functionality.
- Break the existing generation or deployment pipeline.

Use:
- Caching.
- Efficient database queries.
- Reusable metadata utilities.
- Background processing where necessary.
- Appropriate HTTP caching headers.
- Rate limiting for public endpoints.
- Input validation and sanitization.
- Secure tenant-aware data access.

Ensure SEO routes work correctly across the actual deployment environment.

---

## 10. SEARCH ENGINE VERIFICATION & MONITORING

Implement the technical foundations for monitoring search visibility.

Where appropriate, prepare integration points for:
- Google Search Console.
- Bing Webmaster Tools.
- Google Analytics.
- Other relevant analytics and webmaster platforms.

Provide a clear verification and configuration process for:
- Domain ownership.
- Search engine verification tokens.
- Sitemap submission.
- Crawl errors.
- Indexing issues.
- Structured data validation.
- Search performance monitoring.

Do not pretend that Seltra can directly control whether search engines or AI systems index or recommend a website.

Provide useful diagnostics and actionable recommendations.

---

## 11. ARCHITECTURE & IMPLEMENTATION REQUIREMENTS

Before implementation:

1. Inspect the entire repository.
2. Identify the current frontend and backend architecture.
3. Identify how generated stores are created, rendered, deployed, and served.
4. Identify how domains and tenant routing work.
5. Identify existing SEO functionality.
6. Identify the AI generation pipeline and where SEO generation belongs.
7. Identify current rendering limitations.
8. Identify performance and infrastructure constraints.
9. Produce a concise implementation plan based on actual repository findings.

Then implement the solution.

### Engineering principles

- Reuse existing infrastructure wherever possible.
- Avoid unnecessary dependencies.
- Do not introduce a parallel architecture when the existing architecture can be extended.
- Keep the implementation modular and maintainable.
- Respect existing coding conventions.
- Preserve existing application behavior.
- Avoid destructive database migrations.
- Add backward-compatible database changes where necessary.
- Do not hardcode merchant-specific information.
- Do not use generic metadata across every generated store.
- Do not create placeholder SEO functionality.
- Do not implement fake integrations.
- Do not remove existing functionality to accommodate SEO.

Where architectural limitations prevent proper implementation, solve them at the correct architectural layer instead of applying superficial frontend workarounds.

---

## 12. TESTING & ACCEPTANCE CRITERIA

Create and execute comprehensive tests.

Test Seltra.co and generated stores independently.

### Technical SEO tests
- Every indexable page has appropriate unique metadata.
- Canonical URLs are correct.
- XML sitemaps return valid XML.
- Robots.txt returns valid directives.
- Structured data is valid JSON-LD.
- Open Graph metadata is correct.
- Social preview images resolve.
- HTTP status codes are correct.
- No private content is exposed.
- Crawlers can access intended public content.

### Generated store tests
Create or use test stores representing different merchant types.

Verify:
- Store-specific SEO configuration.
- Product metadata.
- Product structured data.
- Category metadata.
- Store-specific sitemap generation.
- Custom-domain canonical URLs.
- Social previews.
- AI discovery endpoints.
- Published versus unpublished products.
- Multi-tenant isolation.

### Rendering tests
Test pages with:
- Browser JavaScript disabled where feasible.
- HTML source inspection.
- Googlebot/Bingbot-style crawler requests.
- Open Graph preview inspection.
- Structured data validation.

### Performance tests
Verify that the new implementation does not introduce unacceptable:
- Response latency.
- Database query overhead.
- Rendering delays.
- Publishing delays.
- AI API costs.

Fix issues uncovered during testing.

---

## 13. FINAL DELIVERABLE

Do not stop after producing an audit or implementation plan.

Implement the complete solution in the repository.

At completion, provide a concise but comprehensive engineering report containing:

1. Existing architecture discovered.
2. SEO problems identified.
3. Architecture implemented.
4. Files created and modified.
5. Database changes and migrations.
6. New routes and public endpoints.
7. SEO capabilities added to Seltra.co.
8. SEO capabilities automatically available to generated stores.
9. AEO and GEO capabilities implemented.
10. Social discoverability improvements.
11. Agentic commerce readiness and actual integrations.
12. Security and multi-tenant isolation measures.
13. Tests executed and their results.
14. Remaining limitations and external configurations required.
15. Deployment instructions.
16. Recommended next steps.

Clearly distinguish:
- Fully implemented.
- Implemented but requiring external configuration.
- Prepared for future integration.
- Not implemented, with technical reasons.

## FINAL DIRECTIVE

Think and execute as a senior search infrastructure engineer, technical SEO architect, AI discovery engineer, and agentic commerce systems engineer.

Do not optimize only for Google.

Build a comprehensive discoverability infrastructure that enables Seltra and every merchant website generated through Seltra to be understood, indexed, discovered, referenced, recommended, and where technically supported, interacted with across the evolving web and AI ecosystem.

The outcome should be production-grade, scalable, multi-tenant, automated, measurable, and native to Seltra's architecture.

**Seltra should not merely generate websites. It should generate websites that are discoverable.**