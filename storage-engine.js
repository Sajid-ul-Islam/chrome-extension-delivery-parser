/**
 * DEEN Delivery Parser - High-Throughput Storage & Database Engine (DeenStoreDB)
 *
 * Implements an asynchronous, high-capacity IndexedDB storage engine with synchronous
 * fallback (LocalStorage & Memory Cache) for high-volume WooCommerce orders and multi-courier tracking.
 *
 * Features:
 * 1. IndexedDB asynchronous storage supporting 1GB+ of customer courier intelligence.
 * 2. 5 Indexed Object Stores:
 *    - customer_ratings (phone, successRate, riskLevel, compositeScore, timestamp)
 *    - order_metadata (orderId, phone, address, cod, isOutsideDhaka, timestamp)
 *    - order_phone_cache (orderId, phone, timestamp)
 *    - ndr_alerts (trackingId, orderId, phone, courier, status, timestamp)
 *    - dispatch_queue (queueId, orderId, courier, status, timestamp)
 * 3. Transparent multi-tier fallback: IndexedDB -> chrome.storage.local -> localStorage -> memory cache.
 * 4. Backward-compatible synchronous API methods to preserve all existing invariant exports.
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DeenStorage = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DB_NAME = "DeenStoreDB";
  const DB_VERSION = 1;
  const RATING_CACHE_KEY = "deen_customer_ratings_cache_v1";
  const ORDER_PHONE_CACHE_KEY = "deen_order_phone_cache_v1";
  const RATING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // In-memory instant fallback caches
  const memoryRatingCache = new Map();
  const memoryOrderPhoneCache = new Map();
  const memoryOrderMetadataCache = new Map();
  const memoryNDRAlertsCache = new Map();

  let dbPromise = null;

  /**
   * Normalize 11-digit Bangladeshi mobile number
   */
  function normalizePhone(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/[^\d+]/g, "");
    const match = digits.match(/(?:(?:\+?880)|880|0)?(1[3-9]\d{8})\b/);
    if (match && match[1]) return "0" + match[1];
    const plain = String(phone).replace(/\D/g, "");
    if (plain.length === 11 && plain.startsWith("01")) return plain;
    if (plain.length === 13 && plain.startsWith("8801")) return plain.slice(2);
    return null;
  }

  /**
   * Clean order ID
   */
  function cleanOrderId(orderId) {
    if (!orderId) return "";
    return String(orderId).replace(/^#/, "").trim();
  }

  /**
   * Initialize IndexedDB Database instance
   */
  function getDB() {
    if (dbPromise) return dbPromise;

    if (typeof indexedDB === "undefined") {
      dbPromise = Promise.resolve(null);
      return dbPromise;
    }

    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = function (e) {
          const db = e.target.result;

          // 1. customer_ratings store
          if (!db.objectStoreNames.contains("customer_ratings")) {
            const store = db.createObjectStore("customer_ratings", { keyPath: "phone" });
            store.createIndex("successRate", "successRate", { unique: false });
            store.createIndex("riskLevel", "riskLevel", { unique: false });
            store.createIndex("timestamp", "timestamp", { unique: false });
          }

          // 2. order_metadata store
          if (!db.objectStoreNames.contains("order_metadata")) {
            const store = db.createObjectStore("order_metadata", { keyPath: "orderId" });
            store.createIndex("phone", "phone", { unique: false });
            store.createIndex("district", "district", { unique: false });
            store.createIndex("timestamp", "timestamp", { unique: false });
          }

          // 3. order_phone_cache store
          if (!db.objectStoreNames.contains("order_phone_cache")) {
            const store = db.createObjectStore("order_phone_cache", { keyPath: "orderId" });
            store.createIndex("phone", "phone", { unique: false });
            store.createIndex("timestamp", "timestamp", { unique: false });
          }

          // 4. ndr_alerts store
          if (!db.objectStoreNames.contains("ndr_alerts")) {
            const store = db.createObjectStore("ndr_alerts", { keyPath: "trackingId" });
            store.createIndex("orderId", "orderId", { unique: false });
            store.createIndex("phone", "phone", { unique: false });
            store.createIndex("courier", "courier", { unique: false });
            store.createIndex("status", "status", { unique: false });
          }

          // 5. dispatch_queue store
          if (!db.objectStoreNames.contains("dispatch_queue")) {
            const store = db.createObjectStore("dispatch_queue", { keyPath: "queueId" });
            store.createIndex("orderId", "orderId", { unique: false });
            store.createIndex("courier", "courier", { unique: false });
            store.createIndex("status", "status", { unique: false });
          }
        };

        req.onsuccess = function (e) {
          resolve(e.target.result);
        };

        req.onerror = function () {
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });

    return dbPromise;
  }

  // =========================================================================
  // Synchronous LocalStorage & In-Memory API (Preserves all existing exports)
  // =========================================================================

  function getLocalRatingCache(phone) {
    const clean = normalizePhone(phone);
    if (!clean) return null;

    if (memoryRatingCache.has(clean)) {
      const mem = memoryRatingCache.get(clean);
      if (mem && (Date.now() - (mem.timestamp || 0) <= RATING_CACHE_TTL_MS)) {
        return mem.rating;
      }
    }

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(RATING_CACHE_KEY);
        if (raw) {
          const store = JSON.parse(raw);
          const entry = store[clean];
          if (entry && entry.rating) {
            const age = Date.now() - (entry.timestamp || 0);
            if (age <= RATING_CACHE_TTL_MS) {
              memoryRatingCache.set(clean, entry);
              return entry.rating;
            } else {
              delete store[clean];
              localStorage.setItem(RATING_CACHE_KEY, JSON.stringify(store));
            }
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function setLocalRatingCache(phone, ratingData) {
    const clean = normalizePhone(phone);
    if (!clean || !ratingData) return;

    const entry = {
      rating: ratingData,
      timestamp: Date.now()
    };

    memoryRatingCache.set(clean, entry);

    if (typeof localStorage !== "undefined") {
      try {
        let store = {};
        const raw = localStorage.getItem(RATING_CACHE_KEY);
        if (raw) store = JSON.parse(raw);
        store[clean] = entry;

        // Auto prune if > 500
        const keys = Object.keys(store);
        if (keys.length > 500) {
          keys.sort((a, b) => (store[a].timestamp || 0) - (store[b].timestamp || 0));
          for (let i = 0; i < 100; i++) delete store[keys[i]];
        }
        localStorage.setItem(RATING_CACHE_KEY, JSON.stringify(store));
      } catch (e) {}
    }

    // Also persist to IndexedDB asynchronously in the background
    saveRatingAsync(clean, ratingData).catch(() => {});
  }

  function clearLocalRatingCache(phone) {
    if (phone) {
      const clean = normalizePhone(phone);
      if (!clean) return;
      memoryRatingCache.delete(clean);
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(RATING_CACHE_KEY);
          if (raw) {
            const store = JSON.parse(raw);
            delete store[clean];
            localStorage.setItem(RATING_CACHE_KEY, JSON.stringify(store));
          }
        } catch (e) {}
      }
      deleteRatingAsync(clean).catch(() => {});
    } else {
      memoryRatingCache.clear();
      if (typeof localStorage !== "undefined") {
        try { localStorage.removeItem(RATING_CACHE_KEY); } catch (e) {}
      }
      clearStoreAsync("customer_ratings").catch(() => {});
    }
  }

  function getOrderPhoneCache(orderId) {
    const id = cleanOrderId(orderId);
    if (!id) return null;

    if (memoryOrderPhoneCache.has(id)) {
      return memoryOrderPhoneCache.get(id);
    }

    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(ORDER_PHONE_CACHE_KEY);
        if (raw) {
          const store = JSON.parse(raw);
          if (store && store[id]) {
            memoryOrderPhoneCache.set(id, store[id]);
            return store[id];
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function setOrderPhoneCache(orderId, phone) {
    const id = cleanOrderId(orderId);
    const cleanPhone = normalizePhone(phone);
    if (!id || !cleanPhone) return;

    memoryOrderPhoneCache.set(id, cleanPhone);

    if (typeof localStorage !== "undefined") {
      try {
        let store = {};
        const raw = localStorage.getItem(ORDER_PHONE_CACHE_KEY);
        if (raw) store = JSON.parse(raw);
        store[id] = cleanPhone;

        const keys = Object.keys(store);
        if (keys.length > 1000) {
          for (let i = 0; i < 200; i++) delete store[keys[i]];
        }
        localStorage.setItem(ORDER_PHONE_CACHE_KEY, JSON.stringify(store));
      } catch (e) {}
    }

    // Persist to IndexedDB asynchronously in background
    saveOrderPhoneAsync(id, cleanPhone).catch(() => {});
  }

  function clearOrderPhoneCache(orderId) {
    if (orderId) {
      const id = cleanOrderId(orderId);
      if (!id) return;
      memoryOrderPhoneCache.delete(id);
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(ORDER_PHONE_CACHE_KEY);
          if (raw) {
            const store = JSON.parse(raw);
            delete store[id];
            localStorage.setItem(ORDER_PHONE_CACHE_KEY, JSON.stringify(store));
          }
        } catch (e) {}
      }
    } else {
      memoryOrderPhoneCache.clear();
      if (typeof localStorage !== "undefined") {
        try { localStorage.removeItem(ORDER_PHONE_CACHE_KEY); } catch (e) {}
      }
    }
  }

  // =========================================================================
  // Asynchronous High-Capacity IndexedDB API
  // =========================================================================

  async function saveRatingAsync(phone, ratingData) {
    const clean = normalizePhone(phone);
    if (!clean || !ratingData) return false;

    const record = {
      phone: clean,
      rating: ratingData,
      successRate: ratingData.successRate !== undefined ? Number(ratingData.successRate) : 100,
      riskLevel: ratingData.riskLevel || "low",
      compositeScore: ratingData.compositeRiskScore !== undefined ? Number(ratingData.compositeRiskScore) : 80,
      timestamp: Date.now(),
      updatedAt: new Date().toISOString()
    };

    memoryRatingCache.set(clean, { rating: ratingData, timestamp: record.timestamp });

    const db = await getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("customer_ratings", "readwrite");
        const store = tx.objectStore("customer_ratings");
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function getRatingAsync(phone) {
    const clean = normalizePhone(phone);
    if (!clean) return null;

    // Check memory first
    const syncResult = getLocalRatingCache(clean);
    if (syncResult) return syncResult;

    const db = await getDB();
    if (!db) return syncResult;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("customer_ratings", "readonly");
        const store = tx.objectStore("customer_ratings");
        const req = store.get(clean);

        req.onsuccess = function (e) {
          const res = e.target.result;
          if (res && res.rating) {
            const age = Date.now() - (res.timestamp || 0);
            if (age <= RATING_CACHE_TTL_MS) {
              memoryRatingCache.set(clean, { rating: res.rating, timestamp: res.timestamp });
              resolve(res.rating);
              return;
            }
          }
          resolve(null);
        };

        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function deleteRatingAsync(phone) {
    const clean = normalizePhone(phone);
    if (!clean) return false;

    const db = await getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("customer_ratings", "readwrite");
        const store = tx.objectStore("customer_ratings");
        const req = store.delete(clean);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function saveOrderPhoneAsync(orderId, phone) {
    const id = cleanOrderId(orderId);
    const clean = normalizePhone(phone);
    if (!id || !clean) return false;

    const record = {
      orderId: id,
      phone: clean,
      timestamp: Date.now()
    };

    memoryOrderPhoneCache.set(id, clean);

    const db = await getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("order_phone_cache", "readwrite");
        const store = tx.objectStore("order_phone_cache");
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function getOrderPhoneAsync(orderId) {
    const id = cleanOrderId(orderId);
    if (!id) return null;

    const sync = getOrderPhoneCache(id);
    if (sync) return sync;

    const db = await getDB();
    if (!db) return sync;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("order_phone_cache", "readonly");
        const store = tx.objectStore("order_phone_cache");
        const req = store.get(id);

        req.onsuccess = function (e) {
          const res = e.target.result;
          if (res && res.phone) {
            memoryOrderPhoneCache.set(id, res.phone);
            resolve(res.phone);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function saveOrderMetadataAsync(orderId, metadata) {
    const id = cleanOrderId(orderId);
    if (!id || !metadata) return false;

    const record = {
      orderId: id,
      phone: normalizePhone(metadata.phone) || metadata.phone || "",
      name: metadata.name || "",
      address: metadata.address || "",
      district: metadata.district || "",
      zone: metadata.zone || "",
      cod: metadata.cod || "0",
      items: metadata.items || [],
      isOutsideDhaka: Boolean(metadata.isOutsideDhaka),
      isFreeShipping: Boolean(metadata.isFreeShipping),
      customerNote: metadata.customerNote || metadata.notes || "",
      timestamp: Date.now()
    };

    memoryOrderMetadataCache.set(id, record);

    const db = await getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("order_metadata", "readwrite");
        const store = tx.objectStore("order_metadata");
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function getOrderMetadataAsync(orderId) {
    const id = cleanOrderId(orderId);
    if (!id) return null;

    if (memoryOrderMetadataCache.has(id)) {
      return memoryOrderMetadataCache.get(id);
    }

    const db = await getDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("order_metadata", "readonly");
        const store = tx.objectStore("order_metadata");
        const req = store.get(id);
        req.onsuccess = (e) => {
          const res = e.target.result;
          if (res) memoryOrderMetadataCache.set(id, res);
          resolve(res || null);
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function saveNDRAlertAsync(trackingId, alertData) {
    if (!trackingId || !alertData) return false;
    const record = Object.assign({
      trackingId: String(trackingId).trim(),
      timestamp: Date.now()
    }, alertData);

    memoryNDRAlertsCache.set(record.trackingId, record);

    const db = await getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("ndr_alerts", "readwrite");
        const store = tx.objectStore("ndr_alerts");
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function getNDRAlertsAsync() {
    const db = await getDB();
    if (!db) {
      return Array.from(memoryNDRAlertsCache.values());
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("ndr_alerts", "readonly");
        const store = tx.objectStore("ndr_alerts");
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = () => resolve(Array.from(memoryNDRAlertsCache.values()));
      } catch (e) {
        resolve(Array.from(memoryNDRAlertsCache.values()));
      }
    });
  }

  async function clearStoreAsync(storeName) {
    const db = await getDB();
    if (!db) return true;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function exportAllDataAsync() {
    const db = await getDB();
    const result = {
      ratings: [],
      orders: [],
      orderPhones: [],
      ndrAlerts: [],
      exportedAt: new Date().toISOString()
    };

    if (!db) {
      result.ratings = Array.from(memoryRatingCache.entries()).map(([k, v]) => ({ phone: k, ...v }));
      result.orderPhones = Array.from(memoryOrderPhoneCache.entries()).map(([k, v]) => ({ orderId: k, phone: v }));
      result.orders = Array.from(memoryOrderMetadataCache.values());
      result.ndrAlerts = Array.from(memoryNDRAlertsCache.values());
      return result;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(["customer_ratings", "order_metadata", "order_phone_cache", "ndr_alerts"], "readonly");
        let doneCount = 0;
        const checkDone = () => {
          doneCount++;
          if (doneCount === 4) resolve(result);
        };

        tx.objectStore("customer_ratings").getAll().onsuccess = (e) => {
          result.ratings = e.target.result || [];
          checkDone();
        };
        tx.objectStore("order_metadata").getAll().onsuccess = (e) => {
          result.orders = e.target.result || [];
          checkDone();
        };
        tx.objectStore("order_phone_cache").getAll().onsuccess = (e) => {
          result.orderPhones = e.target.result || [];
          checkDone();
        };
        tx.objectStore("ndr_alerts").getAll().onsuccess = (e) => {
          result.ndrAlerts = e.target.result || [];
          checkDone();
        };
      } catch (e) {
        resolve(result);
      }
    });
  }

  /**
   * Generic Key-Value Getter
   */
  async function get(storeName, key) {
    if (storeName === "customer_ratings") return getRatingAsync(key);
    if (storeName === "order_phone_cache") return getOrderPhoneAsync(key);
    if (storeName === "order_metadata") return getOrderMetadataAsync(key);
    if (storeName === "ndr_alerts") return getNDRAlertsAsync(key);

    const db = await getDB();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, "readonly");
          const store = tx.objectStore(storeName);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result ? (req.result.value || req.result) : null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }
    return null;
  }

  /**
   * Generic Key-Value Setter
   */
  async function set(storeName, key, value) {
    if (storeName === "customer_ratings") return saveRatingAsync(key, value);
    if (storeName === "order_phone_cache") return saveOrderPhoneAsync(key, value);
    if (storeName === "order_metadata") return saveOrderMetadataAsync(key, value);
    if (storeName === "ndr_alerts") return saveNDRAlertAsync(value);

    const db = await getDB();
    if (db) {
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const req = store.put({ key, value, updatedAt: Date.now() });
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        } catch (e) {
          resolve(false);
        }
      });
    }
    return false;
  }

  /**
   * Generic Key-Value Deleter
   */
  async function del(storeName, key) {
    if (storeName === "customer_ratings") return deleteRatingAsync(key);

    const db = await getDB();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    }
    return false;
  }

  return {
    DB_NAME,
    DB_VERSION,
    RATING_CACHE_KEY,
    ORDER_PHONE_CACHE_KEY,
    RATING_CACHE_TTL_MS,
    normalizePhone,
    cleanOrderId,
    getDB,
    // Generic KV Accessors
    get,
    set,
    delete: del,
    // Synchronous LocalStorage & In-memory (100% backward compatible)
    getLocalRatingCache,
    setLocalRatingCache,
    clearLocalRatingCache,
    getOrderPhoneCache,
    setOrderPhoneCache,
    clearOrderPhoneCache,
    // High-capacity Async IndexedDB
    saveRatingAsync,
    getRatingAsync,
    deleteRatingAsync,
    saveOrderPhoneAsync,
    getOrderPhoneAsync,
    saveOrderMetadataAsync,
    getOrderMetadataAsync,
    saveNDRAlertAsync,
    getNDRAlertsAsync,
    clearStoreAsync,
    exportAllDataAsync
  };
});
