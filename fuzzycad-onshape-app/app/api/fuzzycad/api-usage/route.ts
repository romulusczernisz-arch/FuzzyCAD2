import { NextRequest, NextResponse } from "next/server";
import {
  getOnshapeApiUsage,
  resetOnshapeApiUsage,
} from "../../../lib/server/onshapeApi";

export async function GET(req: NextRequest) {
  const reset = req.nextUrl.searchParams.get("reset") === "1";

  if (reset) {
    resetOnshapeApiUsage();
  }

  return NextResponse.json({
    ok: true,
    reset,
    usage: getOnshapeApiUsage(),
  });
}