# domains/ — business-domain knowledge skills

Knowledge skills (see `../templates/knowledge-skill.template.md`) that **wrap** the business docs in
`../../docs/ai/business/**`. QA task skills **consume** these (via `domains: [...]` frontmatter) rather
than re-encoding business rules — one source of business truth.

| Domain | Wraps | Consumed by (typical) |
|---|---|---|
| `card` | business-rules.md, products.md | story-analysis, test-design, visual-testing |
| `payment` | business-rules.md, products.md | story-analysis, test-design |
| `marketing` | products.md | test-design, visual-testing |

> **Note:** `docs/ai/business/**` is not yet split per-domain (it's overview/rules/products/roles).
> Domain-splitting is a follow-up; today's wrappers reference the shared docs and summarize the
> domain-specific slice. On migration these merge into the plugin's `domains/`.
