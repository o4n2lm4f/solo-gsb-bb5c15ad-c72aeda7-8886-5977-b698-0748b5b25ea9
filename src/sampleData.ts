export const SAMPLE_BASE = `{
  "app": "demo-service",
  "version": "1.2.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": false,
    "logging": { "level": "info", "format": "json" }
  },
  "tags": ["web", "api"],
  "database": { "host": "db.internal", "port": 5432, "pool": 10 },
  "deprecated": { "oldApi": true }
}`;

export const SAMPLE_OURS = `{
  "app": "demo-service",
  "version": "1.3.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": true,
    "logging": { "level": "debug", "format": "json" }
  },
  "tags": ["web", "api"],
  "database": { "host": "db.internal", "port": 5432, "pool": 20 },
  "owner": "team-a"
}`;

export const SAMPLE_THEIRS = `{
  "app": "demo-service",
  "version": "1.3.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": false,
    "logging": { "level": "warn", "format": "json" }
  },
  "tags": ["web", "api", "v2"],
  "database": { "host": "db.internal", "port": 5433, "pool": 50 },
  "deprecated": { "oldApi": false },
  "region": "cn-east"
}`;

// ── RFC 6902 补丁模式示例：同一份基线，两侧分别给出 JSON Patch ──────────────

export const SAMPLE_PATCH_BASE = `{
  "app": "demo-service",
  "version": "1.2.0",
  "replicas": 2,
  "features": {
    "auth": true,
    "cache": false,
    "logging": { "level": "info", "format": "json" }
  },
  "tags": ["web", "api"],
  "database": { "host": "db.internal", "port": 5432, "pool": 10 }
}`;

export const SAMPLE_OURS_PATCH = `[
  { "op": "test", "path": "/version", "value": "1.2.0" },
  { "op": "replace", "path": "/version", "value": "1.3.0" },
  { "op": "replace", "path": "/features/cache", "value": true },
  { "op": "replace", "path": "/features/logging/level", "value": "debug" },
  { "op": "replace", "path": "/database/pool", "value": 20 },
  { "op": "add", "path": "/owner", "value": "team-a" }
]`;

export const SAMPLE_THEIRS_PATCH = `[
  { "op": "replace", "path": "/version", "value": "1.3.0" },
  { "op": "replace", "path": "/features/logging/level", "value": "warn" },
  { "op": "add", "path": "/tags/-", "value": "v2" },
  { "op": "replace", "path": "/database/port", "value": 5433 },
  { "op": "move", "from": "/database/host", "path": "/database/hostname" },
  { "op": "copy", "from": "/replicas", "path": "/replicasInitial" },
  { "op": "add", "path": "/region", "value": "cn-east" }
]`;
