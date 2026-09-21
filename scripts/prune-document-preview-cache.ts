import "@/lib/load-env";
import { pruneDocumentPreviewCache } from "@/lib/files/document-preview-cache";

async function main() {
  const result = await pruneDocumentPreviewCache();
  console.log(JSON.stringify(result, null, 2));

  if (result.failed > 0) process.exitCode = 1;
}

void main();
