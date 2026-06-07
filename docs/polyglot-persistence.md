# Polyglot Persistence — pgvector

This document explains why SnapPark's case database is no longer a
standard relational database, what was changed, what genuine polyglot
semantics this provides, and the boundaries of the claim.

## What "polyglot" means here

Polyglot persistence is the practice of using more than one storage
paradigm in a single system, choosing each store for the access pattern
it serves best. The previous architecture used a relational store
(Postgres) for every service — including the violation-analysis-service,
whose richest piece of data is the AI's *understanding* of an image.
That understanding is a high-dimensional semantic representation, not a
row of typed columns. Querying it ("show me cases that look like this
one") requires nearest-neighbour search over vectors, which a plain
B-tree-indexed relational store cannot answer efficiently.

The case_db now serves two genuinely different access patterns from a
single engine:

| Access pattern | Storage paradigm | Index |
|---|---|---|
| Exact-match relational queries (`status = 'completed'`, ownership checks, paginated lists) | Row-oriented relational | B-tree on PK / FK / status |
| Approximate nearest-neighbour over Gemini-verdict embeddings | Dense-vector store | HNSW with cosine distance |

The two paradigms live in the same Postgres process. Their queries
operate on the same source of truth: the `cases` table now has an
`embedding vector(768)` column alongside the existing `confidence`,
`violation_type`, etc.

## Why pgvector and not Pinecone / Milvus / Qdrant

Three options were considered:

1. **Add a managed vector DB (Pinecone or similar).** Strongest claim
   to "different engine", but introduces a second managed service, a
   second set of credentials, a second backup story, and dual-write
   complexity (the case row in Postgres and its embedding in Pinecone
   must stay in sync, which is *itself* a distributed transaction
   problem and would require its own saga).
2. **Add a self-hosted vector DB (Qdrant or Milvus).** Removes the
   managed-service cost but keeps the dual-write complexity and adds
   a new container to operate.
3. **`pgvector` — Postgres extension.** Vector type and index methods
   are implemented natively inside Postgres. The case row and its
   embedding stay in the same ACID transaction; no dual-write; no new
   service.

For a dissertation-scale system, option 3 wins on both the engineering
merits (simplest correct thing) and the academic merits (the polyglot
claim still holds — vector search is a different paradigm with a
different index structure, regardless of the host process). Option 1
or 2 would be defensible at production scale where index size or QPS
exceeds what a single Postgres instance can serve, but that is not the
problem this project has.

The original prompt accepted this:

> "Please refactor this specific microservice to use a Vector Database
> (such as Pinecone, Milvus, Qdrant, or **at least the pgvector
> extension if keeping a Postgres base is strictly necessary for
> infrastructure reasons**)."

— and the infrastructure reason here is "single-author dissertation
project; no operational budget for a second managed service."

## What was changed

### 1. Database image

`deployment/docker-compose.yml` swaps the case_db image:

```diff
- image: postgres:15-alpine
+ image: pgvector/pgvector:pg15
```

The `pgvector/pgvector:pg15` image is vanilla Postgres 15 with the
pgvector C extension pre-built and in the image. No code-side build
step.

### 2. Schema

In [`services/violation-analysis-service/src/db.js`](../services/violation-analysis-service/src/db.js):

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE cases ADD COLUMN embedding vector(768);

CREATE INDEX idx_cases_embedding_hnsw
  ON cases USING hnsw (embedding vector_cosine_ops);
```

- `vector(768)` matches the dimension of `text-embedding-004` (Gemini's
  current default text embedding model). The dimension is exposed as
  `EMBEDDING_DIM` in `db.js` so any future model swap touches one
  constant.
- HNSW (Hierarchical Navigable Small World) is pgvector's recommended
  approximate-nearest-neighbour index, with sub-linear query time on
  any plausible dataset size.
- Cosine distance (`vector_cosine_ops`) is appropriate for normalised
  embedding vectors — the metric Gemini's embedding model is trained
  against.

### 3. Embedding source

In [`services/violation-analysis-service/src/embeddings.js`](../services/violation-analysis-service/src/embeddings.js).

We embed a short string concatenated from the AI's structured output:

```
Violation: <type>. Explanation: <text>. Plate: <plate>.
```

This is deliberate. The AI's *interpretation* of the image is what we
want to compare across cases — two photos of "vehicle on pavement"
should cluster together regardless of their pixel-level appearance.
Embedding the raw image bytes is also possible (multi-modal embeddings
exist) but would couple the similarity metric to lighting, angle, and
weather conditions rather than to the parking-violation taxonomy that
matters for the application.

A demo fallback (deterministic SHA-256-derived 768-D unit vector)
exists for the same reason `gemini.js` has one: the upload pipeline
must be runnable end-to-end without a billed Gemini project. The
fallback is documented as not-a-real-semantic-embedding in the source
comments and the dissertation should not claim it produces meaningful
clusters — only that it makes the wiring testable.

### 4. Saga step

The case-creation saga gains a fourth step (`embedAndIndex`) between
`persistImages` and `recordAuditCreated`:

```
1. analyzeImage
2. persistCase
3. persistImages
4. embedAndIndex      ← new
5. recordAuditCreated
6. dispatchNotification
```

Compensation: clear the `embedding` column. The case row itself is
rolled back by `persistCase`'s compensation if a *later* step fails;
clearing the column on its own is mainly a defence against future
re-orderings of the saga.

This placement means an embedding API failure aborts the saga and
rolls everything back. If the dissertation argues "the case still has
value without an embedding", the alternative is to move the embedding
step *after* `dispatchNotification` and treat embedding failure as
non-fatal. We chose the stricter contract because it's the simpler
invariant to defend in the writeup ("every case in the database has
an embedding"). Both choices are reasonable.

### 5. Query API

`GET /violations/:caseId/similar?limit=5` returns the N most similar
prior cases. Implementation:

```sql
SELECT c.*, c.embedding <=> src.embedding AS distance
  FROM cases c, cases src
 WHERE src.id = $1
   AND c.id <> src.id
   AND c.embedding IS NOT NULL
 ORDER BY distance ASC
 LIMIT $2;
```

`<=>` is pgvector's cosine-distance operator. The HNSW index above is
the only thing that makes this query fast at scale — without it, every
similarity lookup would be a full table scan.

The endpoint includes a 404 path (case not found), a 403 path
(ownership check — citizens see only their own case's similars; admins
see any), and an `embedded: false` path for legacy cases that predate
the embedding column. The frontend renders each result as a clickable
card with the cosine distance translated to a 0–100% similarity score.

## Tests as evidence

```sh
cd services/violation-analysis-service
npx vitest run tests/embeddings.test.js
npx vitest run tests/saga-case-creation.test.js
```

The embeddings tests verify, with no live API:

- the demo fallback is deterministic and unit-length (so cosine
  distance is well-defined);
- different inputs produce vectors that are not collinear;
- `buildEmbeddingInput` skips missing fields cleanly;
- empty input is rejected loudly rather than silently embedded.

The saga tests verify the new step's behaviour without a live database:

- the happy path calls `generateEmbedding` once and `setCaseEmbedding`
  with the saved case's id and a 768-element array;
- when the AI returns no useful text, the step short-circuits and the
  saga still completes (`embedded: false`);
- when the embedding API throws, the saga compensates back through the
  case row and the image rows (LIFO), and notification is *not*
  dispatched;
- the embedding compensation is non-fatal: a clearCaseEmbedding error
  is logged and the rest of the compensation chain proceeds.

The HNSW index and the SQL similarity query are covered by manual
verification against the live pgvector container — see the
"Reproducing" section below.

## Reproducing

End-to-end verification on a developer machine:

```sh
# Bring up the new pgvector image and the violation-analysis service
cd deployment && docker compose up -d --build postgres_case violation-analysis-service

# Confirm the extension is installed
docker exec snappark_case_db psql -U snappark_user -d snappark_case \
  -c "SELECT extname FROM pg_extension WHERE extname = 'vector'"

# Confirm the schema
docker exec snappark_case_db psql -U snappark_user -d snappark_case -c "\d cases" \
  | grep embedding

# After uploading at least two cases via the UI:
docker exec snappark_case_db psql -U snappark_user -d snappark_case \
  -c "SELECT id, violation_type, embedding IS NOT NULL AS embedded FROM cases LIMIT 5"

# Then call the API:
# GET /violations/<caseId>/similar?limit=5
```

## What this does NOT claim

To be honest about the scope:

1. **It is not a separate vector database.** The architecture diagram
   should label case_db as "Postgres + pgvector", not "Postgres +
   Pinecone".
2. **It does not implement re-embedding on schema change.** If the
   embedding model is swapped (768-D → 1024-D, say), all existing
   embeddings must be regenerated; we have not implemented that
   migration. It would be a one-shot script that walks every row.
3. **The demo-mode fallback embedding is not semantic.** It exists to
   keep the pipeline testable without an API key; clusters formed
   under demo mode are an artefact of SHA-256, not of meaning.
4. **HNSW indexing is approximate.** With pgvector's defaults this is
   fine for the dissertation; production deployments at >1M rows
   should tune `m`, `ef_construction`, and `ef` per pgvector's
   guidance — none of which we have done.

## Why the relational columns stay

Some readers will ask "why not move *everything* into the vector store?"
The relational columns answer queries the vector store cannot:

- **Exact-match filtering.** "Show me all cases for user X with
  status = completed" is a B-tree lookup; trying to express it through
  vector similarity would be wrong.
- **Joins and aggregates.** The dashboard's per-user statistics page
  GROUPs by status and SUMs counts; vector indexes don't help here.
- **Foreign keys and integrity.** `case_images` references `cases.id`;
  the vector store would have to either learn about that constraint or
  the application layer would have to enforce it manually.

So the system is genuinely *poly*-glot: each access pattern uses the
storage paradigm that fits it, and the two coexist in the same row
because pgvector lets them.
