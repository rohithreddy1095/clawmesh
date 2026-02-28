#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const farmRoot = path.join(repoRoot, "farm", "bhoomi");

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function readYaml(p) {
  return YAML.parse(readText(p));
}

function readJsonl(p) {
  if (!exists(p)) return [];
  const lines = readText(p)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSONL at ${p}:${idx + 1}: ${String(err)}`);
    }
  });
}

function walkFiles(dir, exts, acc = []) {
  if (!exists(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(p, exts, acc);
      continue;
    }
    if (exts.some((ext) => p.endsWith(ext))) {
      acc.push(p);
    }
  }
  return acc.sort();
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function countFieldValidationFlags(value) {
  let totalFlags = 0;
  let trueFlags = 0;
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "needs_field_validation") {
        totalFlags += 1;
        if (v === true) trueFlags += 1;
      }
      visit(v);
    }
  };
  visit(value);
  return { totalFlags, trueFlags };
}

function loadAllYaml(root) {
  const files = walkFiles(root, [".yaml", ".yml"]);
  const docs = [];
  for (const file of files) {
    docs.push({ file: path.relative(repoRoot, file), data: readYaml(file) });
  }
  return docs;
}

function main() {
  if (!exists(farmRoot)) {
    console.error(`Missing farm root: ${farmRoot}`);
    process.exit(1);
  }

  const yamlDocs = loadAllYaml(farmRoot);
  const jsonlFiles = walkFiles(farmRoot, [".jsonl"]);
  const jsonlDocs = new Map(jsonlFiles.map((f) => [f, readJsonl(f)]));

  const sitePath = path.join(farmRoot, "site.yaml");
  const siteDoc = exists(sitePath) ? readYaml(sitePath) : null;
  const zoneCandidatePath = path.join(farmRoot, "zones", "candidate-zones.yaml");
  const zoneCandidates = exists(zoneCandidatePath) ? readYaml(zoneCandidatePath) : null;
  const opsPath = path.join(farmRoot, "operations", "library.yaml");
  const opsDoc = exists(opsPath) ? readYaml(opsPath) : null;
  const tasksPath = path.join(farmRoot, "tasks", "active.jsonl");
  const eventsPath = path.join(farmRoot, "events", "events.jsonl");
  const tasks = jsonlDocs.get(tasksPath) ?? [];
  const events = jsonlDocs.get(eventsPath) ?? [];

  let totalValidationFlags = 0;
  let pendingValidationFlags = 0;
  for (const { data } of yamlDocs) {
    const c = countFieldValidationFlags(data);
    totalValidationFlags += c.totalFlags;
    pendingValidationFlags += c.trueFlags;
  }

  const lines = [];
  lines.push("Bhoomi Farm Twin Summary");
  lines.push("=======================");
  lines.push(`root: ${path.relative(repoRoot, farmRoot)}`);
  lines.push(`yaml docs: ${yamlDocs.length}`);
  lines.push(`jsonl files: ${jsonlFiles.length}`);
  lines.push("");

  if (siteDoc?.site) {
    const s = siteDoc.site;
    const loc = [s.location?.district, s.location?.state, s.location?.country].filter(Boolean).join(", ");
    lines.push(`site: ${s.name ?? "unknown"} (${s.site_id ?? "no-id"})`);
    lines.push(`location: ${loc || "unknown"}`);
    if (s.area?.value != null) {
      lines.push(`area: ~${s.area.value} ${s.area.unit ?? ""}`.trim());
    }
    lines.push(`digital twin maturity: ${s.digital_twin_status?.maturity ?? "unknown"}`);
    lines.push("");
  }

  if (zoneCandidates?.zones) {
    const zones = zoneCandidates.zones;
    lines.push(`candidate zones: ${zones.length}`);
    for (const [priority, count] of countBy(zones, (z) => z.survey_priority ?? "unspecified")) {
      lines.push(`  survey_priority.${priority}: ${count}`);
    }
    lines.push("");
  }

  if (opsDoc?.operations) {
    const ops = opsDoc.operations;
    lines.push(`operations: ${ops.length}`);
    for (const [status, count] of countBy(ops, (op) => op.status ?? "unspecified")) {
      lines.push(`  status.${status}: ${count}`);
    }
    lines.push("");
  }

  if (tasks.length > 0) {
    lines.push(`tasks(active): ${tasks.length}`);
    for (const [status, count] of countBy(tasks, (t) => t.status ?? "unspecified")) {
      lines.push(`  status.${status}: ${count}`);
    }
    lines.push("");
  }

  if (events.length > 0) {
    lines.push(`events: ${events.length}`);
    for (const [type, count] of countBy(events, (e) => e.type ?? "unspecified")) {
      lines.push(`  type.${type}: ${count}`);
    }
    lines.push("");
  }

  lines.push(`needs_field_validation flags: ${pendingValidationFlags}/${totalValidationFlags}`);
  lines.push("");

  const knowledgePath = path.join(farmRoot, "knowledge", "cross-location-patterns.yaml");
  if (exists(knowledgePath)) {
    const k = readYaml(knowledgePath);
    const locations = k?.knowledge?.locations ?? [];
    lines.push(`cross-location knowledge entries: ${locations.length}`);
    if (locations.length > 0) {
      const totalVideos = locations.reduce((n, loc) => n + (Number(loc.video_count) || 0), 0);
      lines.push(`cross-location referenced videos: ${totalVideos}`);
    }
  }

  console.log(lines.join("\n"));
}

try {
  main();
} catch (err) {
  console.error(String(err));
  process.exit(1);
}
