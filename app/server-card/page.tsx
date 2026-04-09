import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ServerCardPage() {
  redirect("/.well-known/mcp/server-card.json");
}
