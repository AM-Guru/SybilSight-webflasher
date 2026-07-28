import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function resolveBuildSha() {
  const configured = String(
    process.env.GITHUB_SHA ?? process.env.VITE_BUILD_SHA ?? "",
  )
    .trim()
    .toLowerCase();
  if (/^[0-9a-f]{40}$/.test(configured)) return configured;
  try {
    const local = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    })
      .trim()
      .toLowerCase();
    if (/^[0-9a-f]{40}$/.test(local)) return local;
  } catch {
    // A source archive without Git metadata may still be inspected and tested,
    // but its build cannot pass the production mutation-release gate.
  }
  return "development";
}

function releaseManifest(buildSha) {
  const source = `${JSON.stringify({
    schemaVersion: 1,
    buildSha,
  })}\n`;
  return {
    name: "webflasher-release-manifest",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url, "http://localhost").pathname !== "/release.json") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "release.json",
        source,
      });
    },
  };
}

const buildSha = resolveBuildSha();

export default defineConfig({
  plugins: [react(), releaseManifest(buildSha)],
  define: {
    __WEBFLASHER_BUILD_SHA__: JSON.stringify(buildSha),
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    proxy: {
      // The production deployment carries the immutable, hash-pinned firmware
      // archive separately from this source tree. Keep the local catalog file
      // local, but resolve its versioned binary/metadata paths from production
      // so hardware tests never receive Vite's index.html fallback.
      "/firmware-updates/source-files/2": {
        target: "https://webflasher.sybilsight.com",
        changeOrigin: true,
        // Locally staged artifacts (for example a new CFW bundle) must win
        // over the production archive; proxy only what public/ lacks.
        bypass(request) {
          try {
            const pathname = decodeURIComponent(
              new URL(request.url, "http://localhost").pathname,
            );
            const local = path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              "public",
              pathname,
            );
            if (existsSync(local) && statSync(local).isFile()) {
              return request.url;
            }
          } catch {
            // Fall through to the proxy on any resolution error.
          }
          return undefined;
        },
      },
    },
    watch: {
      usePolling: process.env.CODEX_SANDBOX === "seatbelt",
    },
  },
});
