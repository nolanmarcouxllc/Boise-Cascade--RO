// Engine configuration for the web app. Mirrors apps/engine/config/boise_cascade.yaml.
// Kept as a typed constant so the TS engine and the Python engine produce the
// same numbers. A future multi-client build would source this per-org.

export type EngineConfig = {
  detection: {
    same_customer: boolean;
    geo_cluster: boolean;
    cluster_radius_miles: number;
    min_trucks: number;
    max_load_lbs: number; // legal flatbed payload; gates weight-feasibility
  };
  costs: {
    currency: string;
    cost_per_mile: number;
    fuel_surcharge_per_mile: number;
    cost_per_fleet_hour: number;
    third_party_rate_per_mile: number;
    avg_speed_mph: number;
    service_time_minutes: number;
    depot: { name: string; lat: number; lng: number };
  };
};

export const DEFAULT_CONFIG: EngineConfig = {
  detection: {
    same_customer: true,
    geo_cluster: true,
    cluster_radius_miles: 6.0,
    min_trucks: 2,
    max_load_lbs: 44000,
  },
  costs: {
    currency: "USD",
    cost_per_mile: 1.82,
    fuel_surcharge_per_mile: 0.45,
    cost_per_fleet_hour: 87.5,
    third_party_rate_per_mile: 3.6,
    avg_speed_mph: 45.0,
    service_time_minutes: 45,
    depot: {
      name: "Boise Cascade BMD — Westfield",
      lat: 42.1248,
      lng: -72.7496,
    },
  },
};
