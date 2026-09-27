import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Only explicit external boundaries are replaced; filesystem and Sharp remain real.
export async function loadImageModule(entry, mocks = {}) {
  const replacements = { "server-only": "", "@/lib/prisma": "export const getPrisma=()=>globalThis.padImageDb;", ...mocks };
  const output = await build({ stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "image-test-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => Object.hasOwn(replacements, a.path) ? { path: a.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: replacements[a.path], resolveDir: process.cwd() }));
    } }],
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

export async function createImageTestDb() {
  const value = process.env.TEST_IMAGE_DATABASE_URL;
  if (!value) throw new Error("TEST_IMAGE_DATABASE_URL must explicitly name the isolated pad_images database");
  const url = new URL(value);
  if (url.pathname !== "/pad_images" || !url.searchParams.get("host")?.startsWith("/tmp/pyxis-image-pg.")) {
    throw new Error("Refusing non-fixture database");
  }
  const { require: tsRequire } = await import("tsx/cjs/api");
  const { PrismaClient } = tsRequire("../generated/prisma/client.ts", import.meta.url);
  const { PrismaPg } = await import("@prisma/adapter-pg");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: value }) });
}

export async function createImageBoard(db) {
  const activity = await db.activity.create({ data: { type: "PAD_BOARD", title: "image-fixture" } });
  const board = await db.board.create({ data: { slug: activity.id, title: "fixture", activityId: activity.id } });
  const section = await db.section.create({ data: { boardId: board.id, title: "fixture", position: 0 } });
  const post = await db.post.create({ data: { boardId: board.id, sectionId: section.id, guestId: "fixture-guest", guestName: "fixture", position: 0 } });
  return { board, post, section, async cleanup() {
    await db.activity.delete({ where: { id: activity.id } });
    await db.imageProcessingJob.deleteMany({ where: { boardId: board.id } });
  } };
}

export const uploadMocks = {
  "@/lib/auth/current-user": "export const getCurrentUser=async()=>null;",
  "@/lib/board/mutation-access": "export const getBoardMutationAccess=async()=>globalThis.padImageAccess===false?null:{board:{}};",
  "@/lib/board/guest-access": "export const resolveGuestPostOwner=async()=>({guestId:'fixture-guest'});",
  "@/lib/auth/authorization": "export const canEditPost=()=>true;export const canUploadFile=()=>true;export const isBoardFrozen=()=>false;export const isBoardScopedPostEdit=()=>true;",
  "@/lib/auth/audit": "export const createAuditLogData=v=>v;",
  "@/lib/board/post-snapshot": "export const boardPostEventDelivery=p=>({public:p.status==='PUBLISHED',authorGuestId:p.guestId,authorUserId:p.authorId});",
  "@/lib/security/rate-limit": "export const assertRateLimit=()=>{};",
  "@/lib/http": "export const assertSameOrigin=()=>{};export const apiError=e=>Response.json({error:e.message},{status:400});",
  "@/lib/files/document-convert": "export const warmUpPdfPreview=()=>{};",
  "@/lib/realtime/board-events": "export const publishBoardEvent=(boardId,event)=>globalThis.padImageEvents?.push({boardId,...event});",
};
export function imageUploadRequest(bytes, name="photo.jpg") {
  const form = new FormData(); form.append("file", new File([bytes], name));
  return new Request("https://fixture.invalid/api/posts/fixture/attachments", {method:"POST",body:form});
}
