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
  // Automated consolidation scheduler cadence (mirrors boise_cascade.yaml
  // dispatch_windows). run_at times sit just before each DMSi dispatch wave.
  dispatch_windows: {
    interval_minutes: number;
    run_at: string[]; // "HH:MM" local server time
  };
  // Legal limits for the 53-ft flatbed fleet (mirrors
  // apps/engine/config/boise_cascade.yaml vehicle_constraints). The optimizer
  // validates combined loads against max_cargo_payload_lbs.
  vehicle_constraints: {
    trailer_type: string;
    max_width_inches: number;
    max_height_inches: number;
    trailer_length_min_ft: number;
    trailer_length_max_ft: number;
    max_front_overhang_ft: number;
    max_rear_overhang_ft: number;
    max_gross_vehicle_weight_lbs: number;
    max_cargo_payload_lbs: number;
    max_steer_axle_weight_lbs: number;
    max_single_axle_weight_lbs: number;
    max_tandem_axle_weight_lbs: number;
  };
};

export const DEFAULT_CONFIG: EngineConfig = {
  detection: {
    same_customer: true,
    geo_cluster: true,
    cluster_radius_miles: 6.0,
    min_trucks: 2,
    max_load_lbs: 48000,
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
  dispatch_windows: {
    interval_minutes: 30,
    run_at: ["05:45", "09:15"],
  },
  vehicle_constraints: {
    trailer_type: "53-ft flatbed",
    max_width_inches: 102,
    max_height_inches: 162,
    trailer_length_min_ft: 48,
    trailer_length_max_ft: 53,
    max_front_overhang_ft: 3,
    max_rear_overhang_ft: 4,
    max_gross_vehicle_weight_lbs: 80000,
    max_cargo_payload_lbs: 48000,
    max_steer_axle_weight_lbs: 12000,
    max_single_axle_weight_lbs: 20000,
    max_tandem_axle_weight_lbs: 34000,
  },
};
