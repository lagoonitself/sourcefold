import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("health");

  if (error) {
    return NextResponse.json({ error: { message: "Database unreachable" } }, { status: 503 });
  }

  return NextResponse.json({ data: { status: "ok" } });
}
