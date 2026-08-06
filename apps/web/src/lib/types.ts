// Row shapes for the existing Supabase schema (public). Hand-written to match
// the tables exactly; no generated types so the app stays dependency-light.

export type Org = {
  id: string;
  name: string;
  created_at: string;
};

export type Membership = {
  id: string;
  user_id: string | null;
  org_id: string | null;
  role: string;
  created_at: string | null;
};

export type UploadStatus = "pending" | "processed" | "failed";

export type Upload = {
  id: string;
  org_id: string;
  storage_path: string;
  status: string;
  uploaded_by: string | null;
  created_at: string | null;
};

export type DeliveryRecord = {
  id: string;
  org_id: string;
  upload_id: string | null;
  customer_name: string | null;
  address: string | null;
  delivery_date: string | null; // YYYY-MM-DD
  delivery_window: string | null;
  order_size: number | null;
  truck_id: string | null;
  route_id: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string | null;
};

export type RunStatus = "pending" | "running" | "completed" | "failed";

export type AnalysisRun = {
  id: string;
  org_id: string;
  upload_id: string | null;
  status: string;
  params: RunParams | null;
  created_at: string | null;
};

export type ConsolidationFinding = {
  id: string;
  org_id: string;
  run_id: string | null;
  customer_name: string | null;
  date: string | null; // YYYY-MM-DD
  duplicate_trucks: number | null;
  wasted_miles: number | null;
  wasted_hours: number | null;
  est_cost_usd: number | null;
  consolidated_plan_json: ConsolidatedPlan | null;
  created_at: string | null;
};

// --- JSON payload shapes ---------------------------------------------------

export type ConsolidatedPlan = {
  group_id: string;
  type: "same_customer" | "geo_cluster";
  truck_ids: string[];
  customer_names?: string[];
  customer_ids?: string[];
  order_ids: string[];
  delivery_count: number;
  distinct_trucks: number;
  total_weight_lbs?: number;
  min_trucks_needed?: number;
  leg_miles: number;
  centroid: [number, number];
  cost_3pl_benchmark: number;
};

export type RunTotals = {
  candidate_groups: number;
  redundant_trucks: number;
  wasted_miles: number;
  wasted_fleet_hours: number;
  cost_internal: number;
  cost_3pl_benchmark: number;
  truck_visits_before: number;
  truck_visits_after: number;
  truck_visits_eliminated: number;
  records_analyzed: number;
  records_skipped_no_coords: number;
};

export type RunParams = {
  engine: string;
  source: string;
  detection: Record<string, unknown>;
  costs: Record<string, unknown>;
  totals?: RunTotals;
  error?: string;
};
