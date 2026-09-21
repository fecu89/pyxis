export type PlatformSecurityPolicy = {
  adminReauthWindowMinutes: number;
  publicQuizJoinPerMinute: number;
  publicQuizApiRequestsPerMinute: number;
  publicQuizSocketEventsPerMinute: number;
  publicQuizSocketMaxConnections: number;
  publicQuizSocketConnectionsPerIp: number;
  publicQuizSocketConnectionsPerParticipant: number;
};

export const PLATFORM_SECURITY_POLICY_DEFAULTS: PlatformSecurityPolicy = {
  adminReauthWindowMinutes: 60,
  // 학교 NAT 뒤 한 반 전체가 같은 IP로 동시에 들어오므로 20은 정상 수업도 막았습니다.
  // 정상 입장은 120까지 받고, 틀린 PIN은 별도 20/분 실패 버킷으로 제한합니다.
  publicQuizJoinPerMinute: 120,
  publicQuizApiRequestsPerMinute: 120,
  publicQuizSocketEventsPerMinute: 120,
  publicQuizSocketMaxConnections: 500,
  // 학교 NAT 한 곳에서 100명 수업과 순간 재연결 여유를 함께 수용합니다.
  publicQuizSocketConnectionsPerIp: 200,
  publicQuizSocketConnectionsPerParticipant: 3,
};

export const PLATFORM_SECURITY_POLICY_BOUNDS: Record<keyof PlatformSecurityPolicy, { min: number; max: number }> = {
  adminReauthWindowMinutes: { min: 5, max: 30 * 24 * 60 },
  publicQuizJoinPerMinute: { min: 1, max: 600 },
  publicQuizApiRequestsPerMinute: { min: 10, max: 3_000 },
  publicQuizSocketEventsPerMinute: { min: 10, max: 3_000 },
  publicQuizSocketMaxConnections: { min: 10, max: 10_000 },
  publicQuizSocketConnectionsPerIp: { min: 10, max: 1_000 },
  publicQuizSocketConnectionsPerParticipant: { min: 1, max: 10 },
};

export const PLATFORM_SECURITY_POLICY_KEYS = Object.keys(
  PLATFORM_SECURITY_POLICY_DEFAULTS,
) as (keyof PlatformSecurityPolicy)[];
