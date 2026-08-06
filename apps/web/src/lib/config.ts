// Engine configuration for the web app. Mirrors apps/engine/config/boise_cascade.yaml.
// Kept as a typed constant so the TS engine and the Python engine produce the
// same numbers. A future multi-client build would source this per-org; for now
// it's the single Boise Cascade rate card.

export type EngineConfig = {
  detection: {
    same_customer: boolean;
    geo_cluster: boolean;
    cluster_radius_miles: number;
    min_trucks: number;
  };
  costs: {
    currency: string;
    cost_per_mile: number;
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
    cluster_radius_miles: 0.5,
    min_trucks: 2,
  },
  costs: {
    currency: "USD",
    cost_per_mile: 2.1,
    cost_per_fleet_hour: 68.0,
    third_party_rate_per_mile: 3.25,
    avg_speed_mph: 32.0,
    service_time_minutes: 20,
    depot: { name: "Boise Cascade DC", lat: 43.6169, lng: -116.2064 },
  },
};
