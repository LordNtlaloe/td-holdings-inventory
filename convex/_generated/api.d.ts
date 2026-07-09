/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as auth from "../auth.js";
import type * as batches from "../batches.js";
import type * as categories from "../categories.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as departments from "../departments.js";
import type * as employees from "../employees.js";
import type * as http from "../http.js";
import type * as internal_stores from "../internal/stores.js";
import type * as inventory from "../inventory.js";
import type * as ledger from "../ledger.js";
import type * as print from "../print.js";
import type * as products from "../products.js";
import type * as purchases from "../purchases.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as seed from "../seed.js";
import type * as storeDepartments from "../storeDepartments.js";
import type * as stores from "../stores.js";
import type * as suppliers from "../suppliers.js";
import type * as transfers from "../transfers.js";
import type * as users from "../users.js";
import type * as utils from "../utils.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  auth: typeof auth;
  batches: typeof batches;
  categories: typeof categories;
  customers: typeof customers;
  dashboard: typeof dashboard;
  departments: typeof departments;
  employees: typeof employees;
  http: typeof http;
  "internal/stores": typeof internal_stores;
  inventory: typeof inventory;
  ledger: typeof ledger;
  print: typeof print;
  products: typeof products;
  purchases: typeof purchases;
  reports: typeof reports;
  sales: typeof sales;
  seed: typeof seed;
  storeDepartments: typeof storeDepartments;
  stores: typeof stores;
  suppliers: typeof suppliers;
  transfers: typeof transfers;
  users: typeof users;
  utils: typeof utils;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
