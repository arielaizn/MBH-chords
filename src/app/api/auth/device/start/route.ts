import { startDeviceLogin } from "@/lib/chatgpt/auth";
import { guard } from "@/lib/api";

export async function POST() {
  return guard(async () => Response.json(await startDeviceLogin()));
}
