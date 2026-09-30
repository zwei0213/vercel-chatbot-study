import type { Metadata } from "next";
import { StudyAdmin } from "@/components/study-admin";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "研究后台",
};

export const dynamic = "force-dynamic";

export default async function StudyAdminPage() {
  const authenticated = await isStudyAdminAuthenticated();
  return <StudyAdmin initialAuthenticated={authenticated} />;
}
