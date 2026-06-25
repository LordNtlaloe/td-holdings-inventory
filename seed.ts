/**
 * seed.ts
 *
 * Seeds both the `inventory` and `batches` tables with 100 units of every
 * product in a store's department(s), for every storeDepartments row.
 *
 * Usage:
 *   export CONVEX_URL="https://your-deployment.convex.cloud"
 *   NODE_OPTIONS="--dns-result-order=ipv4first" npx tsx seed.ts
 *
 * Requires:
 *   npm install convex
 *
 * IMPORTANT: This calls a one-off mutation (`seed.insertSeedDataRaw`) that
 * you should add to convex/seed.ts (see companion file) because:
 *   - `receiveBatch` enforces a "max one batch per store+product per 7 days"
 *     rule and stamps receivedAt with Date.now(), which would collide for
 *     bulk-seeding.
 *   - There's no existing bulk mutation for `inventory` rows.
 * This mutation bypasses those guards, skips inventory rows that already
 * exist for a store+product pair, and lets us set receivedAt explicitly.
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVEX_URL = process.env.CONVEX_URL || "https://YOUR-DEPLOYMENT.convex.cloud";

const client = new ConvexHttpClient(CONVEX_URL);

type InventoryRow = {
  storeId: string;
  productId: string;
  reorderLevel?: number;
};

type BatchRow = {
  storeId: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  costPrice: number;
  receivedAt: number;
};

async function main() {
  if (!process.env.CONVEX_URL) {
    console.error("CONVEX_URL is not set. Run: export CONVEX_URL=https://your-deployment.convex.cloud");
    process.exit(1);
  }
  console.log("Using deployment:", CONVEX_URL);

  const inventory: InventoryRow[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "inventory.json"), "utf-8")
  );
  const batches: BatchRow[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "batches.json"), "utf-8")
  );

  console.log(`Seeding ${inventory.length} inventory rows and ${batches.length} batches...`);

  const CHUNK_SIZE = 50;
  let totalInventoryInserted = 0;
  let totalBatchesInserted = 0;

  for (let i = 0; i < batches.length; i += CHUNK_SIZE) {
    const batchChunk = batches.slice(i, i + CHUNK_SIZE);
    // Match the inventory rows whose storeId+productId pairs appear in this
    // batch chunk, so both tables get seeded together per chunk.
    const keysInChunk = new Set(batchChunk.map((b) => `${b.storeId}:${b.productId}`));
    const inventoryChunk = inventory.filter((inv) =>
      keysInChunk.has(`${inv.storeId}:${inv.productId}`)
    );

    const result: any = await client.mutation(anyApi.seed.insertSeedDataRaw, {
      inventory: inventoryChunk,
      batches: batchChunk,
    });

    totalInventoryInserted += result?.inventoryInserted ?? 0;
    totalBatchesInserted += result?.batchesInserted ?? 0;

    console.log(
      `Progress: ${Math.min(i + CHUNK_SIZE, batches.length)}/${batches.length} batches processed ` +
      `(inventory so far: ${totalInventoryInserted}, batches so far: ${totalBatchesInserted})`
    );
  }

  console.log("Done.");
  console.log(`Total inventory rows inserted: ${totalInventoryInserted}`);
  console.log(`Total batches inserted: ${totalBatchesInserted}`);
}

main().catch((err) => {
  console.error("Seed failed:");
  console.error(err?.message || err);
  if (err?.data) console.error("data:", err.data);
  if (err?.cause) console.error("cause:", err.cause);
  process.exit(1);
});