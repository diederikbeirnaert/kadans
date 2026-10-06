// Lokale opslag in de browser (IndexedDB). Drie tabellen:
//   activities – één rij per activiteit, sleutel `id` (het labelId van COROS)
//   days       – één rij per dag, sleutel `date` (yyyy-mm-dd)
//   meta       – losse waarden zoals de laatste synchronisatie

let opening = null;
function open() {
  opening ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('kadans', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('activities', { keyPath: 'id' });
      r.result.createObjectStore('days', { keyPath: 'date' });
      r.result.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return opening;
}

const done = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export async function all(store) {
  return done((await open()).transaction(store).objectStore(store).getAll());
}

// Voegt velden toe aan bestaande rijen zonder de rest te overschrijven. `patches` is { sleutel: velden }.
// Elke gewijzigde rij krijgt een tijdstempel `u`, waaraan de cloudsync ziet wat nog verstuurd moet worden.
// Met `stamp: false` (data die net uit de cloud komt) blijft dat tijdstempel ongemoeid.
export async function merge(store, patches, { stamp = true } = {}) {
  const tx = (await open()).transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const u = Date.now();
  for (const [key, patch] of Object.entries(patches)) {
    const r = os.get(key);
    r.onsuccess = () => os.put({ ...r.result, ...patch, [os.keyPath]: key, u: stamp ? u : r.result?.u || 0 });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function getMeta(key) {
  return (await done((await open()).transaction('meta').objectStore('meta').get(key)))?.value ?? null;
}

export const setMeta = (key, value) => merge('meta', { [key]: { value } });
