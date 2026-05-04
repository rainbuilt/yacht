const SCHEMA_VERSION = 1;
const SETTINGS_KEY = "yacht.settings";
const DB_NAME = "yacht-subthreads";
const DB_VERSION = 2;

const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  sourceLinkStyle: {
    color: "#111111",
    underline: true
  }
};

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("anchors")) {
        const anchors = db.createObjectStore("anchors", { keyPath: "anchorId" });
        anchors.createIndex("byConversation", "conversationId", { unique: false });
        anchors.createIndex("bySource", ["conversationId", "sourceMessageKey"], {
          unique: false
        });
      }

      if (!db.objectStoreNames.contains("threads")) {
        const threads = db.createObjectStore("threads", { keyPath: "threadId" });
        threads.createIndex("byConversation", "conversationId", { unique: false });
        threads.createIndex("byAnchor", ["conversationId", "anchorId"], {
          unique: false
        });
        threads.createIndex("byParent", ["conversationId", "parentThreadIndexKey"], {
          unique: false
        });
      } else {
        const threads = request.transaction.objectStore("threads");
        if (threads.indexNames.contains("byParent")) {
          threads.deleteIndex("byParent");
        }
        threads.createIndex("byParent", ["conversationId", "parentThreadIndexKey"], {
          unique: false
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSettings() {
  const stored = await chrome.storage.local.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return mergeSettings(stored[SETTINGS_KEY]);
}

function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    sourceLinkStyle: {
      ...DEFAULT_SETTINGS.sourceLinkStyle,
      ...(settings.sourceLinkStyle ?? {})
    },
    schemaVersion: SCHEMA_VERSION
  };
}

async function saveSettings(settings = {}) {
  const next = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

async function getAllFromStore(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  const records = await requestToPromise(transaction.objectStore(storeName).getAll());
  db.close();
  return storeName === "threads" ? records.map(stripInternalThreadFields) : records;
}

async function getConversationData(conversationId) {
  const db = await openDatabase();
  const transaction = db.transaction(["anchors", "threads"], "readonly");
  const range = IDBKeyRange.only(conversationId);
  const anchors = await requestToPromise(
    transaction.objectStore("anchors").index("byConversation").getAll(range)
  );
  const threads = await requestToPromise(
    transaction.objectStore("threads").index("byConversation").getAll(range)
  );
  db.close();

  return { anchors, threads: threads.map(stripInternalThreadFields) };
}

async function upsertRecord(storeName, record) {
  const nextRecord = normalizeRecordForStore(storeName, record);
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(nextRecord);
  await transactionDone(transaction);
  db.close();
  return record;
}

function normalizeRecordForStore(storeName, record) {
  if (storeName !== "threads") {
    return record;
  }

  return {
    ...record,
    parentThreadIndexKey: record.parentThreadId || "__root__"
  };
}

function stripInternalThreadFields(thread) {
  const { parentThreadIndexKey, ...publicThread } = thread;
  return publicThread;
}

async function importData({ mode, payload }) {
  if (!payload || Number(payload.schemaVersion) !== SCHEMA_VERSION) {
    throw new Error(`Unsupported import schemaVersion: ${payload?.schemaVersion ?? "missing"}`);
  }

  const db = await openDatabase();
  const transaction = db.transaction(["anchors", "threads"], "readwrite");
  const anchorStore = transaction.objectStore("anchors");
  const threadStore = transaction.objectStore("threads");

  if (mode === "replace") {
    anchorStore.clear();
    threadStore.clear();
  }

  for (const anchor of payload.anchors ?? []) {
    anchorStore.put(anchor);
  }

  for (const thread of payload.threads ?? []) {
    threadStore.put(normalizeRecordForStore("threads", thread));
  }

  await transactionDone(transaction);
  db.close();

  if (payload.settings) {
    await saveSettings(payload.settings);
  }

  return {
    anchors: (payload.anchors ?? []).length,
    threads: (payload.threads ?? []).length
  };
}

async function exportData() {
  const [settings, anchors, threads] = await Promise.all([
    getSettings(),
    getAllFromStore("anchors"),
    getAllFromStore("threads")
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    anchors,
    threads
  };
}

async function resetAllData() {
  const db = await openDatabase();
  const transaction = db.transaction(["anchors", "threads"], "readwrite");
  transaction.objectStore("anchors").clear();
  transaction.objectStore("threads").clear();
  await transactionDone(transaction);
  db.close();
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "YACHT_GET_SETTINGS":
      return { ok: true, settings: await getSettings() };

    case "YACHT_SAVE_SETTINGS":
      return { ok: true, settings: await saveSettings(message.settings) };

    case "YACHT_GET_CONVERSATION_DATA":
      return {
        ok: true,
        data: await getConversationData(String(message.conversationId ?? ""))
      };

    case "YACHT_UPSERT_ANCHOR":
      return {
        ok: true,
        anchor: await upsertRecord("anchors", message.anchor)
      };

    case "YACHT_UPSERT_THREAD":
      return {
        ok: true,
        thread: await upsertRecord("threads", message.thread)
      };

    case "YACHT_EXPORT_DATA":
      return { ok: true, payload: await exportData() };

    case "YACHT_IMPORT_DATA":
      return {
        ok: true,
        imported: await importData({
          mode: message.mode === "replace" ? "replace" : "merge",
          payload: message.payload
        })
      };

    case "YACHT_RESET_ALL_DATA":
      await resetAllData();
      return { ok: true };

    case "YACHT_GET_TAB_INFO":
      return {
        ok: true,
        tabId: sender.tab?.id ?? null,
        url: sender.tab?.url ?? null
      };

    default:
      return { ok: false, error: "Unknown message type." };
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) {
    return;
  }

  await saveSettings(DEFAULT_SETTINGS);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[Yacht] background error", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
