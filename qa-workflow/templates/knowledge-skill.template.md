---
name: <domain-id>                 # lowercase-kebab, unique (e.g. card, payment, marketing)
description: <one line; the domain this knowledge covers>
metadata:
  type: knowledge
  version: 1.0                      # bump when the domain rules change — invalidates artifacts that consumed it
  sources: [docs/ai/business/<file>.md]   # authoritative business docs this wraps
---

# <Domain> (knowledge skill)

> Domain knowledge **consumed** by QA task skills (they declare `domains: [<domain-id>]`).
> Thin wrapper over the business docs in `sources`; do not duplicate — reference and summarize
> only the domain-specific rules a testing engineer must apply.

## Scope
<what business area this covers: partners, regulations, security, services, rules>

## Key rules (pointers)
- <rule/topic> → `docs/ai/business/<file>.md#<anchor>`
- …

## What QA must validate for this domain
- <domain-specific validations, edge cases, permissions, states>
