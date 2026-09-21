import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { decryptUserLoginIdentifier } from "@/lib/users/repository";

export async function GET() {
  try {
    const user = await requireActiveUser();
    const prisma = getPrisma();
    const [profile, ownedBoards, memberships, posts, comments] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, loginIdentifierEncrypted: true, role: true, createdAt: true } }),
      prisma.board.findMany({ where: { ownerId: user.id }, select: { id: true, slug: true, title: true, discoveryScope: true, createdAt: true } }),
      prisma.boardMember.findMany({ where: { userId: user.id }, select: { role: true, joinedAt: true, board: { select: { id: true, slug: true, title: true } } } }),
      prisma.post.findMany({ where: { authorId: user.id, deletedAt: null }, select: { id: true, boardId: true, title: true, body: true, createdAt: true } }),
      prisma.comment.findMany({ where: { authorId: user.id, deletedAt: null }, select: { id: true, postId: true, body: true, createdAt: true } }),
    ]);

    const loginIdentifier = decryptUserLoginIdentifier(profile);
    const data = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: profile.id,
        loginType: user.loginType,
        ...(user.loginType === "LOGIN_ID" ? { loginId: loginIdentifier } : { email: loginIdentifier }),
        name: user.name,
        role: profile.role,
        joinedPyxCourseAt: profile.createdAt.toISOString(),
      },
      ownedBoards: ownedBoards.map((board) => ({ ...board, createdAt: board.createdAt.toISOString() })),
      memberships: memberships.map((membership) => ({
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
        board: membership.board,
      })),
      posts: posts.map((post) => ({ ...post, createdAt: post.createdAt.toISOString() })),
      comments: comments.map((comment) => ({ ...comment, createdAt: comment.createdAt.toISOString() })),
    };

    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"pyxcourse-my-data.json\"",
      },
    });
  } catch (error) {
    return apiError(error, "내 데이터를 내보내지 못했습니다.");
  }
}
