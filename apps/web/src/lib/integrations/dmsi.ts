/**
 * DMSi Agility REST API client — SERVER ONLY.
 *
 * Pulls the day's released orders and pushes the consolidated dispatch plan
 * back so Steve's team sees optimized routes inside DMSi, never leaving it.
 *
 * Auth: API key in a header. Config: DMSI_API_KEY, DMSI_BASE_URL, DMSI_LIVE_MODE.
 *
 * Endpoints used (SHARE WITH DMSi/Steve's IT TO CONFIRM + WHITELIST — exact
 * paths/header name must be verified against the client's Agility API contract):
 *   GET  {DMSI_BASE_URL}/api/v1/orders?deliveryDate=YYYY-MM-DD&status=released
 *        -> the day's released orders (order #, customer, ship-to, product,
 *           weight, requested delivery window, dispatch wave / release time)
 *   POST {DMSI_BASE_URL}/api/v1/dispatch/plans
 *        -> push a consolidated dispatch plan into the DMSi dispatch module
 *   Auth header: "Authorization: Bearer <DMSI_API_KEY>"  (confirm w/ DMSi)
 *
 * Gating:
 *   - No key/URL              -> pull returns empty (mocked); push is logged only.
 *   - DMSI_LIVE_MODE != true  -> push posts to the local mock endpoint, and the
 *     exact payload is saved to the audit log so the format can be validated
 *     before ever touching production. Flip DMSI_LIVE_MODE=true for real writes.
 */

import "server-only";
import { writeAudit } from "@/lib/integrations/audit";

const BASE = () => (process.env.DMSI_BASE_URL || "").replace(/\/$/, "");
const KEY = () => process.env.DMSI_API_KEY || "";

export function dmsiConfigured(): boolean {
  return KEY().length > 0 && BASE().length > 0;
}
export function dmsiLive(): boolean {
  return process.env.DMSI_LIVE_MODE === "true";
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${KEY()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// Raw DMSi order shape (per the documented Agility order model; field names to
// be confirmed against the client's API version).
export type DmsiOrder = {
  orderNumber: string;
  customerName: string;
  shipToAddress: string;
  city?: string;
  state?: string;
  zip?: string;
  product?: string;
  weightLbs?: number;
  requestedDeliveryDate?: string; // YYYY-MM-DD
  deliveryWindow?: string;
  dispatchWave?: string; // release time, e.g. "06:30"
  lat?: number;
  lng?: number;
};

// Normalize a DMSi order into our delivery_records insert shape.
export function normalizeOrder(o: DmsiOrder, orgId: string, uploadId: string | null) {
  const address = [o.shipToAddress, o.city, [o.state, o.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    org_id: orgId,
    upload_id: uploadId,
    customer_name: o.customerName ?? null,
    address: address || null,
    delivery_date: o.requestedDeliveryDate ?? null,
    delivery_window: o.dispatchWave ?? o.deliveryWindow ?? null,
    order_size: typeof o.weightLbs === "number" ? o.weightLbs : null,
    truck_id: null, // assigned by dispatch, not present at order release
    route_id: o.orderNumber ?? null,
    lat: typeof o.lat === "number" ? o.lat : null,
    lng: typeof o.lng === "number" ? o.lng : null,
  };
}

export async function pullOrders(
  deliveryDate: string,
): Promise<{ orders: DmsiOrder[]; mocked: boolean; error?: string }> {
  if (!dmsiConfigured()) {
    return { orders: [], mocked: true };
  }
  try {
    const url = `${BASE()}/api/v1/orders?deliveryDate=${encodeURIComponent(deliveryDate)}&status=released`;
    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return { orders: [], mocked: false, error: `DMSi ${res.status}` };
    const data = await res.json();
    const orders = Array.isArray(data?.orders) ? (data.orders as DmsiOrder[]) : [];
    return { orders, mocked: false };
  } catch (e) {
    return { orders: [], mocked: false, error: e instanceof Error ? e.message : "DMSi error" };
  }
}

export type DispatchPlan = {
  planDate: string;
  generatedBy: string;
  trucksBefore: number;
  trucksAfter: number;
  milesBefore: number;
  milesAfter: number;
  routes: {
    truckId: string;
    stops: { orderNumber: string; customerName: string; sequence: number }[];
    totalWeightLbs: number;
    totalMiles: number;
  }[];
};

/**
 * Push a consolidated plan back to DMSi. In simulation mode the same code path
 * runs but the request goes to `mockUrl` and the payload is saved to the audit
 * log. Only DMSI_LIVE_MODE=true sends to production.
 */
export async function pushDispatchPlan(args: {
  orgId: string;
  plan: DispatchPlan;
  mockUrl: string;
}): Promise<{ sent: boolean; mode: "live" | "simulation"; status: number; message: string }> {
  const { orgId, plan, mockUrl } = args;
  const live = dmsiLive() && dmsiConfigured();
  const mode: "live" | "simulation" = live ? "live" : "simulation";
  const target = live ? `${BASE()}/api/v1/dispatch/plans` : mockUrl;

  // Always record the exact payload that would post to DMSi.
  await writeAudit({
    orgId,
    sourceSystem: "dmsi",
    eventType: "push_plan",
    direction: "outbound",
    status: "success",
    recordCount: plan.routes.length,
    message: `Dispatch plan ${mode} -> ${live ? "DMSi production" : "local mock"}`,
    payload: plan,
  });

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: live ? authHeaders() : { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    return {
      sent: live,
      mode,
      status: res.status,
      message: live
        ? `Sent to DMSi dispatch (${res.status})`
        : `Simulated: payload logged, posted to mock (${res.status})`,
    };
  } catch (e) {
    await writeAudit({
      orgId,
      sourceSystem: "dmsi",
      eventType: "push_plan",
      direction: "outbound",
      status: "failure",
      message: e instanceof Error ? e.message : "push failed",
    });
    return { sent: false, mode, status: 502, message: "Push failed — logged to audit" };
  }
}
