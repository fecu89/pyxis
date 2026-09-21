"use client";

import { useRouter } from "next/navigation";
import { SchoolDashboard } from "@/components/admin/school-dashboard";
import type { SchoolDirectoryItem } from "@/components/admin/types";

export function AdminDashboardRoutePanel({ schools, canEditSchoolProfile, canManageRoster }: {
  schools: SchoolDirectoryItem[];
  canEditSchoolProfile: boolean;
  canManageRoster: boolean;
}) {
  const router = useRouter();
  return (
    <SchoolDashboard
      schools={schools}
      canEditSchoolProfile={canEditSchoolProfile}
      canManageRoster={canManageRoster}
      onOpenStudents={(schoolId) => {
        const query = new URLSearchParams({ role: "STUDENT" });
        if (schoolId) query.set("schoolId", schoolId);
        router.push(`/admin/users?${query}`);
      }}
      onOpenOrganizations={() => router.push("/admin/schools")}
      onOpenRoster={() => router.push("/admin/roster")}
      onChanged={() => undefined}
    />
  );
}
