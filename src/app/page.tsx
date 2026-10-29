import { Suspense } from "react";
import { LoginPanel } from "@/components/LoginPanel";
import { Studio } from "@/components/Studio";
import { getSession } from "@/lib/session";

// עם cacheComponents קריאת עוגיות חייבת לשבת בתוך Suspense.
export default function Home() {
  return (
    <Suspense fallback={<main className="flex-1" aria-busy="true" />}>
      <SessionGate />
    </Suspense>
  );
}

async function SessionGate() {
  let email: string | null = null;
  let signedIn = false;
  let configError: string | null = null;
  try {
    const s = await getSession();
    signedIn = !!s;
    email = s?.email ?? null;
  } catch (e) {
    configError = e instanceof Error ? e.message : "שגיאת הגדרות";
  }

  if (configError) {
    return (
      <main className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-lg">האתר לא מוגדר עדיין.</p>
        <p className="mt-2 text-sm opacity-70">{configError}</p>
      </main>
    );
  }
  return signedIn ? <Studio email={email} /> : <LoginPanel />;
}
