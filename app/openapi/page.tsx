import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OpenApiPage() {
  redirect("/openapi.json");
}
