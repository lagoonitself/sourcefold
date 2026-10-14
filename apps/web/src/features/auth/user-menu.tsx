import { getSessionUser } from "@/lib/supabase/server";
import { UserMenuClient } from "@/features/auth/user-menu-client";

export async function UserMenu() {
  const user = await getSessionUser();

  if (!user?.email) {
    return null;
  }

  return <UserMenuClient email={user.email} />;
}
