#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const DEFAULT_DOWNLOADS_DIR = path.join(process.env.HOME ?? "/Users/rohhh", "Downloads");
const DEFAULT_OUTPUT_DIR = path.join(repoRoot, "farm", "bhoomi", "intake", "mr-green", "reports");
const DEFAULT_INDEX_PATH = path.join(repoRoot, "farm", "bhoomi", "intake", "mr-green", "index.yaml");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function writeYaml(file, data) {
  fs.writeFileSync(file, YAML.stringify(data), "utf8");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(text) {
  return decodeHtmlEntities(String(text).replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(text) {
  return String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function parseDateTextToIso(dateText) {
  const m = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) {
    return null;
  }
  return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sectionHtml(htmlLight, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<h2>${escaped}<\\/h2>([\\s\\S]*?)(?=<h2>|<div class="footer"|<\\/body>)`,
    "i",
  );
  return (htmlLight.match(re) || [])[1] ?? "";
}

function extractHeadingValue(htmlLight, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<p><strong>${escaped}:<\\/strong>\\s*([\\s\\S]*?)<\\/p>`, "i");
  const raw = (htmlLight.match(re) || [])[1];
  return raw ? normalizeWhitespace(stripTags(raw)) : null;
}

function extractProjectContext(projectContextSection) {
  const match = projectContextSection.match(/<p>([\s\S]*?)<\/p>/i);
  if (!match) return null;
  return normalizeWhitespace(stripTags(match[1]));
}

function extractStatMap(siteDiagnosticsSection) {
  const labels = [...siteDiagnosticsSection.matchAll(/<div class="stat-label">([\s\S]*?)<\/div>/gi)].map((m) =>
    normalizeWhitespace(stripTags(m[1])),
  );
  const values = [...siteDiagnosticsSection.matchAll(/<div class="stat-value">([\s\S]*?)<\/div>/gi)].map((m) =>
    normalizeWhitespace(stripTags(m[1])),
  );
  const stats = {};
  for (let i = 0; i < Math.min(labels.length, values.length); i++) {
    stats[labels[i]] = values[i];
  }
  return stats;
}

function extractImgAlts(section) {
  return [...section.matchAll(/<img\b[^>]*\balt="([^"]*)"/gi)].map((m) => normalizeWhitespace(decodeHtmlEntities(m[1])));
}

function parseVisionBoardHeading(rawHeading) {
  const heading = normalizeWhitespace(stripTags(rawHeading));
  // Split leading emoji/icon from title where possible.
  const m = heading.match(/^(\S+)\s+(.*)$/u);
  if (!m) {
    return { icon: null, title: heading };
  }
  if (/^[\p{Extended_Pictographic}]/u.test(m[1]) || /[^\w]/.test(m[1])) {
    return { icon: m[1], title: m[2] };
  }
  return { icon: null, title: heading };
}

function canonicalVisionBoardKey(input) {
  const raw = String(input ?? "").toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized.includes("strategic vision")) return "strategic-vision";
  if (normalized.includes("hydro logic") || normalized.includes("hydrologic")) return "hydro-logic-systems";
  if (normalized.includes("structures") && normalized.includes("vernacular")) return "structures-vernacular";
  if (normalized.includes("polyculture") && normalized.includes("microgreens")) return "polyculture-microgreens";
  if (normalized.includes("energy") && normalized.includes("solar")) return "energy-solar";
  if (normalized.includes("community") && (normalized.includes("social") || normalized.includes("loop"))) {
    return "community-loops";
  }
  if (normalized.includes("concept studio")) return "concept-studio";
  return slugify(normalized);
}

function extractVisionBoards(strategicVisionSection) {
  const boards = [];
  const re = /<h3>([\s\S]*?)<\/h3>\s*<div class="markdown-text">([\s\S]*?)<\/div>/gi;
  for (const match of strategicVisionSection.matchAll(re)) {
    const { icon, title } = parseVisionBoardHeading(match[1]);
    const content = normalizeWhitespace(stripTags(match[2]));
    boards.push({
      board_id: slugify(title) || `board-${boards.length + 1}`,
      board_category_key: canonicalVisionBoardKey(title),
      icon,
      title,
      content,
      source: "html_report",
    });
  }
  return boards;
}

function extractMasterplanGallery(masterplanSection) {
  const alts = extractImgAlts(masterplanSection).filter((alt) => /masterplan/i.test(alt));
  const versionLabels = [...masterplanSection.matchAll(/>\s*(Version\s+\d+:\s*[^<]+)<\/p>/gi)].map((m) =>
    normalizeWhitespace(decodeHtmlEntities(m[1])),
  );
  const generatedAtTimes = [...masterplanSection.matchAll(/Generated at\s*([^<]+)/gi)].map((m) =>
    normalizeWhitespace(decodeHtmlEntities(m[1])),
  );

  const items = [];
  const n = Math.max(alts.length, versionLabels.length, generatedAtTimes.length);
  for (let i = 0; i < n; i++) {
    const versionLabel = versionLabels[i] ?? null;
    const alt = alts[i] ?? null;
    const generatedAt = generatedAtTimes[i] ?? null;
    let styleHint = null;
    const styleMatch = versionLabel?.match(/:\s*(.+)$/);
    if (styleMatch) styleHint = styleMatch[1];
    items.push({
      index: i + 1,
      alt,
      version_label: versionLabel,
      generated_at_text: generatedAt,
      style_hint: styleHint,
      source: "html_report",
    });
  }
  return items;
}

function parseHtmlReport(htmlPath) {
  const htmlRaw = readText(htmlPath);
  // Replace embedded base64 images to keep regex parsing fast and stable.
  const htmlLight = htmlRaw.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[^"]+/g, "data:image/...BASE64...");

  const title = ((htmlLight.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] ?? "").trim() || null;
  const reportDateText = extractHeadingValue(htmlLight, "Date");
  const reportLocation = extractHeadingValue(htmlLight, "Location");
  const footerText = normalizeWhitespace(
    stripTags(((htmlLight.match(/<div class="footer">([\s\S]*?)<\/div>/i) || [])[1] ?? "")),
  );

  const projectContextSection = sectionHtml(htmlLight, "Project Context");
  const diagnosticsSection = sectionHtml(htmlLight, "Site Diagnostics");
  const initialPhotosSection = sectionHtml(htmlLight, "Initial Site Photos");
  const strategicVisionSection = sectionHtml(htmlLight, "Strategic Vision Boards");
  const masterplanSection = sectionHtml(htmlLight, "Master Plan Gallery");

  const stats = extractStatMap(diagnosticsSection);
  const visionBoards = extractVisionBoards(strategicVisionSection);
  const masterplans = extractMasterplanGallery(masterplanSection);
  const initialPhotoAlts = extractImgAlts(initialPhotosSection);
  const allImageCount = (htmlLight.match(/<img\b/gi) || []).length;

  return {
    title,
    report_date_text: reportDateText,
    report_date_iso: parseDateTextToIso(reportDateText),
    report_location: reportLocation,
    footer_text: footerText || null,
    project_context_text: extractProjectContext(projectContextSection),
    site_diagnostics: {
      rainfall_analysis: stats["Rainfall Analysis"] ?? null,
      soil_composition: stats["Soil Composition"] ?? null,
      sun_exposure: stats["Sun Exposure"] ?? null,
      raw_stat_labels: Object.keys(stats),
    },
    initial_site_media: {
      image_count: initialPhotoAlts.length,
      image_alts: initialPhotoAlts,
      section_present: initialPhotosSection.length > 0,
    },
    strategic_vision_boards: visionBoards,
    master_plan_gallery: masterplans,
    html_render_metrics: {
      total_img_count: allImageCount,
      strategic_vision_board_count: visionBoards.length,
      masterplan_count: masterplans.length,
    },
  };
}

function findCompanionJson(htmlPath, downloadsDir) {
  const base = path.basename(htmlPath);
  const htmlStat = fs.statSync(htmlPath);
  const dateMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return null;
  const date = dateMatch[1];
  const candidates = fs
    .readdirSync(downloadsDir)
    .filter((f) => new RegExp(`^mrgreen-project-${date}(?: \\(\\d+\\))?\\.json$`, "i").test(f))
    .map((f) => path.join(downloadsDir, f));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const da = Math.abs(fs.statSync(a).mtimeMs - htmlStat.mtimeMs);
    const db = Math.abs(fs.statSync(b).mtimeMs - htmlStat.mtimeMs);
    return da - db;
  });
  return candidates[0];
}

function parseJsonExport(jsonPath) {
  const root = JSON.parse(readText(jsonPath));
  const state = root?.state ?? {};
  const analysis = state.analysis ?? {};
  const designPlan = state.designPlan ?? {};
  const visionBoards = Array.isArray(designPlan.visionBoards) ? designPlan.visionBoards : [];
  const generatedMasterplans = Array.isArray(state.generatedMasterplans) ? state.generatedMasterplans : [];
  const chatHistory = Array.isArray(state.chatHistory) ? state.chatHistory : [];
  const latestModelMessage = [...chatHistory].reverse().find((m) => m?.role === "model");

  return {
    json_state: {
      phase: state.phase ?? null,
      max_phase: root.maxPhase ?? null,
      saved_at_ms: root.savedAt ?? null,
      location: state.location ?? null,
      project_context: state.projectContext ?? null,
      masterplan_style: state.masterplanStyle ?? null,
      error: state.error ?? null,
    },
    site_diagnostics: {
      rainfall_analysis: analysis.rainCheck ?? null,
      soil_composition: analysis.soilCheck ?? null,
      sun_exposure: analysis.sunCheck ?? null,
      critical_questions: Array.isArray(analysis.criticalQuestions) ? analysis.criticalQuestions : [],
    },
    strategic_vision_boards: visionBoards.map((b, idx) => ({
      board_id: b?.id ?? `board-${idx + 1}`,
      icon: b?.icon ?? null,
      title: b?.title ?? null,
      content: b?.content ?? null,
      style: b?.style ?? null,
      visualization_prompt: b?.visualizationPrompt ?? null,
      source: "json_export_state",
    })),
    design_prompts: {
      masterplan_prompt: designPlan.masterplanPrompt ?? null,
    },
    master_plan_gallery: {
      generated_masterplans: generatedMasterplans.map((m, idx) => ({
        index: idx + 1,
        style: m?.style ?? null,
        timestamp_ms: m?.timestamp ?? null,
        has_image: Boolean(m?.image),
        image_base64_length: typeof m?.image === "string" ? m.image.length : 0,
        source: "json_export_state",
      })),
      generated_masterplan_legacy: state.generatedMasterplan
        ? {
            has_image: true,
            image_base64_length:
              typeof state.generatedMasterplan === "string" ? state.generatedMasterplan.length : 0,
          }
        : null,
    },
    conversation_context: {
      chat_history_count: chatHistory.length,
      latest_model_message: latestModelMessage
        ? {
            id: latestModelMessage.id ?? null,
            timestamp: latestModelMessage.timestamp ?? null,
            text: latestModelMessage.text ?? null,
          }
        : null,
    },
  };
}

function mergeReport(htmlParsed, jsonParsed) {
  const mergedBoardsById = new Map();
  for (const board of htmlParsed.strategic_vision_boards ?? []) {
    const key = board.board_category_key || canonicalVisionBoardKey(board.title || board.board_id);
    mergedBoardsById.set(key, { ...board, board_category_key: key });
  }
  for (const board of jsonParsed?.strategic_vision_boards ?? []) {
    const key = canonicalVisionBoardKey(board.title || board.board_id);
    const existing = mergedBoardsById.get(key);
    const id = existing?.board_id ?? board.board_id ?? slugify(board.title ?? "") ?? `board-${mergedBoardsById.size + 1}`;
    mergedBoardsById.set(key, {
      board_id: id,
      board_category_key: key,
      icon: board.icon ?? existing?.icon ?? null,
      title: board.title ?? existing?.title ?? null,
      content: board.content ?? existing?.content ?? null,
      style: board.style ?? null,
      visualization_prompt: board.visualization_prompt ?? null,
      source: existing ? "html_report+json_export_state" : "json_export_state",
    });
  }

  const siteDiagnostics = {
    rainfall_analysis:
      jsonParsed?.site_diagnostics?.rainfall_analysis ?? htmlParsed.site_diagnostics.rainfall_analysis ?? null,
    soil_composition:
      jsonParsed?.site_diagnostics?.soil_composition ?? htmlParsed.site_diagnostics.soil_composition ?? null,
    sun_exposure: jsonParsed?.site_diagnostics?.sun_exposure ?? htmlParsed.site_diagnostics.sun_exposure ?? null,
    critical_questions: jsonParsed?.site_diagnostics?.critical_questions ?? [],
    source:
      jsonParsed?.site_diagnostics &&
      (jsonParsed.site_diagnostics.rainfall_analysis ||
        jsonParsed.site_diagnostics.soil_composition ||
        jsonParsed.site_diagnostics.sun_exposure)
        ? "json_export_state_preferred"
        : "html_report",
  };

  return {
    project_context: {
      text: jsonParsed?.json_state?.project_context ?? htmlParsed.project_context_text ?? null,
      source: jsonParsed?.json_state?.project_context ? "json_export_state" : "html_report",
    },
    site_diagnostics: siteDiagnostics,
    initial_site_media: {
      ...htmlParsed.initial_site_media,
      source: "html_report",
    },
    strategic_vision_boards: {
      count: mergedBoardsById.size,
      items: [...mergedBoardsById.values()],
    },
    master_plan_gallery: {
      rendered_items: htmlParsed.master_plan_gallery,
      rendered_count: htmlParsed.master_plan_gallery.length,
      generated_masterplans_json: jsonParsed?.master_plan_gallery?.generated_masterplans ?? [],
      generated_masterplans_json_count:
        jsonParsed?.master_plan_gallery?.generated_masterplans?.length ?? 0,
      generated_masterplan_legacy: jsonParsed?.master_plan_gallery?.generated_masterplan_legacy ?? null,
      source: jsonParsed ? "html_report+json_export_state" : "html_report",
    },
    design_prompts: {
      masterplan_prompt: jsonParsed?.design_prompts?.masterplan_prompt ?? null,
      source: jsonParsed?.design_prompts?.masterplan_prompt ? "json_export_state" : null,
    },
    critical_questions: {
      items: jsonParsed?.site_diagnostics?.critical_questions ?? [],
      source:
        (jsonParsed?.site_diagnostics?.critical_questions?.length ?? 0) > 0 ? "json_export_state" : null,
    },
    conversation_context: jsonParsed?.conversation_context ?? {
      chat_history_count: 0,
      latest_model_message: null,
    },
  };
}

function buildFarmTwinMappingHints(core) {
  const hints = [];
  if (core.project_context.text) {
    hints.push({
      target: "site.profile + goals + existing_assets",
      rationale: "Project context often contains location details, farm goals, and existing infrastructure.",
      action: "Extract explicit assets (e.g., tank dimensions, cows, structures) into site/assets YAML after validation.",
    });
  }
  if (core.site_diagnostics?.rainfall_analysis || core.site_diagnostics?.soil_composition || core.site_diagnostics?.sun_exposure) {
    hints.push({
      target: "site.climate_notes + zone.soil_profile hypotheses",
      rationale: "Mr Green diagnostics are useful starting hypotheses for climate/soil/sun modeling.",
      action: "Tag as design-time inference and confirm with local measurements/observations.",
    });
  }
  if ((core.strategic_vision_boards?.count ?? 0) > 0) {
    hints.push({
      target: "operations / assets / trials / human goals",
      rationale: "Vision boards mix infrastructure ideas, social loops, energy systems, and production concepts.",
      action: "Break each board into concrete candidate tasks and candidate assets.",
    });
  }
  if ((core.critical_questions?.items?.length ?? 0) > 0) {
    hints.push({
      target: "survey tasks + decision log",
      rationale: "Critical questions represent unresolved constraints and choices.",
      action: "Convert each question into a field survey task or explicit decision record.",
    });
  }
  return hints;
}

function buildNormalizedReport(htmlPath, htmlParsed, jsonPath, jsonParsed) {
  const htmlStat = fs.statSync(htmlPath);
  const filenameDateMatch = path.basename(htmlPath).match(/(\d{4}-\d{2}-\d{2})/);
  const filenameDateIso = filenameDateMatch ? filenameDateMatch[1] : null;
  const core = mergeReport(htmlParsed, jsonParsed);
  const reportId = slugify(path.basename(htmlPath, path.extname(htmlPath)));

  return {
    schema_version: "0.1",
    report: {
      report_id: reportId,
      provenance: {
        title: htmlParsed.title,
        report_date: {
          raw: htmlParsed.report_date_text,
          iso: htmlParsed.report_date_iso ?? filenameDateIso,
          source: htmlParsed.report_date_iso ? "html_report" : filenameDateIso ? "filename" : null,
        },
        report_location: htmlParsed.report_location,
        generator_footer: htmlParsed.footer_text,
        imported_at: new Date().toISOString(),
      },
      source_files: {
        html: {
          path: htmlPath,
          size_bytes: htmlStat.size,
          mtime_iso: new Date(htmlStat.mtimeMs).toISOString(),
        },
        companion_json: jsonPath
          ? {
              path: jsonPath,
              size_bytes: fs.statSync(jsonPath).size,
              mtime_iso: new Date(fs.statSync(jsonPath).mtimeMs).toISOString(),
            }
          : null,
      },
      source_priority: jsonPath ? ["json_export_state", "html_report"] : ["html_report"],
      labels: {
        evidence_label: "inference_repo",
        field_verified: false,
      },
      core_blocks: core,
      render_metrics: htmlParsed.html_render_metrics,
      json_state_metrics: jsonParsed
        ? {
            phase: jsonParsed.json_state.phase,
            max_phase: jsonParsed.json_state.max_phase,
            saved_at_ms: jsonParsed.json_state.saved_at_ms,
          }
        : null,
      farm_twin_mapping_hints: buildFarmTwinMappingHints(core),
    },
  };
}

function importReports({ downloadsDir = DEFAULT_DOWNLOADS_DIR, outputDir = DEFAULT_OUTPUT_DIR, indexPath = DEFAULT_INDEX_PATH } = {}) {
  ensureDir(outputDir);

  const htmlFiles = fs
    .readdirSync(downloadsDir)
    .filter((f) => /^MrGreen_Report_.*\.html$/i.test(f))
    .map((f) => path.join(downloadsDir, f))
    .sort();

  const imported = [];

  for (const htmlPath of htmlFiles) {
    const htmlParsed = parseHtmlReport(htmlPath);
    const jsonPath = findCompanionJson(htmlPath, downloadsDir);
    const jsonParsed = jsonPath ? parseJsonExport(jsonPath) : null;
    const normalized = buildNormalizedReport(htmlPath, htmlParsed, jsonPath, jsonParsed);
    const outFile = path.join(outputDir, `${normalized.report.report_id}.yaml`);
    writeYaml(outFile, normalized);

    imported.push({
      report_id: normalized.report.report_id,
      output_file: path.relative(repoRoot, outFile),
      title: normalized.report.provenance.title,
      report_date_iso: normalized.report.provenance.report_date.iso,
      report_location: normalized.report.provenance.report_location,
      source_type: jsonPath ? "html+json" : "html",
      strategic_vision_boards: normalized.report.core_blocks.strategic_vision_boards.count,
      initial_site_photos: normalized.report.core_blocks.initial_site_media.image_count,
      rendered_masterplans: normalized.report.core_blocks.master_plan_gallery.rendered_count,
      json_masterplans:
        normalized.report.core_blocks.master_plan_gallery.generated_masterplans_json_count,
    });
  }

  const indexDoc = {
    schema_version: "0.1",
    imports: {
      imported_at: new Date().toISOString(),
      downloads_dir: downloadsDir,
      report_count: imported.length,
      output_dir: path.relative(repoRoot, outputDir),
      reports: imported,
    },
    summary: {
      by_source_type: Object.fromEntries(
        [...imported.reduce((m, r) => m.set(r.source_type, (m.get(r.source_type) ?? 0) + 1), new Map())].sort(),
      ),
      total_strategic_vision_boards: imported.reduce((n, r) => n + (r.strategic_vision_boards || 0), 0),
      total_initial_site_photos: imported.reduce((n, r) => n + (r.initial_site_photos || 0), 0),
      total_rendered_masterplans: imported.reduce((n, r) => n + (r.rendered_masterplans || 0), 0),
      total_json_masterplans: imported.reduce((n, r) => n + (r.json_masterplans || 0), 0),
    },
  };

  writeYaml(indexPath, indexDoc);
  return { htmlFiles, imported, indexPath };
}

function main() {
  const args = process.argv.slice(2);
  const downloadsDirArgIndex = args.indexOf("--downloads-dir");
  const outputDirArgIndex = args.indexOf("--output-dir");
  const downloadsDir =
    downloadsDirArgIndex >= 0 && args[downloadsDirArgIndex + 1]
      ? path.resolve(args[downloadsDirArgIndex + 1])
      : DEFAULT_DOWNLOADS_DIR;
  const outputDir =
    outputDirArgIndex >= 0 && args[outputDirArgIndex + 1]
      ? path.resolve(args[outputDirArgIndex + 1])
      : DEFAULT_OUTPUT_DIR;
  const indexPath = path.join(path.dirname(outputDir), "index.yaml");

  if (!fs.existsSync(downloadsDir)) {
    throw new Error(`Downloads dir not found: ${downloadsDir}`);
  }

  const result = importReports({ downloadsDir, outputDir, indexPath });
  console.log(`Imported ${result.imported.length} Mr Green reports`);
  console.log(`Index: ${path.relative(repoRoot, result.indexPath)}`);
  for (const row of result.imported) {
    console.log(
      `- ${row.report_id}: source=${row.source_type}, boards=${row.strategic_vision_boards}, site_photos=${row.initial_site_photos}, rendered_masterplans=${row.rendered_masterplans}`,
    );
  }
}

try {
  main();
} catch (err) {
  console.error(String(err));
  process.exit(1);
}
