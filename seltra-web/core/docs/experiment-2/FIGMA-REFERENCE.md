# Figma reference inspection

## Retrieval

- File: **Parwar's Portfolio 2**
- Sanitized source: `https://www.figma.com/design/GLwgMx6cYUVaydXDanayTX/Parwar-s-Portfolio-2`
- Retrieval: Figma REST API `GET /v1/files/{file_key}?depth=3`, authenticated with the locally configured read-only token; HTTP 200.
- Credential handling: the token was read from local `.env.web` only for the request. It was not printed, copied into this report, sent to a model, or saved in an artifact.
- Retrieved: 2026-10-19.

## Structure observed

Figma returned one page (`Page 1`) with six top-level frames:

| Frame | Observed content |
|---|---|
| `home` | Portfolio hero, navigation, profile image region, and developer-tool marks. |
| `services` | Three service cards with illustration regions and placeholder copy. |
| `project` | Project gallery layouts with nine gray image placeholders. |
| `contact` | Contact form, footer, and social icons. |
| `project` | A second project gallery frame with a short text block and nine gray image placeholders. |
| `Message sent` | Submission confirmation and footer. |

The inspected nodes use white surfaces, dark blue-gray text (`#263239`), vivid blue accents, and pale-gray placeholder surfaces. The canvas preview shows a light portfolio style with subtle decorative gear imagery. The file reports zero published components and zero published styles.

## Limits

The in-product importer is available in both the home first-prompt flow and the in-chat composer. It sends the Figma URL to the authenticated same-origin gateway, retrieves bounded structure with the server-only token, strips share/query parameters, and adds the sanitized design context to the same Dyad prompt. The context is marked as untrusted reference data. Image bytes are not imported, and a persistent app-scoped `design_reference` artifact is not created yet.

The live web benchmark verified the importer response and used the reference to generate a Dyad app. Its generated preview passed the responsive route probe documented in [`RESULTS.md`](./RESULTS.md). Exact layout measurements, image-render comparisons, and every nested node were not imported. Several source frames contain placeholder or Lorem Ipsum content. Human visual scoring and a critique/repair/recheck cycle remain open.
