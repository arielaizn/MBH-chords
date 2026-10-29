import { NotSignedIn } from "./session";

// עוטף route handler: שגיאת "לא מחובר" הופכת ל-401, כל השאר ל-500 עם הודעה קריאה.
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotSignedIn) {
      return Response.json({ error: "צריך להתחבר עם ChatGPT" }, { status: 401 });
    }
    const message = e instanceof Error ? e.message : "שגיאה לא צפויה";
    return Response.json({ error: message }, { status: 500 });
  }
}
