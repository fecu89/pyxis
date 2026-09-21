-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex (보드 내부 검색의 ILIKE(contains) 검색을 받쳐주는 트라이그램 GIN 인덱스)
CREATE INDEX IF NOT EXISTS "Post_title_trgm_idx" ON "Post" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Post_body_trgm_idx" ON "Post" USING GIN ("body" gin_trgm_ops);
