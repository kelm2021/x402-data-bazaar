import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return [];
}

export default function ServiceDetailPage() {
  redirect("/api?format=json");
}
