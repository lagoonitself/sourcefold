import { createClient } from "@/lib/supabase/server";
import { UserMenuClient } from "@/features/auth/user-menu-client";

export async function UserMenu() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return null;
  }

  return <UserMenuClient email={user.email} />;
}
